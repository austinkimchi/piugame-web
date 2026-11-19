import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { ObjectId } from "mongodb";
import ts from "typescript";

import * as chartRecommendation from "../src/lib/chart-recommendation.ts";
import * as catalogVersion from "../src/lib/catalog-version.ts";
import * as mobileAuthCore from "../src/lib/mobile-auth-core.ts";
import * as performanceFormat from "../src/lib/performance-format.ts";
import * as sessionCore from "../src/lib/performance-session.ts";
import * as sessionPagination from "../src/lib/performance-session-pagination.ts";
import * as piuVersion from "../src/lib/piu-version.ts";

type Performance = typeof import("../src/lib/performance.ts");
type Catalog = typeof import("../src/lib/catalog.ts");
type Session = Awaited<ReturnType<Performance["getPerformanceSessions"]>>[number];
type Row = Record<string, unknown>;
const userId = new ObjectId();
const require = createRequire(import.meta.url);

// Load the real route and server functions with only these dependencies available.
// The fixtures never open MongoDB, read application credentials, or contact a server.
function loadServerModule<T>(path: string, dependencies: Record<string, unknown>): T {
  const source = readFileSync(new URL(`../src/${path}.ts`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const loadedModule = { exports: {} };
  const mockRequire = (name: string) => {
    if (!Object.hasOwn(dependencies, name)) throw new Error(`Unexpected server dependency: ${name}`);
    return dependencies[name];
  };
  new Function("require", "module", "exports", outputText)(mockRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports as T;
}

function matches(row: Row, filter: Row): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === "$and") return (expected as Row[]).every((part) => matches(row, part));
    if (key === "$or") return (expected as Row[]).some((part) => matches(row, part));
    const actual = row[key];
    if (expected instanceof ObjectId) return expected.equals(actual as ObjectId);
    if (expected instanceof RegExp) return typeof actual === "string" && expected.test(actual);
    if (expected && typeof expected === "object" && "$in" in expected) {
      return (expected.$in as unknown[]).some((entry) => matches(row, { [key]: entry }));
    }
    if (expected && typeof expected === "object" && "$type" in expected) return expected.$type === "date" && actual instanceof Date;
    return Array.isArray(actual) ? actual.includes(expected) : actual === expected;
  });
}

function catalogFixture(rows: Row[] = []) {
  const filters: Row[] = [];
  const collection = {
    find(filter: Row) {
      filters.push(filter);
      let limit = Infinity;
      return {
        limit(value: number) { limit = value; return this; },
        toArray: async () => rows.filter((row) => matches(row, filter)).slice(0, limit),
      };
    },
    countDocuments: async (filter: Row) => rows.filter((row) => matches(row, filter)).length,
    distinct: async (field: string, filter: Row) => rows.filter((row) => matches(row, filter)).flatMap((row) => row[field] ?? []),
    aggregate(pipeline: Row[]) {
      const filter = pipeline.find((stage) => "$match" in stage)?.$match as Row;
      filters.push(filter);
      const offset = Number(pipeline.find((stage) => "$skip" in stage)?.$skip ?? 0);
      const limit = Number(pipeline.find((stage) => "$limit" in stage)?.$limit ?? rows.length);
      return { toArray: async () => rows.filter((row) => matches(row, filter)).slice(offset, offset + limit) };
    },
  };
  const catalog = loadServerModule<Catalog>("lib/catalog", {
    "server-only": {}, "node:fs/promises": {}, "node:path": require("node:path"),
    react: { cache: (fn: unknown) => fn },
    "@/lib/mongodb": { hasMongoConfig: () => true, getMongoClient: async () => ({ db: () => ({ collection: () => collection }) }) },
    "@/lib/audio-preview": { audioFileUrlForPath: (path: string) => `/api/audio-files/${path}` },
    "@/lib/catalog-version": catalogVersion,
    "@/lib/premium-songs": { isPremiumSong: () => false },
    "@/lib/song-chart-filters": {}, "@/lib/song-slug-filter": {},
    "@/lib/public-catalog": {},
  });
  return { catalog, filters };
}

function play(session: number, minute = 0, overrides: Row = {}): Row {
  return {
    _id: new ObjectId(), userId, piuVersion: "phoenix2", songName: `Song ${session}`,
    chartToken: "S15", mode: "S", level: "15", score: 980000, grade: "SS", plate: null,
    stageBreak: false, arcadeName: "Arcade", judgments: null,
    playedAt: new Date(Date.UTC(2026, 10, 19, 12) - (session * 180 + minute) * 60000),
    playedAtRaw: null, ...overrides,
  };
}

function sessionsFixture(rows: Row[], catalog = catalogFixture().catalog) {
  const cursors: Array<{ closed: boolean; reads: number }> = [];
  const requests: Array<{ offset?: number; limit?: number }> = [];
  let failCursor = false;
  const collection = {
    createIndex: async () => "test-index", indexes: async () => [],
    findOne: async () => ({ preferences: { piuGameVersion: "phoenix2" } }),
    find(filter: Row) {
      assert.ok((filter.userId as ObjectId).equals(userId));
      assert.equal(filter.piuVersion, "phoenix2");
      const state = { closed: false, reads: 0 };
      cursors.push(state);
      return {
        sort(order: Row) { assert.deepEqual(order, { playedAt: -1, ingestedAt: -1, _id: -1 }); return this; },
        async *[Symbol.asyncIterator]() {
          for (const row of rows.filter((entry) => matches(entry, filter))) {
            state.reads += 1;
            if (failCursor) throw new Error("Test cursor failed");
            yield row;
          }
        },
        close: async () => { state.closed = true; },
      };
    },
  };
  const dependencies: Record<string, unknown> = {
    "server-only": {}, "node:crypto": require("node:crypto"), mongodb: { ObjectId },
    "@austinkimchi/piugame-sdk": {},
    "@/lib/chart-recommendation": chartRecommendation,
    "@/lib/catalog": catalog,
    "@/lib/mongodb": { hasMongoConfig: () => true, getMongoClient: async () => ({ db: () => ({ collection: () => collection }) }) },
    "@/lib/performance-format": performanceFormat,
    "@/lib/performance-session": sessionCore,
    "@/lib/performance-session-pagination": sessionPagination,
    "@/lib/piu-version": piuVersion,
    "@/lib/site": { absoluteSiteUrl: (path: string) => new URL(path, "https://example.com").href },
  };
  for (const name of ["credential-crypto", "mobile-sync-ordering", "performance-chart-key", "performance-indexes", "performance-play-key", "performance-user-lock", "performance-metrics", "performance-stat-summary", "song-recommendation", "performance-sync-errors", "piu-pumbility", "piu-top-plays", "piu-next-title"]) {
    dependencies[`@/lib/${name}`] = {};
  }
  globalThis.piuPerformanceIndexesPromise = undefined;
  const performance = loadServerModule<Performance>("lib/performance", dependencies);
  const { GET } = loadServerModule<typeof import("../src/app/api/mobile/v1/performance/sessions/route.ts")>("app/api/mobile/v1/performance/sessions/route", {
    "next/server": { NextResponse: Response },
    "@/lib/mobile-auth-core": mobileAuthCore,
    "@/lib/mobile-auth": { authenticateMobileAccessToken: async (token: string | null) => token === "test-access" ? { userId: userId.toHexString() } : null },
    "@/lib/performance": { getPerformanceSessions: (id: string, args: { offset?: number; limit?: number }) => { requests.push(args); return performance.getPerformanceSessions(id, args); } },
    "@/lib/performance-session-pagination": sessionPagination,
  });
  return {
    performance, cursors, requests,
    failCursor: () => { failCursor = true; },
    request: (query = "", authorization = "Bearer test-access") => GET(new Request(`https://example.com/api/mobile/v1/performance/sessions${query}`, { headers: { authorization } })),
  };
}

test("parameterless legacy session requests retain fifty sessions and private cache headers", async () => {
  const fixture = sessionsFixture(Array.from({ length: 60 }, (_, index) => play(index)));
  const response = await fixture.request();
  const body = await response.json() as { sessions: Session[]; nextOffset: number | null };
  assert.equal(body.sessions.length, 50);
  assert.equal(body.nextOffset, 50);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.deepEqual(fixture.requests, [{ offset: 0, limit: 51 }]);
});

test("mobile pagination traverses beyond one thousand sessions exactly once and terminates", async () => {
  const rows = Array.from({ length: 1025 }, (_, index) => play(index));
  const fixture = sessionsFixture(rows);
  const seen = new Set<string>();
  let offset = 0;
  for (let page = 0; page < 60; page += 1) {
    const response = await fixture.request(`?offset=${offset}&limit=20`);
    const body = await response.json() as { sessions: Session[]; nextOffset: number | null };
    for (const session of body.sessions) {
      assert.ok(!seen.has(session.id), "continuations must not repeat a previous session");
      seen.add(session.id);
    }
    if (body.nextOffset === null) break;
    assert.equal(body.nextOffset, offset + 20);
    offset = body.nextOffset;
  }
  assert.equal(offset, 1020);
  assert.equal(seen.size, 1025);
  assert.ok(fixture.cursors.every((cursor) => cursor.closed));
});

test("session pages preserve multi-play boundaries and close a cursor on early exit", async () => {
  const rows = Array.from({ length: 5 }, (_, index) => [play(index), play(index, 10)]).flat();
  const fixture = sessionsFixture(rows);
  const page = await fixture.performance.getPerformanceSessions(userId.toHexString(), { offset: 1, limit: 2 });
  assert.deepEqual(page.map((session) => session.plays.map((entry) => entry.songName)), [["Song 1", "Song 1"], ["Song 2", "Song 2"]]);
  assert.deepEqual(page.map((session) => session.summary.playCount), [2, 2]);
  assert.equal(fixture.cursors[0].reads, 7);
  assert.equal(fixture.cursors[0].closed, true);
});

test("empty pages and exact final pages do not manufacture a continuation", async () => {
  const fixture = sessionsFixture(Array.from({ length: 20 }, (_, index) => play(index)));
  assert.equal((await (await fixture.request("?limit=20")).json()).nextOffset, null);
  assert.deepEqual(await (await fixture.request("?offset=20&limit=20")).json(), { sessions: [], nextOffset: null });
});

test("invalid pagination inputs use bounded defaults consistently in route and data helper", async () => {
  const fixture = sessionsFixture([play(0)]);
  await fixture.request("?offset=not-a-number&limit=Infinity");
  await fixture.request("?offset=-5&limit=999");
  await fixture.request("?offset=1020&limit=0");
  await fixture.request("?offset=9007199254740992&limit=garbage");
  assert.deepEqual(fixture.requests, [
    { offset: 0, limit: 51 }, { offset: 0, limit: 51 },
    { offset: 1020, limit: 2 }, { offset: 0, limit: 51 },
  ]);
  assert.equal((await fixture.performance.getPerformanceSessions(userId.toHexString(), { offset: NaN, limit: Infinity })).length, 1);
});

test("invalid mobile tokens cannot read sessions", async () => {
  const fixture = sessionsFixture([play(0)]);
  const response = await fixture.request("", "Bearer invalid");
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "invalid_token" });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(fixture.cursors.length, 0);
});

test("session cursors close even if reading a page fails", async () => {
  const fixture = sessionsFixture([play(0)]);
  fixture.failCursor();
  await assert.rejects(fixture.performance.getPerformanceSessions(userId.toHexString()), /Test cursor failed/);
  assert.equal(fixture.cursors[0].closed, true);
});

test("historical session artwork resolves removed PHOENIX songs without broadening ordinary catalog lookup", async () => {
  const fixture = catalogFixture([{
    _id: new ObjectId(), songName: "Removed song", artist: "Artist", piuVersion: "phoenix",
    supportedVersions: ["phoenix"], removedFromVersions: ["phoenix2"], images: ["old-jacket.png"],
  }]);
  assert.equal((await fixture.catalog.getSongsByTitles("phoenix2", ["Removed song"])).size, 0);
  const sessions = sessionsFixture([play(0, 0, { songName: "Removed song" })], fixture.catalog);
  const [session] = await sessions.performance.getPerformanceSessions(userId.toHexString());
  assert.equal(session.plays[0].songImageUrl, "https://example.com/assets/piu/phoenix/song_img/old-jacket.png");
  assert.equal(fixture.filters[0].supportedVersions, "phoenix2");
  assert.equal(fixture.filters[1].supportedVersions, undefined);
});

test("canonical series filters include every legacy label normalized in catalog options", async () => {
  const legacy = ["PHOENIX 2", "Phoenix 2", "phoenix2", " phoenix\t 2 "];
  const fixture = catalogFixture([...legacy, "PHOENIX", "PHOENIX 20"].map((series, index) => ({
    _id: new ObjectId(), songName: `Song ${index}`, artist: "Artist", series, supportedVersions: ["phoenix2"],
  })));
  const result = await fixture.catalog.searchSongs({ query: "", series: ["PHOENIX 2"] });
  assert.equal(result.total, 4);
  assert.equal(result.songs.length, 4);
  assert.deepEqual(result.filterOptions.series, ["PHOENIX 2"]);
  assert.ok(result.songs.every((song) => song.series === "PHOENIX 2"));
});

test("unrelated catalog series labels remain literal even when they contain regex characters", async () => {
  const fixture = catalogFixture(["Custom (A+B)", "Custom AAAB"].map((series, index) => ({
    _id: new ObjectId(), songName: `Song ${index}`, artist: "Artist", series, supportedVersions: ["phoenix2"],
  })));
  const result = await fixture.catalog.searchSongs({ query: "", series: ["Custom (A+B)"] });
  assert.equal(result.total, 1);
  assert.equal(result.songs[0].series, "Custom (A+B)");
});
