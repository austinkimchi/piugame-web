import assert from "node:assert/strict";
import test from "node:test";
import { requestedSongVersion, selectedSongChart, songPagePath, songPageVersion } from "../src/lib/song-page-url.ts";

test("version and chart identity retain the selected public catalog", () => {
  const song = { slug: "a-nightmare-banya-phoenix2", version: "phoenix2" as const, supportedVersions: ["phoenix", "phoenix2"] as const };
  assert.equal(songPageVersion({ supportedVersions: [...song.supportedVersions] }, "phoenix"), "phoenix");
  assert.equal(songPageVersion({ supportedVersions: [...song.supportedVersions] }, "xx"), "phoenix2");
  assert.equal(requestedSongVersion(undefined), "phoenix2");
  assert.equal(requestedSongVersion(["phoenix", "phoenix2"]), "phoenix");
  assert.equal(requestedSongVersion("invalid"), "phoenix2");
  assert.equal(selectedSongChart("D14", ["S3", "S6", "D14"]), "D14");
  assert.equal(selectedSongChart("D14", ["S3", "S6", "D15"]), null);
  assert.equal(selectedSongChart(["D15", "D14"], ["D15"]), "D15");
  assert.equal(songPagePath(song, "phoenix"), "/songs/a-nightmare-banya-phoenix2?version=phoenix");
  assert.equal(songPagePath(song, "phoenix2", "D15"), "/songs/a-nightmare-banya-phoenix2?version=phoenix2&chart=D15");
});

test("removed-only records retain their historical view and established canonical alias", () => {
  const song = { slug: "after-like-ive-phoenix", version: "phoenix" as const, supportedVersions: ["phoenix" as const] };
  assert.equal(songPageVersion(song, "phoenix2"), "phoenix");
  assert.equal(songPagePath(song, "phoenix", "D23"), "/songs/after-like-ive-phoenix2?version=phoenix&chart=D23");
  assert.equal(song.slug, "after-like-ive-phoenix", "URL normalization must not mutate catalog identity");
});

test("chart and slug values remain URL data", () => {
  const song = { slug: "fixture / song", version: "phoenix2" as const };
  const url = new URL(songPagePath(song, "phoenix2", "S20+"), "https://example.com");
  assert.equal(url.pathname, "/songs/fixture%20%2F%20song");
  assert.equal(url.searchParams.get("chart"), "S20+");
  assert.equal(url.searchParams.get("version"), "phoenix2");
});


test("unsupported requests choose the latest supported historical series regardless of source order", () => {
  for (const supportedVersions of [["xx", "prime2", "phoenix"], ["phoenix", "prime2", "xx"]] as const) {
    assert.equal(songPageVersion({ supportedVersions: [...supportedVersions] }, "phoenix2"), "phoenix");
  }
  assert.equal(songPageVersion({ supportedVersions: ["nx", "fiesta", "prime"] }, "phoenix2"), "prime");
  assert.equal(requestedSongVersion(["not-a-version", "phoenix"]), "phoenix2");
});
