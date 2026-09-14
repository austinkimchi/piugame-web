import assert from "node:assert/strict";
import test from "node:test";

import { isPremiumSong, PREMIUM_SONG_TITLES } from "../src/lib/premium-songs.ts";

test("indexes the known premium songs", () => {
  assert.equal(PREMIUM_SONG_TITLES.length, 21);

  for (const title of PREMIUM_SONG_TITLES) {
    assert.equal(isPremiumSong(title), true, title);
  }
});

test("matches premium titles independent of case and surrounding whitespace", () => {
  assert.equal(isPremiumSong("  l (piu edit)  "), true);
  assert.equal(isPremiumSong("prima materia"), true);
  assert.equal(isPremiumSong("iRELLiA"), false);
  assert.equal(isPremiumSong("Legendary"), false);
});
