import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import * as catalogVersion from "../src/lib/catalog-version.ts";
import { audioFileUrlForPath } from "../src/lib/audio-preview.ts";
import { createPublicCatalogStore } from "../src/lib/public-catalog-cache.ts";

// Execute the real admin mutation with offline Mongo/upload dependencies. This
// exercises commit ordering, not a second implementation of the mutation.
const source = readFileSync(new URL("../src/lib/catalog.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
});

function fixture(options: { writeFails?: boolean; uploadFails?: boolean; responseReadFails?: boolean; matched?: boolean; sourceVersion?: "phoenix" | "phoenix2" } = {}) {
  const document: Record<string, unknown> = {
    _id: "song-id", songName: "Original", songKey: "original", artist: "Artist", piuVersion: options.sourceVersion ?? "phoenix2",
    supportedVersions: ["phoenix2"], chartTokens: ["S18"], chartTokensByVersion: { phoenix2: ["S18"] },
  };
  let writes = 0;
  let invalidations = 0;
  const store = createPublicCatalogStore(async () => ({ find() { return { toArray: async () => [structuredClone(document)] }; } }));
  const collection = {
    aggregate() { return { toArray: async () => [] }; },
    find() { return { limit() { return { toArray: async () => [document] }; } }; },
    async findOne() {
      if (writes && options.responseReadFails) throw new Error("Response read failed");
      return document;
    },
    async updateOne(_filter: unknown, update: { $set: Record<string, unknown> }) {
      if (options.writeFails) throw new Error("Write failed");
      writes += 1;
      if (options.matched !== false) Object.assign(document, update.$set);
      return { acknowledged: true, matchedCount: options.matched === false ? 0 : 1 };
    },
  };
  const dependencies: Record<string, unknown> = {
    "server-only": {}, "node:fs/promises": {}, "node:path": path,
    react: { cache: (fn: unknown) => fn },
    "@/lib/mongodb": { hasMongoConfig: () => true, getMongoClient: async () => ({ db: () => ({ collection: () => collection }) }) },
    "@/lib/audio-preview": { audioFileUrlForPath, async saveCatalogAudioUpload() {
      if (options.uploadFails) throw new Error("Upload failed");
      return { audioPath: "manual/new.mp3", publicUrl: "/api/audio-file?path=phoenix2%2Faudio_previews%2Fmanual%2Fnew.mp3" };
    } },
    "@/lib/catalog-version": catalogVersion,
    "@/lib/premium-songs": { isPremiumSong: () => false },
    "@/lib/song-chart-filters": {}, "@/lib/song-slug-filter": {},
    "@/lib/public-catalog": { invalidatePublicCatalog() { invalidations += 1; store.invalidate(); } },
  };
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", outputText)((name: string) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, loadedModule, loadedModule.exports);
  return { catalog: loadedModule.exports as typeof import("../src/lib/catalog.ts"), store, writes: () => writes, invalidations: () => invalidations };
}

const input = { title: "Updated", artist: "Artist", chartTokens: ["S20"] };
const upload = new File(["audio"], "sample.mp3", { type: "audio/mpeg" });

test("successful admin catalog update invalidates the shared public snapshot", async () => {
  const { catalog, store, invalidations } = fixture();
  const before = await store.getResponse("phoenix2");
  await catalog.updateCatalogSong("original-artist-phoenix2", input);
  const after = await store.getResponse("phoenix2");
  assert.equal(invalidations(), 1);
  assert.equal(after.snapshot.songs[0].title, "Updated");
  assert.notEqual(before.etag, after.etag);
});

test("successful audio upload invalidates and publishes only the resolved public URL", async () => {
  const { catalog, store, invalidations } = fixture();
  await store.getSnapshot("phoenix2");
  await catalog.updateCatalogSong("original-artist-phoenix2", input, upload);
  const result = await store.getResponse("phoenix2");
  assert.equal(invalidations(), 1);
  assert.match(result.snapshot.songs[0].previewUrl!, /^\/api\/audio-file\?/);
  assert.equal(result.body.includes("audioPath"), false);
});

for (const failure of ["writeFails", "uploadFails"] as const) {
  test(`failed ${failure === "writeFails" ? "database write" : "audio upload"} does not invalidate`, async () => {
    const { catalog, store, writes, invalidations } = fixture({ [failure]: true });
    const before = await store.getResponse("phoenix2");
    await assert.rejects(catalog.updateCatalogSong("original-artist-phoenix2", input, upload));
    assert.equal(invalidations(), 0);
    assert.equal(writes(), 0);
    assert.equal(await store.getResponse("phoenix2"), before);
  });
}

test("a committed mutation invalidates even if its subsequent response read fails", async () => {
  const { catalog, store, invalidations } = fixture({ responseReadFails: true });
  await store.getSnapshot("phoenix2");
  await assert.rejects(catalog.updateCatalogSong("original-artist-phoenix2", input), /Response read failed/);
  assert.equal(invalidations(), 1);
  assert.equal((await store.getSnapshot("phoenix2")).songs[0].title, "Updated");
});

test("an unmatched mutation does not invalidate unchanged data", async () => {
  const { catalog, invalidations } = fixture({ matched: false });
  await catalog.updateCatalogSong("original-artist-phoenix2", input);
  assert.equal(invalidations(), 0);
});

test("Phoenix source records resolve detail and admin lookups through canonical and legacy slugs", async () => {
  for (const slug of ["original-artist-phoenix", "original-artist-phoenix2"]) {
    const { catalog, store, invalidations } = fixture({ sourceVersion: "phoenix" });
    const detail = await catalog.getSongBySlug(slug, "phoenix");
    assert.equal(detail?.title, "Original");
    // Lookup compatibility does not rewrite existing search/detail DTO behavior.
    assert.equal(detail?.slug, "original-artist-phoenix2");
    await catalog.updateCatalogSong(slug, input, undefined, "phoenix");
    assert.equal(invalidations(), 1);
    assert.equal((await store.getSnapshot("phoenix2")).songs[0].slug, "updated-artist-phoenix");
  }
});
