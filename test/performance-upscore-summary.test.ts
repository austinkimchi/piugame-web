import assert from "node:assert/strict";
import test from "node:test";

import { homeUpscoreMetric } from "../src/lib/performance-upscore-summary.ts";

const now = Date.parse("2026-08-18T22:00:00.000Z");
const base = { upscoresToday: 2, recentNewScores: 4, upscoresThisWeek: 7, now };

test("uses today's upscores after a current sync", () => {
  assert.deepEqual(homeUpscoreMetric({ ...base, lastSyncedAt: new Date(now - 60 * 60 * 1000).toISOString() }), { label: "Upscores today", value: 2 });
});

test("uses recent scores after a recent sync", () => {
  assert.deepEqual(homeUpscoreMetric({ ...base, lastSyncedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString() }), { label: "Recent new scores", value: 4 });
});

test("uses the weekly total when the sync is stale", () => {
  assert.deepEqual(homeUpscoreMetric({ ...base, lastSyncedAt: new Date(now - 25 * 60 * 60 * 1000).toISOString() }), { label: "Upscores this week", value: 7 });
});
