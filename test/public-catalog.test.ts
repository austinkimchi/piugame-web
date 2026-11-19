import assert from "node:assert/strict";
import test from "node:test";
import { buildPublicCatalogSnapshot, PUBLIC_CATALOG_PROJECTION } from "../src/lib/public-catalog-core.ts";
import { createPublicCatalogStore, PublicCatalogUnavailableError } from "../src/lib/public-catalog-cache.ts";
import { PUBLIC_CATALOG_CACHE_CONTROL, publicCatalogHttpResponse } from "../src/lib/public-catalog-http.ts";
import type { PublicCatalogDocument } from "../src/lib/public-catalog-core.ts";
import { SUPPORTED_PIU_SERIES } from "../src/lib/catalog-version.ts";

function song(overrides: PublicCatalogDocument = {}): PublicCatalogDocument {
  return {
    songName: "Song A", songKey: "catalog-key-123", artist: "Artist", piuVersion: "phoenix",
    supportedVersions: ["phoenix", "phoenix2"], removedFromVersions: [],
    folder: "Original", series: "Phoenix 2", chartTokens: ["S19"],
    chartTokensByVersion: { phoenix: ["S18"], phoenix2: ["S20", "D22", "CX2"] },
    ...overrides,
  };
}

function fixture(initial: PublicCatalogDocument[] = [song()], now?: () => number) {
  let documents = initial;
  let failure = false;
  const reads: Array<{ filter: Record<string, string>; projection: unknown }> = [];
  const store = createPublicCatalogStore(async () => ({
    find(filter, { projection }) {
      reads.push({ filter, projection });
      return { async toArray() {
        if (failure) throw new Error("mongodb://private-user:private-password@private-host");
        const [field, version] = Object.entries(filter)[0];
        return documents.filter((document) => (document[field] as string[] | undefined)?.includes(version));
      } };
    },
  }), now);
  return { store, reads, setDocuments(value: PublicCatalogDocument[]) { documents = value; }, fail(value: boolean) { failure = value; } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("full snapshot uses one projection read with no count, distinct, limit or cursor", async () => {
  const input = Array.from({ length: 1001 }, (_, i) => song({ songName: `Song ${i}` }));
  const { store, reads } = fixture(input);
  const snapshot = await store.getSnapshot("phoenix2");
  assert.equal(snapshot.total, 1001);
  assert.equal(snapshot.songs.length, 1001);
  assert.equal(snapshot.songs[0].folderSongCount, 1001);
  assert.equal(snapshot.songs[0].seriesSongCount, 1001);
  assert.equal("nextCursor" in snapshot, false);
  assert.deepEqual(reads, [{ filter: { supportedVersions: "phoenix2" }, projection: PUBLIC_CATALOG_PROJECTION }]);
  assert.deepEqual(snapshot.filterOptions, { folders: ["Original"], series: ["PHOENIX 2"], levels: ["20", "22"], charts: ["singles", "doubles", "co-op"] });
});

test("public DTO strips every non-allowlisted top-level and nested field", () => {
  const event = { date: "2026-01-01", type: "changed", version: "phoenix2", note: "Public note", credentials: "PRIVATE", audioPath: "PRIVATE" };
  const snapshot = buildPublicCatalogSnapshot([song({
    audioPath: "manual/example.mp3", credentials: "PRIVATE", isFavorite: true,
    recentPlay: { score: 999999 }, recommendation: { chartToken: "S20" }, recommendedChartToken: "S20",
    history: [event, { ...event, type: "private" }],
    chartHistory: [{ ...event, id: "chart-event", chartId: "chart", chartToken: "S20", previousChartToken: "S19" }],
    chartLinks: [{ id: "chart", private: "PRIVATE", tokens: { phoenix: "S18", phoenix2: "S20", private: "PRIVATE" } }],
    chartTokensByVersion: { phoenix: ["S18"], phoenix2: ["S20"], private: ["PRIVATE"] },
    audioPreview: { localPath: "PRIVATE", confidence: "PRIVATE", reviewRequired: "PRIVATE" },
  })], "phoenix2");
  const result = snapshot.songs[0];
  assert.deepEqual(Object.keys(result).sort(), ["slug", "songKey", "title", "artist", "version", "supportedVersions", "removedFromVersions", "history", "chartHistory", "chartLinks", "imageUrl", "previewUrl", "previewAvailable", "bpm", "chartSummary", "chartTokensByVersion", "folder", "folderPosition", "folderSongCount", "series", "seriesSongCount", "tags", "isPremium"].sort());
  assert.deepEqual(result.history, [{ date: "2026-01-01", type: "changed", version: "phoenix2", note: "Public note" }]);
  assert.deepEqual(result.chartHistory, [{ id: "chart-event", date: "2026-01-01", type: "changed", version: "phoenix2", note: "Public note", chartId: "chart", chartToken: "S20", previousChartToken: "S19" }]);
  assert.deepEqual(result.chartLinks, [{ id: "chart", tokens: { phoenix: "S18", phoenix2: "S20" } }]);
  assert.deepEqual(result.chartTokensByVersion, { phoenix: ["S18"], phoenix2: ["S20"] });
  assert.equal(JSON.stringify(snapshot).includes("PRIVATE"), false);
  assert.equal(JSON.stringify(snapshot).includes("audioPath"), false);
  assert.equal(result.previewUrl, "/api/audio-file?path=phoenix%2Faudio_previews%2Fmanual%2Fexample.mp3");
});

test("source version, slug, image and songKey remain record-derived in selected and removed views", async () => {
  const { store } = fixture([song({ removedFromVersions: ["phoenix2"], images: ["cover.png"] })]);
  for (const removed of [false, true]) {
    const snapshot = await store.getSnapshot("phoenix2", { removed });
    const value = snapshot.songs[0];
    assert.equal(snapshot.selectedVersion, "phoenix2");
    assert.equal(snapshot.view, removed ? "removed" : "supported");
    assert.equal(value.version, "phoenix");
    assert.equal(value.slug, "song-a-artist-phoenix");
    assert.equal(value.songKey, "catalog-key-123");
    assert.equal(value.imageUrl, "/assets/piu/phoenix/song_img/cover.png");
    assert.deepEqual(value.chartSummary, ["S20", "D22", "C2"]);
  }
});

test("empty selected-version charts are authoritative, with legacy fallback only when absent", () => {
  const snapshot = buildPublicCatalogSnapshot([
    song({ songName: "Empty", chartTokensByVersion: { phoenix2: [] } }),
    song({ songName: "Legacy", chartTokensByVersion: {} }),
    song({ songName: "Full", chartTokensByVersion: null, chartTokens: [], chartsFull: [{ token: "D16" }, { mode: "S", level: "7" }] }),
  ], "phoenix2");
  assert.deepEqual(snapshot.songs.map((value) => [value.title, value.chartSummary]), [["Empty", []], ["Full", ["D16", "S7"]], ["Legacy", ["S19"]]]);
});

test("history and links are preserved without arbitrary row truncation", () => {
  const history = Array.from({ length: 200 }, (_, i) => ({ date: `event-${i}`, type: "added", version: "phoenix", note: "Note" }));
  const chartHistory = history.map((event, i) => ({ ...event, id: String(i), chartId: "chart", chartToken: "S18" }));
  const result = buildPublicCatalogSnapshot([song({ history, chartHistory })], "phoenix");
  assert.equal(result.songs[0].history.length, 200);
  assert.equal(result.songs[0].chartHistory.length, 200);
});

test("removed/version cache entries are isolated and use the matching Mongo membership field", async () => {
  const { store, reads } = fixture([
    song({ songName: "Only Phoenix", supportedVersions: ["phoenix"], removedFromVersions: ["phoenix2"] }),
    song({ songName: "Only Phoenix2", supportedVersions: ["phoenix2"] }),
  ]);
  assert.equal((await store.getSnapshot("phoenix")).songs[0].title, "Only Phoenix");
  assert.equal((await store.getSnapshot("phoenix2")).songs[0].title, "Only Phoenix2");
  assert.equal((await store.getSnapshot("phoenix2", { removed: true })).songs[0].title, "Only Phoenix");
  assert.equal((await store.getSnapshot("phoenix", { removed: true })).total, 0);
  assert.deepEqual(reads.map((read) => read.filter), [{ supportedVersions: "phoenix" }, { supportedVersions: "phoenix2" }, { removedFromVersions: "phoenix2" }, { removedFromVersions: "phoenix" }]);
});

test("all historical series use their own membership and charts while preserving record source identity", async () => {
  const ids = SUPPORTED_PIU_SERIES.map((series) => series.id);
  const { store, reads } = fixture([song({
    supportedVersions: ids,
    chartTokensByVersion: Object.fromEntries(ids.map((id, index) => [id, id === "xx" ? [] : [`S${index + 1}`]])),
  })]);
  for (const [index, id] of ids.entries()) {
    const response = await publicCatalogHttpResponse(new Request(`https://example.test/api/catalog/v1/${id}`), id, store.getResponse);
    assert.equal(response.status, 200);
    const snapshot = await response.json();
    assert.equal(snapshot.selectedVersion, id);
    assert.equal(snapshot.total, 1);
    assert.equal(snapshot.songs[0].version, "phoenix");
    assert.equal(snapshot.songs[0].slug, "song-a-artist-phoenix");
    assert.deepEqual(snapshot.songs[0].chartSummary, id === "xx" ? [] : [`S${index + 1}`]);
    assert.deepEqual(reads[index].filter, { supportedVersions: id });
  }
});

test("a historical series without matching records is explicitly empty, never filled from another series", async () => {
  const { store } = fixture();
  const snapshot = await store.getSnapshot("zero-1st");
  assert.equal(snapshot.selectedVersion, "zero-1st");
  assert.equal(snapshot.total, 0);
  assert.deepEqual(snapshot.songs, []);
  assert.deepEqual(snapshot.filterOptions, { folders: [], series: [], levels: [], charts: [] });
});

test("concurrent requests and later hits share a single read", async () => {
  const { store, reads } = fixture();
  const responses = await Promise.all(Array.from({ length: 30 }, () => store.getResponse("phoenix2")));
  assert.equal(reads.length, 1);
  assert.ok(responses.every((response) => response === responses[0]));
  assert.equal(await store.getResponse("phoenix2"), responses[0]);
  assert.equal(reads.length, 1);
});

test("cache expires at 30 seconds and starts the TTL when the read starts", async () => {
  let now = 0;
  const { store, reads } = fixture(undefined, () => now);
  await store.getSnapshot("phoenix2");
  now = 29_999;
  await store.getSnapshot("phoenix2");
  assert.equal(reads.length, 1);
  now = 30_000;
  await store.getSnapshot("phoenix2");
  assert.equal(reads.length, 2);
});

test("time spent reading Mongo consumes the cache TTL", async () => {
  let now = 0;
  let reads = 0;
  const store = createPublicCatalogStore(async () => ({ find() {
    reads += 1;
    return { async toArray() { now += 20_000; return [song()]; } };
  } }), () => now);
  await store.getSnapshot("phoenix2");
  now = 30_000;
  await store.getSnapshot("phoenix2");
  assert.equal(reads, 2);
});

test("serialization and ETags ignore Mongo row order and nested map insertion order", async () => {
  const first = song({ songName: "Duplicate", chartTokensByVersion: { phoenix: ["S18"], phoenix2: ["S20"] } });
  const second = song({ songName: "Duplicate", artist: "Another", chartTokensByVersion: { phoenix2: ["S20"], phoenix: ["S18"] } });
  const a = await fixture([first, second]).store.getResponse("phoenix2");
  const b = await fixture([second, first]).store.getResponse("phoenix2");
  assert.equal(a.body, b.body);
  assert.equal(a.etag, b.etag);
  assert.match(a.etag, /^"[a-f0-9]{64}"$/);
  const changed = await fixture([first, { ...second, artist: "Changed" }]).store.getResponse("phoenix2");
  assert.notEqual(a.etag, changed.etag);
});

test("cached DTOs are deeply immutable and cannot acquire SSR personalization", async () => {
  const { store } = fixture();
  const snapshot = await store.getSnapshot("phoenix2");
  assert.throws(() => { snapshot.songs[0].title = "Changed"; }, TypeError);
  assert.throws(() => { snapshot.songs[0].chartSummary.push("S99"); }, TypeError);
  assert.equal((await store.getSnapshot("phoenix2")).songs[0].title, "Song A");
});

test("invalidation refreshes all version/view entries", async () => {
  const { store, reads } = fixture([song({ removedFromVersions: ["phoenix2"] })]);
  await store.getSnapshot("phoenix");
  await store.getSnapshot("phoenix2");
  await store.getSnapshot("phoenix2", { removed: true });
  store.invalidate();
  await store.getSnapshot("phoenix");
  await store.getSnapshot("phoenix2");
  await store.getSnapshot("phoenix2", { removed: true });
  assert.equal(reads.length, 6);
});

for (const oldFails of [false, true]) {
  test(`invalidation during a pending ${oldFails ? "failed" : "successful"} read cannot repopulate or return stale data`, async () => {
    const old = deferred<PublicCatalogDocument[]>();
    const started = deferred<void>();
    let reads = 0;
    const store = createPublicCatalogStore(async () => ({ find() {
      const read = ++reads;
      return { toArray() { if (read === 1) { started.resolve(); return old.promise; } return Promise.resolve([song({ songName: "New" })]); } };
    } }));
    const pending = store.getResponse("phoenix2");
    await started.promise;
    store.invalidate();
    const current = await store.getResponse("phoenix2");
    if (oldFails) old.reject(new Error("Old read failed"));
    else old.resolve([song({ songName: "Old" })]);
    assert.equal(await pending, current);
    assert.equal(current.snapshot.songs[0].title, "New");
    assert.equal(await store.getResponse("phoenix2"), current);
    assert.equal(reads, 2);
  });
}

test("database failure rejects safely, never caches a fallback, and allows recovery", async () => {
  const { store, fail, reads } = fixture();
  fail(true);
  await assert.rejects(store.getSnapshot("phoenix2"), (error: unknown) => {
    assert.ok(error instanceof PublicCatalogUnavailableError);
    assert.equal(error.code, "PUBLIC_CATALOG_UNAVAILABLE");
    assert.equal(error.message.includes("private"), false);
    return true;
  });
  fail(false);
  assert.equal((await store.getSnapshot("phoenix2")).total, 1);
  assert.equal(reads.length, 2);
});

test("expired data is not served on database failure", async () => {
  let now = 0;
  const { store, fail } = fixture(undefined, () => now);
  await store.getSnapshot("phoenix2");
  fail(true);
  now = 30_000;
  await assert.rejects(store.getSnapshot("phoenix2"), PublicCatalogUnavailableError);
});

test("GET returns complete deterministic bytes and HEAD shares headers without a body", async () => {
  const { store, reads } = fixture();
  const get = await publicCatalogHttpResponse(new Request("https://example.test/api/catalog/v1/phoenix2"), "phoenix2", store.getResponse);
  assert.equal(get.status, 200);
  assert.equal(get.headers.get("Cache-Control"), PUBLIC_CATALOG_CACHE_CONTROL);
  assert.equal(get.headers.get("Set-Cookie"), null);
  const body = await get.text();
  assert.equal(body, (await store.getResponse("phoenix2")).body);
  const head = await publicCatalogHttpResponse(new Request("https://example.test/api/catalog/v1/phoenix2", { method: "HEAD" }), "phoenix2", store.getResponse);
  assert.deepEqual([...head.headers], [...get.headers]);
  assert.equal(await head.text(), "");
  assert.equal(reads.length, 1);
});

test("If-None-Match supports exact, weak, list and wildcard validators for GET and HEAD", async () => {
  const { store } = fixture();
  const { etag } = await store.getResponse("phoenix2");
  for (const method of ["GET", "HEAD"]) {
    for (const validator of [etag, `W/${etag}`, `"other", W/${etag}`, "*"]) {
      const response = await publicCatalogHttpResponse(new Request("https://example.test", { method, headers: { "If-None-Match": validator } }), "phoenix2", store.getResponse);
      assert.equal(response.status, 304);
      assert.equal(response.headers.get("ETag"), etag);
      assert.equal(response.headers.get("Cache-Control"), PUBLIC_CATALOG_CACHE_CONTROL);
      assert.equal(await response.text(), "");
    }
  }
  const response = await publicCatalogHttpResponse(new Request("https://example.test", { headers: { "If-None-Match": '"different"' } }), "phoenix2", store.getResponse);
  assert.equal(response.status, 200);
});

test("a prior validator returns new bytes after a successful invalidation", async () => {
  const { store, setDocuments } = fixture();
  const before = await store.getResponse("phoenix2");
  setDocuments([song({ songName: "Edited catalog" })]);
  store.invalidate();
  const response = await publicCatalogHttpResponse(new Request("https://example.test", { headers: { "If-None-Match": before.etag } }), "phoenix2", store.getResponse);
  assert.equal(response.status, 200);
  assert.notEqual(response.headers.get("ETag"), before.etag);
  assert.equal((await response.json()).songs[0].title, "Edited catalog");
});

test("removed=1 is explicit and invalid versions/views do not touch the database", async () => {
  const { store, reads } = fixture([song({ supportedVersions: [], removedFromVersions: ["phoenix2"] })]);
  const removed = await publicCatalogHttpResponse(new Request("https://example.test?removed=1"), "phoenix2", store.getResponse);
  assert.equal((await removed.json()).total, 1);
  assert.deepEqual(reads[0].filter, { removedFromVersions: "phoenix2" });
  for (const [version, query] of [["unknown", ""], ["phoenix2", "?removed=yes"], ["phoenix2", "?removed="], ["phoenix2", "?removed=1&removed=0"]]) {
    const result = await publicCatalogHttpResponse(new Request(`https://example.test${query}`), version, store.getResponse);
    assert.equal(result.status, 400);
    assert.equal(result.headers.get("Cache-Control"), "no-store");
  }
  assert.equal(reads.length, 1);
});

test("missing database config and Mongo failures produce safe 503/no-store, including HEAD and validators", async () => {
  const { store, fail } = fixture();
  fail(true);
  const missing = createPublicCatalogStore(async () => { throw new Error("Missing MONGODB_URI private"); });
  for (const loader of [store.getResponse, missing.getResponse]) {
    for (const method of ["GET", "HEAD"]) {
      const response = await publicCatalogHttpResponse(new Request("https://example.test", { method, headers: { "If-None-Match": "*" } }), "phoenix2", loader);
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal(response.headers.get("ETag"), null);
      const body = await response.text();
      assert.equal(body.includes("private"), false);
      assert.equal(body.includes("songs"), false);
      if (method === "HEAD") assert.equal(body, "");
    }
  }
});
