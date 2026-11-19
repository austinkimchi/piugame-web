import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

import { createPublicCatalogStore, PublicCatalogUnavailableError, PUBLIC_CATALOG_TTL_MS } from "../src/lib/public-catalog-cache.ts";
import type { PublicCatalogDocument } from "../src/lib/public-catalog-core.ts";
import * as catalogPrivateOverlay from "../src/lib/catalog-private-overlay.ts";
import * as songPageUrl from "../src/lib/song-page-url.ts";

type SitemapModule = typeof import("../src/app/sitemap.ts");
const { outputText } = ts.transpileModule(readFileSync(new URL("../src/app/sitemap.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});

function fixture() {
  const reads: Record<string, number> = { phoenix: 0, phoenix2: 0 };
  let now = 0;
  let unavailableVersion: string | null = null;
  const documents: PublicCatalogDocument[] = Array.from({ length: 675 }, (_, index) => ({
    songName: `Catalog Song ${index}`, songKey: `Catalog Song ${index}`, artist: "Fixture Artist",
    piuVersion: "phoenix2", supportedVersions: index >= 2 && index < 619 ? ["phoenix", "phoenix2"] : ["phoenix2"],
    images: [`jacket-${index}.png`], chartTokens: ["S15"], audioPath: "/private/manual.wav",
  }));
  for (const [index, title] of ["甘い誘惑デインジャラス Amai Yuuwaku Dangerous", "ヨロピク ピクヨロ！ Yoropiku Pikuyoro !"].entries()) {
    Object.assign(documents[index], { songName: title, songKey: title, artist: "Bakusute Sotokanda Icchome" });
    documents.push({ ...documents[index], artist: "バクステ外神田一丁目 Bakusute Sotokanda Icchome", piuVersion: "phoenix", supportedVersions: ["phoenix"], removedFromVersions: ["phoenix2"] });
  }
  for (let index = 0; index < 20; index += 1) {
    const title = index === 0 ? "After LIKE" : `Historical Song ${index}`;
    documents.push({ songName: title, songKey: title, artist: index === 0 ? "IVE" : "Historical Artist",
      piuVersion: "phoenix", supportedVersions: ["phoenix"], removedFromVersions: ["phoenix2"],
      images: [`historical-${index}.png`], chartTokens: ["D23"], audioPath: "/private/historical.wav" });
  }
  const store = createPublicCatalogStore(async () => {
    return { find(filter) {
      const version = filter.supportedVersions;
      assert.ok(version === "phoenix" || version === "phoenix2");
      assert.deepEqual(filter, { supportedVersions: version });
      reads[version] += 1;
      return { toArray: async () => {
        if (unavailableVersion === version) throw new Error("Fixture database unavailable");
        return documents.filter((document) => (document.supportedVersions as string[]).includes(version));
      } };
    } };
  }, () => now);
  const dependencies: Record<string, unknown> = {
    "@/lib/public-catalog": { getPublicCatalogSnapshot: store.getSnapshot },
    "@/lib/site": { absoluteSiteUrl: (value: string) => new URL(value, "https://example.com").href },
    "@/lib/catalog-private-overlay": catalogPrivateOverlay,
    "@/lib/song-page-url": songPageUrl,
  };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", outputText)((name: string) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  return {
    module: loaded.exports as SitemapModule, reads: () => ({ ...reads }), documents, store,
    expire: () => { now += PUBLIC_CATALOG_TTL_MS + 1; },
    disconnect: (version: string) => { unavailableVersion = version; store.invalidate(); },
  };
}

test("sitemap stays dynamic and emits complete catalog slugs instead of build-time jacket placeholders", async () => {
  const f = fixture();
  assert.equal(f.module.runtime, "nodejs");
  assert.equal(f.module.dynamic, "force-dynamic", "credential-free builds must not prerender a catalog fallback");
  assert.deepEqual(f.reads(), { phoenix: 0, phoenix2: 0 }, "module import must not read the catalog during build");
  const entries = await f.module.default();
  assert.equal(entries.length, 697);
  assert.deepEqual(entries.slice(0, 2).map((entry) => entry.url), ["https://example.com/", "https://example.com/privacy"]);
  assert.ok(entries.some((entry) => entry.url === "https://example.com/songs/catalog-song-674-fixture-artist-phoenix2?version=phoenix2"));
  assert.ok(entries.every((entry) => !entry.url.includes("/songs/phoenix2-jacket-")));
  assert.ok(entries.every((entry) => entry.lastModified === undefined), "generation time is not a catalog modification timestamp");
  assert.ok(entries.some((entry) => entry.images?.includes("https://example.com/assets/piu/phoenix2/song_img2/jacket-674.png")));
  assert.ok(!JSON.stringify(entries).includes("/private/"));
});

test("sitemap adds only distinct historical identities and excludes shared and colliding aliases", async () => {
  const f = fixture();
  const current = await f.store.getSnapshot("phoenix2");
  const historical = await f.store.getSnapshot("phoenix");
  assert.equal(current.total, 675);
  assert.equal(historical.total, 639);
  const entries = await f.module.default();
  const urls = entries.map((entry) => entry.url);
  assert.equal(new Set(urls).size, urls.length);
  assert.equal(urls.filter((url) => url.endsWith("?version=phoenix2")).length, 675);
  assert.equal(urls.filter((url) => url.endsWith("?version=phoenix")).length, 20);
  const afterLike = entries.find((entry) => entry.url === "https://example.com/songs/after-like-ive-phoenix2?version=phoenix");
  assert.deepEqual(afterLike?.images, ["https://example.com/assets/piu/phoenix/song_img/historical-0.png"]);
  for (const slug of ["catalog-song-2-fixture-artist-phoenix2", "amai-yuuwaku-dangerous-bakusute-sotokanda-icchome-phoenix2", "yoropiku-pikuyoro-bakusute-sotokanda-icchome-phoenix2"]) {
    assert.ok(urls.includes(`https://example.com/songs/${slug}?version=phoenix2`));
    assert.ok(!urls.includes(`https://example.com/songs/${slug}?version=phoenix`));
  }
  assert.ok(urls.every((url) => !url.includes("chart=")));
  assert.equal(historical.songs.find((song) => song.title === "After LIKE")?.slug, "after-like-ive-phoenix", "Cached public snapshots must not be mutated");
});

test("sitemap reuses both public caches and refreshes after writes or expiry", async () => {
  const f = fixture();
  const [first, second] = await Promise.all([f.module.default(), f.module.default()]);
  assert.deepEqual(first, second);
  assert.deepEqual(f.reads(), { phoenix: 1, phoenix2: 1 });
  f.documents[2].songName = "Changed catalog title";
  f.store.invalidate();
  assert.ok((await f.module.default()).some((entry) => entry.url.endsWith("/changed-catalog-title-fixture-artist-phoenix2?version=phoenix2")));
  assert.deepEqual(f.reads(), { phoenix: 2, phoenix2: 2 });
  f.expire();
  await f.module.default();
  assert.deepEqual(f.reads(), { phoenix: 3, phoenix2: 3 });
});

test("either unavailable public source rejects the whole sitemap instead of returning a partial fallback", async () => {
  for (const version of ["phoenix", "phoenix2"]) {
    const f = fixture();
    await f.module.default();
    f.disconnect(version);
    await assert.rejects(f.module.default, PublicCatalogUnavailableError);
  }
});
