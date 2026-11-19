import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

import { createPublicCatalogStore, PublicCatalogUnavailableError, PUBLIC_CATALOG_TTL_MS } from "../src/lib/public-catalog-cache.ts";
import * as songPageUrl from "../src/lib/song-page-url.ts";
import type { PublicCatalogDocument } from "../src/lib/public-catalog-core.ts";

type SitemapModule = typeof import("../src/app/sitemap.ts");
const { outputText } = ts.transpileModule(readFileSync(new URL("../src/app/sitemap.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});

function fixture() {
  let reads = 0;
  let now = 0;
  let unavailable = false;
  const documents: PublicCatalogDocument[] = Array.from({ length: 675 }, (_, index) => ({
    songName: `Catalog Song ${index}`, songKey: `Catalog Song ${index}`, artist: "Fixture Artist",
    piuVersion: "phoenix2", supportedVersions: ["phoenix2"], images: [`jacket-${index}.png`],
    chartTokens: ["S15"], audioPath: "/private/manual.wav",
  }));
  const store = createPublicCatalogStore(async () => {
    if (unavailable) throw new Error("Fixture database unavailable");
    return { find(filter) {
      assert.deepEqual(filter, { supportedVersions: "phoenix2" });
      reads += 1;
      return { toArray: async () => documents };
    } };
  }, () => now);
  const dependencies: Record<string, unknown> = {
    "@/lib/public-catalog": { getPublicCatalogSnapshot: store.getSnapshot },
    "@/lib/song-page-url": songPageUrl,
    "@/lib/site": { absoluteSiteUrl: (value: string) => new URL(value, "https://example.com").href },
  };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", outputText)((name: string) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  return {
    module: loaded.exports as SitemapModule, reads: () => reads, documents, store,
    expire: () => { now += PUBLIC_CATALOG_TTL_MS + 1; },
    disconnect: () => { unavailable = true; store.invalidate(); },
  };
}

test("sitemap stays dynamic and emits complete catalog slugs instead of build-time jacket placeholders", async () => {
  const f = fixture();
  assert.equal(f.module.runtime, "nodejs");
  assert.equal(f.module.dynamic, "force-dynamic", "credential-free builds must not prerender a catalog fallback");
  assert.equal(f.reads(), 0, "module import must not read the catalog during build");
  const entries = await f.module.default();
  assert.equal(entries.length, 677);
  assert.deepEqual(entries.slice(0, 2).map((entry) => entry.url), ["https://example.com/", "https://example.com/privacy"]);
  assert.ok(entries.some((entry) => entry.url === "https://example.com/songs/catalog-song-674-fixture-artist-phoenix2?version=phoenix2"));
  assert.ok(entries.every((entry) => !entry.url.includes("/songs/phoenix2-jacket-")));
  assert.ok(entries.every((entry) => entry.lastModified === undefined), "generation time is not a catalog modification timestamp");
  assert.ok(entries.some((entry) => entry.images?.includes("https://example.com/assets/piu/phoenix2/song_img2/jacket-674.png")));
  assert.ok(!JSON.stringify(entries).includes("/private/"));
});

test("sitemap reuses the public cache, refreshes after writes or expiry, and never falls back on failure", async () => {
  const f = fixture();
  const [first, second] = await Promise.all([f.module.default(), f.module.default()]);
  assert.deepEqual(first, second);
  assert.equal(f.reads(), 1);
  f.documents[0].songName = "Changed catalog title";
  f.store.invalidate();
  assert.ok((await f.module.default()).some((entry) => entry.url.endsWith("/changed-catalog-title-fixture-artist-phoenix2?version=phoenix2")));
  assert.equal(f.reads(), 2);
  f.expire();
  await f.module.default();
  assert.equal(f.reads(), 3);
  f.disconnect();
  await assert.rejects(f.module.default, PublicCatalogUnavailableError);
});
