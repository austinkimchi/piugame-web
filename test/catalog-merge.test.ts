import assert from "node:assert/strict";
import test from "node:test";

import { mergePhoenixCatalogs } from "../src/lib/catalog-merge.ts";

test("merges Phoenix 2 first and marks shared songs as supported in both versions", () => {
  const result = mergePhoenixCatalogs({
    importedAt: "2026-08-12T00:00:00.000Z",
    phoenixSongs: [{ songKey: "shared", songName: "Shared", artist: "Artist", folder: "Phoenix folder", chartTokens: ["S15"] }],
    phoenix2Songs: [{ songKey: "shared", songName: "Shared", artist: "Artist", folder: "Phoenix 2 folder", chartTokens: ["S17"] }],
  });

  assert.equal(result.sharedSongs, 1);
  assert.equal(result.phoenixOnlySongs, 0);
  assert.equal(result.phoenix2OnlySongs, 0);
  assert.equal(result.documents[0].folder, "Phoenix 2 folder");
  assert.deepEqual(result.documents[0].supportedVersions, ["phoenix2", "phoenix"]);
  assert.deepEqual(result.documents[0].chartTokensByVersion, { phoenix2: ["S17"], phoenix: ["S15"] });
  assert.deepEqual(result.documents[0].removedFromVersions, []);
});

test("keeps Phoenix-only songs and marks them removed from Phoenix 2", () => {
  const result = mergePhoenixCatalogs({
    importedAt: "2026-08-12T00:00:00.000Z",
    phoenixSongs: [{ songKey: "removed", songName: "Removed", artist: "Artist" }],
    phoenix2Songs: [{ songKey: "new", songName: "New", artist: "Artist" }],
  });
  const removed = result.documents.find((song) => song.songKey === "removed");

  assert.equal(result.sharedSongs, 0);
  assert.equal(result.phoenixOnlySongs, 1);
  assert.equal(result.phoenix2OnlySongs, 1);
  assert.deepEqual(removed?.supportedVersions, ["phoenix"]);
  assert.deepEqual(removed?.removedFromVersions, ["phoenix2"]);
  assert.equal(removed?.history?.some((event) => event.type === "removed" && event.version === "phoenix2"), true);
});
