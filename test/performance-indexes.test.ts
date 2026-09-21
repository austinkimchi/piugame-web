import assert from "node:assert/strict";
import test from "node:test";

import { PERFORMANCE_CHART_STATS_POPULATION_INDEX } from "../src/lib/performance-indexes.ts";

test("population recommendation stats use a version-leading covering index", () => {
  assert.deepEqual(Object.keys(PERFORMANCE_CHART_STATS_POPULATION_INDEX), [
    "piuVersion",
    "songName",
    "mode",
    "level",
    "bestScore",
  ]);
});
