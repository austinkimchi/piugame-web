import test from "node:test";
import assert from "node:assert/strict";

import { metricChangeSince, roundedAverageBestScore } from "../src/lib/performance-metrics.ts";

test("rounds a tracked average best score for display and snapshots", () => {
  assert.equal(roundedAverageBestScore(932_580.5), 932_581);
  assert.equal(roundedAverageBestScore(undefined), null);
});

test("only reports a non-zero metric change when both snapshots exist", () => {
  assert.equal(metricChangeSince(1_234, 1_200), 34);
  assert.equal(metricChangeSince(1_200, 1_234), -34);
  assert.equal(metricChangeSince(1_200, 1_200), null);
  assert.equal(metricChangeSince(1_200, null), null);
  assert.equal(metricChangeSince(null, 1_200), null);
});
