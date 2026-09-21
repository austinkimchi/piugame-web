import assert from "node:assert/strict";
import test from "node:test";

import { homeUpscoreMetric, homeUpscoreMetrics } from "../src/lib/performance-upscore-summary.ts";

const base = { passedMaps: 428, upscoresThisMonth: 21, upscoresThisWeek: 7, upscoresToday: 2 };

test("uses today's upscores when there are more than five", () => {
  assert.deepEqual(homeUpscoreMetric({ ...base, upscoresToday: 6 }), { key: "today", label: "Upscores today", value: 6 });
});

test("falls back from a quiet day to the week, month, then all-time clears", () => {
  assert.deepEqual(homeUpscoreMetric(base), { key: "week", label: "Upscores this week", value: 7 });
  assert.deepEqual(homeUpscoreMetric({ ...base, upscoresThisWeek: 0 }), { key: "month", label: "Upscores this month", value: 21 });
  assert.deepEqual(homeUpscoreMetric({ ...base, upscoresThisWeek: 0, upscoresThisMonth: 0 }), { key: "all-time", label: "All-time passed maps", value: 428 });
});

test("only includes nonzero metrics in the click cycle", () => {
  assert.deepEqual(homeUpscoreMetrics({ ...base, upscoresThisWeek: 0 }), [
    { key: "today", label: "Upscores today", value: 2 },
    { key: "month", label: "Upscores this month", value: 21 },
    { key: "all-time", label: "All-time passed maps", value: 428 },
  ]);
});

test("labels an entirely empty history as all-time passed maps", () => {
  assert.deepEqual(homeUpscoreMetric({ passedMaps: 0, upscoresThisMonth: 0, upscoresThisWeek: 0, upscoresToday: 0 }), {
    key: "all-time",
    label: "All-time passed maps",
    value: 0,
  });
});
