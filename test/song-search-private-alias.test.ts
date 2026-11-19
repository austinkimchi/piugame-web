import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { NextRequest } from "next/server";
import ts from "typescript";
import * as catalogVersion from "../src/lib/catalog-version.ts";
import * as privateOverlay from "../src/lib/catalog-private-overlay.ts";
import * as chartRecommendation from "../src/lib/chart-recommendation.ts";
import * as mobileAuthCore from "../src/lib/mobile-auth-core.ts";
import * as performanceChartKey from "../src/lib/performance-chart-key.ts";
import * as piuVersion from "../src/lib/piu-version.ts";
import * as chartFilters from "../src/lib/song-chart-filters.ts";

type SearchRoute = typeof import("../src/app/api/songs/search/route.ts");
const source = readFileSync(new URL("../src/app/api/songs/search/route.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } });
const storageSlug = "original-artist-phoenix2";
const sourceSlug = "original-artist-phoenix";

function fixture(signedIn = true) {
  const song = { slug: sourceSlug, title: "Original", version: "phoenix", chartSummary: ["S18"], folder: "ORIGINAL", series: "PHOENIX" };
  const stored = new Set([storageSlug]);
  const searches: Array<{ favoriteSlugs?: Set<string>; favoritesOnly?: boolean }> = [];
  const snapshotVersions: string[] = [];
  const reads: string[][] = [];
  const recentOffsets: number[] = [];
  const user = signedIn ? { id: "fixture-user", preferences: { piuGameVersion: "phoenix" } } : null;
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/rate-limit": { checkRateLimit: () => true },
    "@/lib/catalog-version": catalogVersion,
    "@/lib/catalog-private-overlay": privateOverlay,
    "@/lib/chart-recommendation": chartRecommendation,
    "@/lib/mobile-auth-core": mobileAuthCore,
    "@/lib/mobile-auth": { authenticateMobileAccessToken: async () => null },
    "@/lib/performance-chart-key": performanceChartKey,
    "@/lib/piu-version": piuVersion,
    "@/lib/song-chart-filters": chartFilters,
    "@/lib/public-catalog": { getPublicCatalogSnapshot: async (version: string) => { snapshotVersions.push(version); return { songs: [song] }; } },
    "@/lib/auth": {
      getCurrentUser: async () => user,
      getUserById: async () => null,
      getAllFavoriteSongSlugs: async () => new Set(stored),
      getFavoriteSongSlugSet: async (_user: unknown, slugs: string[]) => { reads.push(slugs); return new Set(slugs.filter((slug) => stored.has(slug))); },
    },
    "@/lib/catalog": {
      searchSongs: async (options: { favoriteSlugs?: Set<string>; favoritesOnly?: boolean }) => {
        searches.push(options);
        const songs = options.favoritesOnly && !options.favoriteSlugs?.has(sourceSlug) ? [] : [song];
        return { songs, total: songs.length, nextCursor: null, filterOptions: { folders: [], series: [], levels: [], charts: [] } };
      },
      getSongsByTitles: async () => new Map([["original", song]]),
      getRecommendationCandidateSongs: async () => [song],
    },
    "@/lib/performance": {
      addChartRecommendationsToSongs: async (_id: unknown, _version: unknown, songs: unknown[]) => songs,
      getPerformanceRecentPlays: async (_id: unknown, options: { offset: number }) => {
        recentOffsets.push(options.offset);
        return { recentPlays: [{ songName: "Original", mode: "S", level: "18", score: 950_000, grade: "AAA" }], total: 50, nextOffset: 48 };
      },
      getPerformanceChartRecommendations: async () => [{ songName: "Original", chartToken: "S18" }],
    },
  };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", outputText)((name: string) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  return { route: loaded.exports as SearchRoute, stored, searches, snapshotVersions, reads, recentOffsets };
}

function request(query: string, extra: Record<string, string> = {}, authorization?: string): NextRequest {
  const url = new URL("https://example.test/api/songs/search");
  url.search = new URLSearchParams({ q: query, supportedVersion: "phoenix", ...extra }).toString();
  return Object.assign(new Request(url, authorization ? { headers: { Authorization: authorization } } : undefined), { nextUrl: url }) as NextRequest;
}

test("favorites-only and favorites-first include legacy stored keys before selecting public-source candidates", async () => {
  for (const [query, extra] of [["favorites", {}], ["", { favoritesFirst: "true" }]] as const) {
    const { route, searches, snapshotVersions } = fixture();
    const response = await route.GET(request(query, extra));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    const body = await response.json();
    assert.equal(body.songs[0].slug, sourceSlug);
    assert.equal(body.songs[0].isFavorite, true);
    assert.equal(searches[0].favoriteSlugs?.has(sourceSlug), true);
    assert.equal(searches[0].favoriteSlugs?.has(storageSlug), true);
    assert.deepEqual(snapshotVersions, ["phoenix"]);
  }
});

for (const query of ["recent", "recommendation", "ordinary query"]) {
  test(`${query} reads legacy saved state for a public-source alias and observes an unsave`, async () => {
    const { route, stored, reads, recentOffsets } = fixture();
    const response = await route.GET(request(query, query === "recent" ? { cursor: "24" } : {}));
    const body = await response.json();
    assert.equal(body.songs[0].isFavorite, true);
    assert.ok(reads[0].includes(storageSlug));
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    if (query === "recent") { assert.deepEqual(recentOffsets, [24]); assert.equal(body.nextCursor, "48"); }
    stored.clear();
    assert.equal((await (await route.GET(request(query))).json()).songs[0].isFavorite, false);
  });
}

test("private alias handling does not bypass guest or invalid-bearer authentication", async () => {
  const { route, snapshotVersions, reads } = fixture(false);
  assert.equal((await route.GET(request("favorites"))).status, 401);
  assert.equal((await route.GET(request("recent", {}, "Bearer invalid"))).status, 401);
  assert.deepEqual(snapshotVersions, []);
  assert.deepEqual(reads, []);
});
