import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

type PageLoader = typeof import("../src/lib/catalog-page.ts");
const source = readFileSync(new URL("../src/lib/catalog-page.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });

function fixture(configured: boolean, unavailable = false) {
  const fallbackCalls: unknown[] = [];
  const snapshotCalls: unknown[] = [];
  const song = Object.freeze({ slug: "source-artist-phoenix", title: "Source", chartSummary: ["S16"] });
  const filters = { folders: [], series: [], levels: [], charts: [] };
  const dependencies: Record<string, unknown> = {
    "server-only": {},
    "@/lib/mongodb": { hasMongoConfig: () => configured },
    "@/lib/catalog": { searchSongs: async (options: unknown) => { fallbackCalls.push(options); return { songs: [], filterOptions: filters }; } },
    "@/lib/public-catalog": { getPublicCatalogSnapshot: async (...args: unknown[]) => {
      snapshotCalls.push(args);
      if (unavailable) throw new Error("configured catalog unavailable");
      return Object.freeze({ songs: Object.freeze([song]), filterOptions: filters });
    } },
  };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", outputText)((name: string) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  return { getCatalogPage: (loaded.exports as PageLoader).getCatalogPage, fallbackCalls, snapshotCalls, song };
}

test("no-database pages use an explicitly limited filesystem preview without claiming a public snapshot", async () => {
  const { getCatalogPage, fallbackCalls, snapshotCalls } = fixture(false);
  assert.equal((await getCatalogPage("phoenix")).localPreview, true);
  assert.equal((await getCatalogPage("phoenix2", { removed: true })).localPreview, true);
  assert.deepEqual(fallbackCalls, [
    { query: "", limit: 48, supportedVersion: "phoenix", removedFromVersion: undefined },
    { query: "", limit: 48, supportedVersion: "phoenix2", removedFromVersion: "phoenix2" },
  ]);
  assert.deepEqual(snapshotCalls, []);
});

test("configured pages copy the frozen public snapshot without mutating or attaching private fields to it", async () => {
  const { getCatalogPage, fallbackCalls, snapshotCalls, song } = fixture(true);
  const page = await getCatalogPage("phoenix");
  assert.equal(page.localPreview, false);
  assert.equal(page.songs[0].audioPath, null);
  assert.notEqual(page.songs[0], song);
  assert.equal(Object.hasOwn(song, "audioPath"), false);
  assert.deepEqual(snapshotCalls, [["phoenix", {}]]);
  assert.deepEqual(fallbackCalls, []);
});

test("configured catalog failures never fall back to incomplete local assets", async () => {
  const { getCatalogPage, fallbackCalls } = fixture(true, true);
  await assert.rejects(getCatalogPage("phoenix2"), /configured catalog unavailable/);
  assert.deepEqual(fallbackCalls, []);
});
