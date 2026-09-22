import assert from "node:assert/strict";
import test from "node:test";

import {
  getPerformanceRefreshServerState,
  getPerformanceRefreshState,
  runPerformanceRefresh,
} from "../src/lib/performance-refresh-events.ts";

test("rejects an overlapping interactive refresh until the active work finishes", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = runPerformanceRefresh(async () => {
    await gate;
    return "finished";
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(getPerformanceRefreshState(), "syncing");
  assert.equal(getPerformanceRefreshServerState(), "idle");
  assert.deepEqual(await runPerformanceRefresh(async () => "overlap"), { started: false });

  release();
  assert.deepEqual(await first, { started: true, value: "finished" });
  assert.equal(getPerformanceRefreshState(), "idle");
});
