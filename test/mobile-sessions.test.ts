import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { ObjectId } from "mongodb";
import ts from "typescript";

import * as chartRecommendation from "../src/lib/chart-recommendation.ts";
import * as catalogVersion from "../src/lib/catalog-version.ts";
import * as catalogSearchAliases from "../src/lib/catalog-search-aliases.ts";
import * as mobileAuthCore from "../src/lib/mobile-auth-core.ts";
import * as mongoIndexes from "../src/lib/mongo-indexes.ts";
import * as performanceFormat from "../src/lib/performance-format.ts";
import * as sessionCore from "../src/lib/performance-session.ts";
import * as sessionPagination from "../src/lib/performance-session-pagination.ts";
import * as piuVersion from "../src/lib/piu-version.ts";
import { selectedSongChart, songPagePath, songPageVersion } from "../src/lib/song-page-url.ts";

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
    if (expected && typeof expected === "object" && "$regex" in expected) {
      const expression = expected as { $regex: string | RegExp; $options?: string };
      const regex = new RegExp(expression.$regex, expression.$options);
      return (Array.isArray(actual) ? actual : [actual]).some((value) => typeof value === "string" && regex.test(value));
    }
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
    findOne: async (filter: Row) => rows.find((row) => matches(row, filter)) ?? null,
    countDocuments: async (filter: Row) => rows.filter((row) => matches(row, filter)).length,
    distinct: async (field: string, filter: Row) => rows.filter((row) => matches(row, filter)).flatMap((row) => row[field] ?? []),
    aggregate(pipeline: Row[]) {
      if (pipeline.some((stage) => "$facet" in stage)) return { toArray: async () => [{ folders: [], series: [], total: [{ count: rows.length }] }] };
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
    "@/lib/catalog-search-aliases": catalogSearchAliases,
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

function sessionsFixture(rows: Row[], catalog = catalogFixture().catalog, selectedVersion: "phoenix" | "phoenix2" = "phoenix2") {
  const cursors: Array<{ closed: boolean; reads: number }> = [];
  const requests: Array<{ offset?: number; limit?: number }> = [];
  let failCursor = false;
  const collection = {
    createIndex: async () => "test-index", indexes: async () => [],
    findOne: async () => ({ preferences: { piuGameVersion: selectedVersion } }),
    find(filter: Row) {
      assert.ok((filter.userId as ObjectId).equals(userId));
      assert.equal(filter.piuVersion, selectedVersion);
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
    "@/lib/piu-client": { createPiuClient: () => { throw new Error("Session reads must not contact PIUGAME"); } },
    "@/lib/chart-recommendation": chartRecommendation,
    "@/lib/catalog": catalog,
    "@/lib/mongo-indexes": mongoIndexes,
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
    "@/lib/performance": { getPerformanceSessionsPage: (id: string, args: { offset?: number; limit?: number }) => { requests.push(args); return performance.getPerformanceSessionsPage(id, args); } },
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
  assert.deepEqual(fixture.requests, [{ offset: 0, limit: 50 }]);
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

test("continuation reads only one boundary play and never maps the discarded long session", async () => {
  const returnedRows = Array.from({ length: 20 }, (_, index) => [play(index), play(index, 5)]).flat();
  const discardedRows = Array.from({ length: 300 }, (_, index) => play(20, index * 5));
  for (const row of discardedRows) {
    Object.defineProperty(row, "songName", { get: () => { throw new Error("Discarded session must not be mapped or enriched"); } });
  }
  const artworkRequests: string[][] = [];
  const catalog = {
    ...catalogFixture().catalog,
    getSongsByTitles: async (version: string, titles: string[]) => {
      assert.equal(version, "phoenix2");
      artworkRequests.push(titles);
      return new Map();
    },
  };
  const fixture = sessionsFixture([...returnedRows, ...discardedRows, play(90)], catalog);
  const body = await (await fixture.request("?offset=0&limit=20")).json() as { sessions: Session[]; nextOffset: number | null };
  assert.equal(body.nextOffset, 20);
  assert.deepEqual(body.sessions.map((session) => session.plays.map((entry) => entry.id)),
    Array.from({ length: 20 }, (_, index) => returnedRows.slice(index * 2, index * 2 + 2).map((row) => (row._id as ObjectId).toHexString())));
  assert.deepEqual(body.sessions.map((session) => session.summary.playCount), Array(20).fill(2));
  assert.equal(fixture.cursors[0].reads, 41, "40 returned plays plus one boundary proves continuation");
  assert.equal(fixture.cursors[0].closed, true);
  assert.deepEqual(artworkRequests, [returnedRows.map((row) => row.songName)]);
});

test("page boundaries exclude other accounts and versions without splitting the requested session", async () => {
  const otherUser = new ObjectId();
  const selectedRows = [play(0), play(0, 10), play(1), play(1, 10), play(2)];
  const fixture = sessionsFixture([
    selectedRows[0], play(0, 5, { userId: otherUser }), selectedRows[1],
    play(0, 20, { piuVersion: "phoenix" }), ...selectedRows.slice(2),
  ]);
  const first = await (await fixture.request("?limit=1")).json() as { sessions: Session[]; nextOffset: number | null };
  const second = await (await fixture.request("?offset=1&limit=1")).json() as { sessions: Session[]; nextOffset: number | null };
  assert.deepEqual([first.nextOffset, second.nextOffset], [1, 2]);
  assert.deepEqual(first.sessions[0].plays.map((entry) => entry.id), selectedRows.slice(0, 2).map((row) => (row._id as ObjectId).toHexString()));
  assert.deepEqual(second.sessions[0].plays.map((entry) => entry.id), selectedRows.slice(2, 4).map((row) => (row._id as ObjectId).toHexString()));
  assert.deepEqual(fixture.cursors.map((cursor) => cursor.reads), [3, 5]);
  assert.ok(fixture.cursors.every((cursor) => cursor.closed));
});

test("empty pages and exact final pages do not manufacture a continuation", async () => {
  const fixture = sessionsFixture(Array.from({ length: 20 }, (_, index) => play(index)));
  assert.equal((await (await fixture.request("?limit=20")).json()).nextOffset, null);
  assert.deepEqual(await (await fixture.request("?offset=20&limit=20")).json(), { sessions: [], nextOffset: null, selectedVersion: "phoenix2" });
});

test("session page reports the version used for play filtering and artwork on both editions", async () => {
  for (const version of ["phoenix", "phoenix2"] as const) {
    const artworkVersions: string[] = [];
    const catalog = {
      ...catalogFixture().catalog,
      getSongsByTitles: async (selected: string) => {
        artworkVersions.push(selected);
        return new Map();
      },
    };
    const fixture = sessionsFixture([play(0, 0, { piuVersion: version })], catalog, version);
    const first = await (await fixture.request("?limit=1")).json() as { selectedVersion: string; sessions: Session[] };
    const empty = await (await fixture.request("?offset=1&limit=1")).json() as { selectedVersion: string; sessions: Session[] };
    assert.equal(first.selectedVersion, version);
    assert.equal(first.sessions.length, 1);
    assert.equal(empty.selectedVersion, version);
    assert.deepEqual(empty.sessions, []);
    assert.deepEqual(artworkVersions, [version, version]);
  }
});

test("session helper does not invent a version when user identity is invalid", async () => {
  const fixture = sessionsFixture([]);
  assert.deepEqual(await fixture.performance.getPerformanceSessionsPage(null), { sessions: [], nextOffset: null, selectedVersion: null });
});

test("invalid pagination inputs use bounded defaults consistently in route and data helper", async () => {
  const fixture = sessionsFixture([play(0)]);
  await fixture.request("?offset=not-a-number&limit=Infinity");
  await fixture.request("?offset=-5&limit=999");
  await fixture.request("?offset=1020&limit=0");
  await fixture.request("?offset=9007199254740992&limit=garbage");
  assert.deepEqual(fixture.requests, [
    { offset: 0, limit: 50 }, { offset: 0, limit: 50 },
    { offset: 1020, limit: 1 }, { offset: 0, limit: 50 },
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

test("legacy Mongo search shares title aliases without renaming songs or bypassing filters", async () => {
  const examples = JSON.parse(readFileSync(new URL("./fixtures/catalog-search-aliases.json", import.meta.url), "utf8")) as {
    songs: Array<{ title: string; artist: string; slug: string }>;
    cases: Array<{ query: string; expectedSlugs: string[] }>;
  };
  const fixture = catalogFixture(examples.songs.map((song) => ({
    _id: new ObjectId(), songName: song.title, artist: song.artist, piuVersion: "phoenix2",
    supportedVersions: ["phoenix2"], folder: "WORLD MUSIC",
  })));
  for (const example of examples.cases) {
    const result = await fixture.catalog.searchSongs({ query: example.query });
    assert.equal(result.total, example.expectedSlugs.length, example.query);
    assert.deepEqual(result.songs.map((song) => song.slug).sort(), [...example.expectedSlugs].sort(), example.query);
    for (const found of result.songs) {
      const original = examples.songs.find((song) => song.slug === found.slug)!;
      assert.equal(found.title, original.title);
      assert.equal(found.artist, original.artist);
    }
  }
  assert.equal((await fixture.catalog.searchSongs({ query: "because", folders: ["K-POP"] })).total, 0);
  assert.equal((await fixture.catalog.searchSongs({ query: "because", supportedVersion: "phoenix" })).total, 0);
});


test("song-page lookup resolves A Nightmare charts by requested version with a stable slug", async () => {
  const fixture = catalogFixture([{
    _id: new ObjectId(), songName: "A Nightmare", artist: "Banya", piuVersion: "phoenix2",
    supportedVersions: ["phoenix", "phoenix2"], chartTokens: ["S3", "S6", "D15"],
    chartTokensByVersion: { phoenix: ["S3", "S6", "D14"], phoenix2: ["S3", "S6", "D15"] },
  }]);
  const phoenix = await fixture.catalog.getSongBySlug("a-nightmare-banya-phoenix2", "phoenix");
  const phoenix2 = await fixture.catalog.getSongBySlug("a-nightmare-banya-phoenix2", "phoenix2");
  assert.deepEqual(phoenix?.chartSummary, ["S3", "S6", "D14"]);
  assert.deepEqual(phoenix2?.chartSummary, ["S3", "S6", "D15"]);
  assert.equal(phoenix?.slug, phoenix2?.slug);
});

test("versioned canonical links round-trip colliding historical artists in either document order", async () => {
  const historical = {
    _id: new ObjectId(), songName: "ヨロピク ピクヨロ！ Yoropiku Pikuyoro !",
    artist: "バクステ外神田一丁目 Bakusute Sotokanda Icchome", piuVersion: "phoenix",
    supportedVersions: ["phoenix"], chartTokens: ["S3", "D5"],
    chartTokensByVersion: { phoenix: ["S3", "D5"] },
  };
  const current = {
    _id: new ObjectId(), songName: historical.songName, artist: "Bakusute Sotokanda Icchome", piuVersion: "phoenix2",
    supportedVersions: ["phoenix2"], chartTokens: ["S3", "D6"],
    chartTokensByVersion: { phoenix2: ["S3", "D6"] },
  };
  const slug = "yoropiku-pikuyoro-bakusute-sotokanda-icchome-phoenix2";
  for (const rows of [[historical, current], [current, historical]]) {
    const { catalog } = catalogFixture(rows);
    assert.equal((await catalog.getSongBySlug(slug))?.artist, rows[0].artist, "Unversioned community/editor identity must retain legacy selection");
    for (const [version, chart, expected] of [["phoenix", "D5", historical], ["phoenix2", "D6", current]] as const) {
      const song = await catalog.getSongBySlug(slug, version);
      assert.ok(song);
      assert.equal(song.artist, expected.artist);
      assert.equal(songPageVersion(song, version), version);
      assert.equal(selectedSongChart(chart, song.chartSummary), chart);
      const canonical = new URL(songPagePath(song, version), "https://example.com");
      const resolved = await catalog.getSongBySlug(canonical.pathname.slice("/songs/".length), version);
      assert.deepEqual(resolved?.chartSummary, expected.chartTokens);
      assert.equal(resolved?.artist, expected.artist);
    }
    const sourceAlias = await catalog.getSongBySlug(slug.replace(/-phoenix2$/, "-phoenix"), "phoenix");
    assert.ok(sourceAlias);
    const aliasCanonical = new URL(songPagePath(sourceAlias, "phoenix"), "https://example.com");
    const roundTrip = await catalog.getSongBySlug(aliasCanonical.pathname.slice("/songs/".length), "phoenix");
    assert.equal(roundTrip?.artist, historical.artist);
    assert.deepEqual(roundTrip?.chartSummary, ["S3", "D5"]);
  }
});
