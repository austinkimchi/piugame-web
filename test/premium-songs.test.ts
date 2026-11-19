import assert from "node:assert/strict";
import test from "node:test";

import { isPremiumSong, PREMIUM_SONG_TITLES_BY_VERSION } from "../src/lib/premium-songs.ts";

test("indexes premium songs by release version", () => {
  assert.equal(PREMIUM_SONG_TITLES_BY_VERSION.phoenix.length, 18);
  assert.equal(PREMIUM_SONG_TITLES_BY_VERSION.phoenix2.length, 4);

  for (const [version, titles] of Object.entries(PREMIUM_SONG_TITLES_BY_VERSION)) {
    for (const title of titles) {
      assert.equal(isPremiumSong(title, version as "phoenix" | "phoenix2"), true, `${title} in ${version}`);
    }
  }
});

test("matches premium titles independent of case and surrounding whitespace", () => {
  assert.equal(isPremiumSong("  l (piu edit)  ", "phoenix2"), true);
  assert.equal(isPremiumSong("prima materia", "phoenix"), true);
  assert.equal(isPremiumSong("iRELLiA", "phoenix2"), false);
  assert.equal(isPremiumSong("Legendary", "phoenix2"), false);
});

test("does not carry premium status into another release", () => {
  assert.equal(isPremiumSong("Altale", "phoenix"), true);
  assert.equal(isPremiumSong("Altale", "phoenix2"), false);
  assert.equal(isPremiumSong("Legendary Dominion", "phoenix2"), true);
  assert.equal(isPremiumSong("Legendary Dominion", "phoenix"), false);
  assert.equal(isPremiumSong("Altale", "xx"), false);
});
