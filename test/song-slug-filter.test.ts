import assert from "node:assert/strict";
import test from "node:test";

import { songsMatchingSlugs } from "../src/lib/song-slug-filter.ts";

test("favorite feed keeps only saved songs in their established order", () => {
  const songs = [
    { slug: "alpha", title: "Alpha" },
    { slug: "beta", title: "Beta" },
    { slug: "gamma", title: "Gamma" },
  ];

  assert.deepEqual(
    songsMatchingSlugs(songs, new Set(["gamma", "alpha"])),
    [songs[0], songs[2]],
  );
});

test("favorite feed is empty when the account has no saved songs", () => {
  assert.deepEqual(songsMatchingSlugs([{ slug: "alpha" }], new Set()), []);
});
