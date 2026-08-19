import assert from "node:assert/strict";
import test from "node:test";

import { displayedRecentPlayCount } from "../src/lib/performance-play-count.ts";

const bucketBest = {
  bestBucketPage: 3,
  bestScore: 974291,
  bestSyncedAt: "2026-08-18T12:00:00.000Z",
};

test("shows one play for a bucket-synced best that has no recent-play event", () => {
  assert.equal(displayedRecentPlayCount({ ...bucketBest, recentPlayCount: 0 }), 1);
  assert.equal(displayedRecentPlayCount({ ...bucketBest, recentPlayCount: undefined }), 1);
});

test("preserves tracked recent-play counts", () => {
  assert.equal(displayedRecentPlayCount({ ...bucketBest, recentPlayCount: 4 }), 4);
  assert.equal(displayedRecentPlayCount({ ...bucketBest, recentPlayCount: 1.8 }), 1);
});

test("keeps zero plays for unsynced, incomplete, and failed-only charts", () => {
  assert.equal(displayedRecentPlayCount({ bestBucketPage: null, bestScore: 974291, bestSyncedAt: null, recentPlayCount: 0 }), 0);
  assert.equal(displayedRecentPlayCount({ bestBucketPage: 3, bestScore: null, bestSyncedAt: "2026-08-18T12:00:00.000Z", recentPlayCount: 0 }), 0);
  assert.equal(displayedRecentPlayCount(null), undefined);
});
