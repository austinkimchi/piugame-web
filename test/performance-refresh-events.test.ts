import assert from "node:assert/strict";
import test from "node:test";

import {
  emitPerformanceRefreshState,
  getPerformanceRefreshState,
  subscribePerformanceRefreshState,
} from "../src/lib/performance-refresh-events.ts";

test("keeps the shared refresh state busy until overlapping work finishes", () => {
  let notifications = 0;
  const unsubscribe = subscribePerformanceRefreshState(() => {
    notifications += 1;
  });

  try {
    assert.equal(getPerformanceRefreshState(), "idle");
    emitPerformanceRefreshState("syncing");
    emitPerformanceRefreshState("syncing");
    assert.equal(getPerformanceRefreshState(), "syncing");

    emitPerformanceRefreshState("idle");
    assert.equal(getPerformanceRefreshState(), "syncing");
    emitPerformanceRefreshState("idle");
    assert.equal(getPerformanceRefreshState(), "idle");
    assert.equal(notifications, 2);
  } finally {
    unsubscribe();
    emitPerformanceRefreshState("idle");
    emitPerformanceRefreshState("idle");
  }
});
