import assert from "node:assert/strict";
import test from "node:test";

import { canLoadMoreSongs } from "../src/lib/song-pagination.ts";

test("allows another page when a cursor is idle", () => {
  assert.equal(canLoadMoreSongs({ appendInFlight: false, loading: false, nextCursor: "next-page" }), true);
});

test("blocks exhausted and overlapping pagination requests", () => {
  assert.equal(canLoadMoreSongs({ appendInFlight: false, loading: false, nextCursor: null }), false);
  assert.equal(canLoadMoreSongs({ appendInFlight: false, loading: true, nextCursor: "next-page" }), false);
  assert.equal(canLoadMoreSongs({ appendInFlight: true, loading: false, nextCursor: "next-page" }), false);
});
