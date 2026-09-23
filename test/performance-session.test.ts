import assert from "node:assert/strict";
import test from "node:test";

import {
  countLatestSessionPlays,
  performanceSessionArcade,
  summarizePerformanceSession,
} from "../src/lib/performance-session.ts";

test("counts plays in the newest uninterrupted session", () => {
  const base = new Date("2026-08-18T22:00:00.000Z");
  const minutesEarlier = (minutes: number) => new Date(base.getTime() - minutes * 60_000);

  assert.equal(countLatestSessionPlays([base, minutesEarlier(30), minutesEarlier(119), minutesEarlier(240)]), 3);
});

test("starts a new session when the break is exactly two hours", () => {
  const base = new Date("2026-08-18T22:00:00.000Z");
  const twoHoursEarlier = new Date(base.getTime() - 2 * 60 * 60_000);

  assert.equal(countLatestSessionPlays([base, twoHoursEarlier]), 1);
});

test("summarizes clears, failures, scores, charts, and duration", () => {
  const summary = summarizePerformanceSession([
    {
      playedAt: new Date("2026-08-18T22:45:00.000Z"),
      score: null,
      grade: null,
      stageBreak: true,
      chartToken: "big-daddy:s:19",
    },
    {
      playedAt: new Date("2026-08-18T22:15:00.000Z"),
      score: 950_000,
      grade: "s",
      stageBreak: false,
      chartToken: "battle-no-1:s:19",
    },
    {
      playedAt: new Date("2026-08-18T21:45:00.000Z"),
      score: 900_000,
      grade: "a",
      stageBreak: false,
      chartToken: "battle-no-1:s:19",
    },
  ]);

  assert.deepEqual(summary, {
    playCount: 3,
    clearCount: 2,
    failedCount: 1,
    stageBreakCount: 1,
    averageScore: 925_000,
    bestScore: 950_000,
    distinctCharts: 2,
    startedAt: new Date("2026-08-18T21:45:00.000Z"),
    endedAt: new Date("2026-08-18T22:45:00.000Z"),
    durationMinutes: 60,
  });
});

test("ignores invalid timestamps and failed scores", () => {
  const summary = summarizePerformanceSession([
    { playedAt: new Date("invalid"), score: 999_999, grade: "s", stageBreak: false, chartToken: "ignored" },
    { playedAt: new Date("2026-08-18T22:00:00.000Z"), score: 800_000, grade: "x_aa", stageBreak: false, chartToken: "song:s:18" },
  ]);

  assert.equal(summary?.playCount, 1);
  assert.equal(summary?.clearCount, 0);
  assert.equal(summary?.failedCount, 1);
  assert.equal(summary?.stageBreakCount, 0);
  assert.equal(summary?.averageScore, null);
  assert.equal(summary?.bestScore, null);
});

test("uses the most common recorded arcade and prefers the newest play on ties", () => {
  const plays = [
    { arcadeName: "  Arcade A  " },
    { arcadeName: "Arcade B" },
    { arcadeName: "Arcade B" },
    { arcadeName: "Arcade A" },
    { arcadeName: null },
  ].map((play) => ({
    ...play,
    playedAt: new Date("2026-08-18T22:00:00.000Z"),
    score: 900_000,
    stageBreak: false,
    chartToken: "song:s:18",
  }));

  assert.equal(performanceSessionArcade(plays), "Arcade A");
});
