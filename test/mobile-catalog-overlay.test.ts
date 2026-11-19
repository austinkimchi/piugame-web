import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

import * as privateOverlay from "../src/lib/catalog-private-overlay.ts";
import { catalogChartRecommendationMap } from "../src/lib/chart-recommendation.ts";
import type { CatalogChartRecommendations, ChartSelectionEvidence } from "../src/lib/chart-recommendation.ts";
import * as mobileAuthCore from "../src/lib/mobile-auth-core.ts";
import type { MobileCatalogOverlay } from "../src/lib/mobile-catalog-overlay-types.ts";
import * as piuVersion from "../src/lib/piu-version.ts";
import { buildPublicCatalogSnapshot } from "../src/lib/public-catalog-core.ts";
import type { PiuCatalogVersion } from "../src/lib/types.ts";

type Route = typeof import("../src/app/api/mobile/v1/catalog/overlay/route.ts");
type Failure = "auth" | "user" | "catalog" | "favorites" | "recommendations";
const sourceSlug = "original-artist-phoenix";
const storedSlug = "original-artist-phoenix2";
const otherSlug = "other-artist-phoenix2";
const source = readFileSync(new URL("../src/app/api/mobile/v1/catalog/overlay/route.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
});

function fixture(options: { fail?: Failure; missingUser?: boolean; recommendations?: CatalogChartRecommendations } = {}) {
  const calls = { auth: [] as Array<string | null>, users: [] as string[], catalogs: [] as string[], favorites: [] as string[], recommendations: [] as Array<{ userId: string; version: string }> };
  const stored = new Map([
    ["user-a", new Set([storedSlug, "outside-selected-catalog"])],
    ["user-b", new Set([otherSlug])],
  ]);
  const documents = [
    { songName: "Original", artist: "Artist", piuVersion: "phoenix", supportedVersions: ["phoenix", "phoenix2"], chartTokensByVersion: { phoenix: ["S16"], phoenix2: ["S18", "D20"] } },
    { songName: "Other", artist: "Artist", piuVersion: "phoenix2", supportedVersions: ["phoenix2"], chartTokens: ["S18", "D20"] },
  ];
  const snapshots = {
    phoenix: buildPublicCatalogSnapshot(documents.slice(0, 1), "phoenix"),
    phoenix2: buildPublicCatalogSnapshot(documents, "phoenix2"),
  };
  for (const snapshot of Object.values(snapshots)) {
    snapshot.songs.forEach(Object.freeze);
    Object.freeze(snapshot.songs);
    Object.freeze(snapshot);
  }
  const failure = (stage: Failure) => { if (options.fail === stage) throw new Error("private database detail must not leak"); };
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/mobile-auth-core": mobileAuthCore,
    "@/lib/piu-version": piuVersion,
    "@/lib/catalog-private-overlay": privateOverlay,
    "@/lib/mobile-auth": { async authenticateMobileAccessToken(token: string | null) {
      calls.auth.push(token); failure("auth");
      return token === "user-a" || token === "user-b" ? { userId: token } : null;
    } },
    "@/lib/auth": {
      async getUserById(userId: string) { calls.users.push(userId); failure("user"); return options.missingUser ? null : { id: userId, email: "private@example.test" }; },
      async getAllFavoriteSongSlugs(user: { id: string }) { calls.favorites.push(user.id); failure("favorites"); return new Set(stored.get(user.id)); },
    },
    "@/lib/public-catalog": { async getPublicCatalogSnapshot(version: PiuCatalogVersion) {
      calls.catalogs.push(version); failure("catalog"); return snapshots[version];
    } },
    "@/lib/performance": { async getCatalogChartRecommendations(userId: string, version: PiuCatalogVersion, songs: typeof snapshots.phoenix2.songs) {
      calls.recommendations.push({ userId, version }); failure("recommendations");
      assert.strictEqual(songs, snapshots[version].songs);
      if (options.recommendations) return options.recommendations;
      const evidence: ChartSelectionEvidence[] = [{ songName: "Original", mode: userId === "user-a" ? "S" : "D", level: userId === "user-a" ? "18" : "20", bestScore: 990000, latestPlayedAt: "2026-11-19T10:00:00Z" }];
      return catalogChartRecommendationMap(songs, evidence, new Date("2026-11-19T12:00:00Z"));
    } },
  };
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", outputText)((name: string) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected server dependency: ${name}`);
    return dependencies[name];
  }, loadedModule, loadedModule.exports);
  return { route: loadedModule.exports as Route, calls, stored, snapshots };
}

function request(query = "version=phoenix2", authorization: string | null = "Bearer user-a", extraHeaders: Record<string, string> = {}) {
  return new Request(`https://example.test/api/mobile/v1/catalog/overlay?${query}`, {
    headers: { ...(authorization ? { Authorization: authorization } : {}), ...extraHeaders },
  });
}

function privateHeaders(response: Response) {
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("Pragma"), "no-cache");
  assert.equal(response.headers.get("Vary"), "Authorization");
  assert.equal(response.headers.get("ETag"), null);
}

test("overlay reads the complete selected snapshot and private sources once, returning only public identities and chart tokens", async () => {
  const { route, calls, snapshots } = fixture();
  const before = JSON.stringify(snapshots);
  const response = await route.GET(request());
  assert.equal(response.status, 200); privateHeaders(response);
  const body = await response.json() as MobileCatalogOverlay;
  assert.deepEqual(Object.keys(body).sort(), ["favoriteSlugs", "recommendations", "schemaVersion", "version"]);
  assert.equal(body.schemaVersion, 1);
  assert.equal(body.version, "phoenix2");
  assert.deepEqual(body.favoriteSlugs, [sourceSlug]);
  assert.equal(body.recommendations[sourceSlug].all, "S18");
  assert.equal(Object.keys(body.recommendations[sourceSlug]).length, 16);
  assert.equal(body.recommendations[sourceSlug].SD, "S18");
  assert.deepEqual(calls, { auth: ["user-a"], users: ["user-a"], catalogs: ["phoenix2"], favorites: ["user-a"], recommendations: [{ userId: "user-a", version: "phoenix2" }] });
  assert.equal(JSON.stringify(snapshots), before);
  assert.doesNotMatch(JSON.stringify(body), /bestScore|latestPlayedAt|email|private@example|outside-selected-catalog/);
});

for (const authorization of [null, "Basic user-a", "Bearer revoked", "Bearer expired", "Bearer user-a extra"]) {
  test(`invalid bearer authorization ${authorization} never reads private/catalog data or falls back to cookies`, async () => {
    const { route, calls } = fixture();
    const response = await route.GET(request("version=phoenix2", authorization, { Cookie: "session=other-account" }));
    assert.equal(response.status, 401); privateHeaders(response);
    assert.deepEqual(await response.json(), { error: "invalid_token" });
    assert.deepEqual(calls.users, []); assert.deepEqual(calls.catalogs, []);
    assert.deepEqual(calls.favorites, []); assert.deepEqual(calls.recommendations, []);
  });
}

test("a removed account returns401 before overlay reads", async () => {
  const { route, calls } = fixture({ missingUser: true });
  const response = await route.GET(request());
  assert.equal(response.status, 401); privateHeaders(response);
  assert.deepEqual(calls.catalogs, []); assert.deepEqual(calls.favorites, []);
});

for (const query of ["", "version=xx", "version=PHOENIX2", "version=phoenix&version=phoenix2", "version=phoenix2&removed=1", "version=phoenix2&removed=0"]) {
  test(`unsupported overlay query ${query} returns400 without data reads`, async () => {
    const { route, calls } = fixture();
    const response = await route.GET(request(query));
    assert.equal(response.status, 400); privateHeaders(response);
    assert.deepEqual(calls.catalogs, []); assert.deepEqual(calls.favorites, []); assert.deepEqual(calls.recommendations, []);
  });
}

test("Phoenix uses its selected charts and matching performance version", async () => {
  const { route, calls } = fixture();
  const response = await route.GET(request("version=phoenix"));
  assert.equal(response.status, 200);
  const body = await response.json() as MobileCatalogOverlay;
  assert.equal(body.version, "phoenix");
  assert.deepEqual(body.favoriteSlugs, [sourceSlug]);
  assert.equal(body.recommendations[sourceSlug].all, "S16");
  assert.ok(Object.values(body.recommendations[sourceSlug]).every((token) => token === null || token === "S16"));
  assert.deepEqual(calls.recommendations, [{ userId: "user-a", version: "phoenix" }]);
});

test("concurrent accounts remain isolated and client-supplied userId cannot choose another account", async () => {
  const { route, calls } = fixture();
  const [a, b] = await Promise.all([
    route.GET(request("version=phoenix2&userId=user-b")),
    route.GET(request("version=phoenix2", "Bearer user-b")),
  ]);
  privateHeaders(a); privateHeaders(b);
  const [first, second] = await Promise.all([a.json(), b.json()]) as MobileCatalogOverlay[];
  assert.deepEqual(first.favoriteSlugs, [sourceSlug]);
  assert.deepEqual(second.favoriteSlugs, [otherSlug]);
  assert.equal(first.recommendations[sourceSlug].all, "S18");
  assert.equal(second.recommendations[sourceSlug].all, "D20");
  assert.deepEqual(calls.favorites.sort(), ["user-a", "user-b"]);
  assert.equal(calls.recommendations.length, 2);
});

test("fresh requests reconcile legacy Phoenix unsaves and never use conditional/shared cached data", async () => {
  const { route, stored, calls } = fixture();
  assert.deepEqual((await (await route.GET(request())).json()).favoriteSlugs, [sourceSlug]);
  stored.get("user-a")!.delete(storedSlug);
  const after = await route.GET(request("version=phoenix2", "Bearer user-a", { "If-None-Match": "*" }));
  assert.equal(after.status, 200); privateHeaders(after);
  assert.deepEqual((await after.json()).favoriteSlugs, []);
  assert.equal(calls.favorites.length, 2);
  assert.equal(calls.recommendations.length, 2);
});

for (const fail of ["auth", "user", "catalog", "favorites", "recommendations"] as const) {
  test(`${fail} failure returns a private safe503 rather than empty successful personalization`, async () => {
    const { route } = fixture({ fail });
    const response = await route.GET(request());
    assert.equal(response.status, 503); privateHeaders(response);
    assert.deepEqual(await response.json(), { error: "catalog_overlay_unavailable" });
  });
}

test("response projection excludes unrelated songs, evidence fields, invalid mode keys and unavailable chart tokens", async () => {
  const recommendations = {
    [sourceSlug]: { all: "S18", S: "S99", D: null, SS: "S18", bestScore: "990000", evidence: { private: true } },
    "unrelated-private-song": { all: "S18" },
  } as unknown as CatalogChartRecommendations;
  const { route } = fixture({ recommendations });
  const response = await route.GET(request());
  assert.deepEqual((await response.json()).recommendations, { [sourceSlug]: { all: "S18", D: null } });
});
