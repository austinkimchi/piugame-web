import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { MongoClient, MongoServerError, ObjectId, type Db, type IndexSpecification } from "mongodb";
import ts from "typescript";

import * as mongoIndexes from "../src/lib/mongo-indexes.ts";
import * as performanceIndexes from "../src/lib/performance-indexes.ts";
import * as piuVersion from "../src/lib/piu-version.ts";

// Explicit opt-in; never consumes MONGODB_URI, downloads or starts a server.
const enabled = process.env.MONGO_BOOTSTRAP_RUN_INTEGRATION === "1";
const affected = ["song_tag_contributions", "song_notes", "performance_profiles", "performance_play_events", "performance_chart_stats"];

function appModules(db: Db) {
  assert.match(db.databaseName, /^piu_bootstrap_test_[a-f0-9]{32}$/);
  const dependencies: Record<string, unknown> = {
    "server-only": {},
    mongodb: { ObjectId, MongoServerError },
    react: { cache: (fn: unknown) => fn },
    "@/lib/mongo-indexes": mongoIndexes,
    "@/lib/performance-indexes": performanceIndexes,
    "@/lib/piu-version": piuVersion,
    "@/lib/mongodb": {
      hasMongoConfig: () => true,
      getMongoClient: async () => ({ db: (name: string) => {
        assert.equal(name, db.databaseName, "Application may access only this test's database");
        return db;
      } }),
    },
  };
  // Only index initialization and empty reads are exercised. Other imported
  // capabilities fail if invoked; no SDK, filesystem, credentials or network.
  const blocked = new Proxy({}, { get: (_target, key) => {
    throw new Error(`Unexpected bootstrap dependency access: ${String(key)}`);
  } });
  function load<T>(name: "auth" | "performance"): T {
    const source = readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    const loaded = { exports: {} };
    runInNewContext(outputText, {
      module: loaded, exports: loaded.exports,
      process: { env: { COMMUNITY_DB_NAME: db.databaseName } },
      require: (dependency: string) => dependencies[dependency] ?? blocked,
    }, { timeout: 5000 });
    return loaded.exports as T;
  }
  return { auth: load<typeof import("../src/lib/auth.ts")>("auth"), performance: load<typeof import("../src/lib/performance.ts")>("performance") };
}

test("MongoDB 5.0.8: fresh auth/performance initialization and legacy index migration", { skip: !enabled, timeout: 60_000 }, async () => {
  const uri = process.env.MONGO_BOOTSTRAP_TEST_URI ?? "";
  const match = /^mongodb:\/\/127\.0\.0\.1:(\d+)\/?$/.exec(uri);
  assert.ok(match && Number(match[1]) > 1024 && Number(match[1]) <= 65535 && Number(match[1]) !== 27017,
    "Supply an ephemeral loopback MongoDB port, without credentials or a database path");
  const client = new MongoClient(uri, { directConnection: true, serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, socketTimeoutMS: 10_000 });
  const databaseName = `piu_bootstrap_test_${randomUUID().replaceAll("-", "")}`;
  const marker = randomUUID();
  const db = client.db(databaseName);
  let owned = false;
  try {
    await client.connect();
    assert.equal((await client.db("admin").command({ buildInfo: 1 })).version, "5.0.8");
    const hello = await client.db("admin").command({ hello: 1 });
    assert.equal(hello.isWritablePrimary, true);
    assert.equal(hello.setName, undefined);
    assert.notEqual(hello.msg, "isdbgrid");
    assert.deepEqual(await db.listCollections().toArray(), []);
    await db.collection("test_ownership").insertOne({ marker });
    owned = true;

    for (const name of affected) {
      await assert.rejects(db.collection(name).indexes(), (error: unknown) => error instanceof MongoServerError && error.code === 26);
    }
    async function initialize() {
      const { auth, performance } = appModules(db);
      const userId = new ObjectId().toHexString();
      assert.equal(await auth.getUserById(userId), null);
      const page = await performance.getPerformanceRecentPlays(userId);
      assert.equal(page.total, 0);
      assert.equal(page.nextOffset, null);
      assert.equal(page.recentPlays.length, 0);
    }
    await initialize();
    const expectedUnique = [
      { userId: 1, songSlug: 1, chartToken: 1, tag: 1 },
      { userId: 1, songSlug: 1, chartToken: 1 },
      { userId: 1, piuVersion: 1 },
      { userId: 1, piuVersion: 1, playHash: 1 },
      { userId: 1, piuVersion: 1, chartToken: 1 },
    ];
    const baseline = await Promise.all(affected.map((name) => db.collection(name).indexes()));
    for (const [index, indexes] of baseline.entries()) {
      assert.ok(indexes.some((entry) => entry.unique && JSON.stringify(entry.key) === JSON.stringify(expectedUnique[index])), affected[index]);
      assert.equal(await db.collection(affected[index]).countDocuments(), 0, "Initialization must not fabricate user data");
    }
    const legacyKeys: IndexSpecification[] = [
      { userId: 1, songSlug: 1, tag: 1 }, { userId: 1, songSlug: 1 },
      { userId: 1 }, { userId: 1, playHash: 1 }, { userId: 1, chartToken: 1 },
    ];
    for (const [index, name] of affected.entries()) {
      await db.collection(name).createIndex(legacyKeys[index], { unique: true, name: "test_legacy" });
      await db.collection(name).createIndex({ unrelated: 1 }, { name: "test_preserved" });
    }
    await db.collection(affected[0]).createIndex({ songSlug: 1, tag: 1 }, { name: "test_legacy_nonunique" });
    await initialize(); // Fresh module globals also exercise restart/idempotence.
    for (const [index, name] of affected.entries()) {
      const indexes = await db.collection(name).indexes();
      assert.ok(!indexes.some((entry) => entry.name?.startsWith("test_legacy")), name);
      assert.ok(indexes.some((entry) => entry.name === "test_preserved"), name);
      assert.deepEqual(indexes.filter((entry) => entry.name !== "test_preserved"), baseline[index]);
    }
  } finally {
    try {
      if (owned) {
        assert.equal((await db.collection("test_ownership").findOne({ marker }))?.marker, marker);
        await db.dropDatabase();
        assert.deepEqual(await db.listCollections().toArray(), [], "Disposable database cleanup must complete");
      }
    } finally { await client.close(); }
  }
});
