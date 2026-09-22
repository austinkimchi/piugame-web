import assert from "node:assert/strict";
import test from "node:test";

import { applyBucketBestSummary, applyRecentPlaySummary, applyTopPlaySummary, reconcileRecentPlaySummary, type PerformanceChartStatSummary } from "../src/lib/performance-stat-summary.ts";

const NOW = new Date("2026-08-11T12:00:00.000Z");
const PLAYED_AT = new Date("2026-08-11T11:30:00.000Z");
const JUDGMENTS = { perfect: 100, great: 10, good: 2, bad: 1, miss: 4 };

test("stage-break recent play updates latest detail without setting bucket best", () => {
  const summary = applyRecentPlaySummary(
    null,
    {
      songName: "New Rose",
      mode: "S",
      level: "19",
      score: null,
      grade: "aa",
      plate: "fg",
      stageBreak: true,
      judgments: JUDGMENTS,
    },
    PLAYED_AT,
    NOW,
  );

  assert.equal(summary.bestScore, null);
  assert.equal(summary.latestScore, null);
  assert.equal(summary.latestStageBreak, true);
  assert.deepEqual(summary.latestJudgments, JUDGMENTS);
  assert.equal(summary.recentPlayCount, 1);
  assert.equal(summary.stageBreakCount, 1);
});

test("non-stage-break recent play does not overwrite bucket best", () => {
  const existing = summaryFixture({ bestScore: 950000, bestGrade: "aaa", recentPlayCount: 2 });
  const summary = applyRecentPlaySummary(
    existing,
    {
      songName: "New Rose",
      mode: "S",
      level: "19",
      score: 930000,
      grade: "aa",
      plate: "fg",
      stageBreak: false,
      judgments: JUDGMENTS,
    },
    PLAYED_AT,
    NOW,
  );

  assert.equal(summary.bestScore, 950000);
  assert.equal(summary.bestGrade, "aaa");
  assert.equal(summary.latestScore, 930000);
  assert.equal(summary.recentPlayCount, 3);
  assert.equal(summary.stageBreakCount, 0);
});

test("completed recent play establishes a best before historical bests are synced", () => {
  const summary = applyRecentPlaySummary(
    null,
    {
      songName: "Big Daddy",
      mode: "S",
      level: "19",
      score: 927885,
      grade: "aa_p",
      plate: "fg",
      stageBreak: false,
      judgments: JUDGMENTS,
    },
    PLAYED_AT,
    NOW,
  );

  assert.equal(summary.bestScore, 927885);
  assert.equal(summary.bestGrade, "aa_p");
  assert.equal(summary.bestPlate, "fg");
  assert.equal(summary.bestSyncedAt, NOW);
});

test("completed recent upscore replaces best and preserves the prior best", () => {
  const previousSync = new Date("2026-08-10T12:00:00.000Z");
  const summary = applyRecentPlaySummary(
    summaryFixture({
      bestScore: 943818,
      bestGrade: "aa_p",
      bestPlate: "fg",
      bestSyncedAt: previousSync,
    }),
    {
      songName: "Viyella's Nightmare",
      mode: "S",
      level: "16",
      score: 954386,
      grade: "aaa",
      plate: "fg",
      stageBreak: false,
      judgments: JUDGMENTS,
    },
    PLAYED_AT,
    NOW,
  );

  assert.equal(summary.bestScore, 954386);
  assert.equal(summary.bestGrade, "aaa");
  assert.equal(summary.previousBestScore, 943818);
  assert.equal(summary.previousBestGrade, "aa_p");
  assert.equal(summary.previousBestSyncedAt, previousSync);
  assert.equal(summary.lastUpscoredAt, NOW);
});

test("failed recent play does not establish a best", () => {
  const summary = applyRecentPlaySummary(
    null,
    {
      songName: "Destrucimate",
      mode: "S",
      level: "19",
      score: 912934,
      grade: "x_aa",
      plate: "fg",
      stageBreak: false,
      judgments: JUDGMENTS,
    },
    PLAYED_AT,
    NOW,
  );

  assert.equal(summary.bestScore, null);
  assert.equal(summary.bestGrade, null);
});

test("reconciles unordered and retried recent plays idempotently", () => {
  const older = {
    songName: "Big Daddy",
    mode: "S",
    level: "19",
    score: 927_885,
    grade: "aa_p",
    plate: "fg",
    stageBreak: false,
    judgments: JUDGMENTS,
    playedAt: new Date("2026-08-10T11:30:00.000Z"),
    ingestedAt: new Date("2026-08-11T11:00:00.000Z"),
  };
  const latest = {
    ...older,
    score: 950_000,
    grade: "aaa",
    playedAt: PLAYED_AT,
    ingestedAt: NOW,
  };

  const first = reconcileRecentPlaySummary(null, [latest, older], NOW);
  const retried = reconcileRecentPlaySummary(first, [older, latest], NOW);

  assert.equal(first.latestScore, 950_000);
  assert.equal(first.latestPlayedAt, PLAYED_AT);
  assert.equal(first.bestScore, 950_000);
  assert.equal(first.recentPlayCount, 2);
  assert.equal(retried.latestScore, 950_000);
  assert.equal(retried.recentPlayCount, 2);
  assert.equal(retried.previousBestScore, null);
});

test("fetchAllPlays bucket best fills an existing Pumbility shell", () => {
  const existing = summaryFixture({ topPlayRank: 2, topPumbilityScore: 550, bestScore: null });
  const summary = applyBucketBestSummary(
    existing,
    {
      songName: "New Rose",
      mode: "S",
      level: "19",
      score: 924060,
      grade: "aa",
      plate: "fg",
      page: 4,
    },
    NOW,
  );

  assert.equal(summary.bestScore, 924060);
  assert.equal(summary.bestBucketPage, 4);
  assert.equal(summary.topPlayRank, 2);
  assert.equal(summary.topPumbilityScore, 550);
});

test("bucket best change preserves previous best score, grade, and plate", () => {
  const previousSync = new Date("2026-08-10T12:00:00.000Z");
  const existing = summaryFixture({
    bestScore: 920000,
    bestGrade: "aa",
    bestPlate: "fg",
    bestSyncedAt: previousSync,
  });
  const summary = applyBucketBestSummary(
    existing,
    {
      songName: "New Rose",
      mode: "S",
      level: "19",
      score: 924060,
      grade: "aa_p",
      plate: "mg",
      page: 4,
    },
    NOW,
  );

  assert.equal(summary.bestScore, 924060);
  assert.equal(summary.bestGrade, "aa_p");
  assert.equal(summary.bestPlate, "mg");
  assert.equal(summary.previousBestScore, 920000);
  assert.equal(summary.previousBestGrade, "aa");
  assert.equal(summary.previousBestPlate, "fg");
  assert.equal(summary.previousBestSyncedAt, previousSync);
  assert.equal(summary.lastUpscoredAt, NOW);
});

test("top play summary stores Pumbility score separately from bucket best", () => {
  const existing = summaryFixture({ bestScore: 924060 });
  const summary = applyTopPlaySummary(
    existing,
    {
      songName: "New Rose",
      mode: "S",
      level: "19",
      rank: 2,
      score: 550,
    },
    PLAYED_AT,
    NOW,
  );

  assert.equal(summary.bestScore, 924060);
  assert.equal(summary.topPlayRank, 2);
  assert.equal(summary.topPumbilityScore, 550);
});

function summaryFixture(overrides: Partial<PerformanceChartStatSummary> = {}): PerformanceChartStatSummary {
  return {
    songName: "New Rose",
    mode: "S",
    level: "19",
    bestScore: null,
    bestGrade: null,
    bestPlate: null,
    bestBucketPage: null,
    bestSyncedAt: null,
    previousBestScore: null,
    previousBestGrade: null,
    previousBestPlate: null,
    previousBestSyncedAt: null,
    lastUpscoredAt: null,
    latestScore: null,
    latestGrade: null,
    latestPlate: null,
    latestStageBreak: false,
    latestJudgments: null,
    latestPlayedAt: null,
    recentPlayCount: 0,
    stageBreakCount: 0,
    topPlayRank: null,
    topPumbilityScore: null,
    topPlayedAt: null,
    topPlaysSyncedAt: null,
    firstSeenAt: new Date("2026-08-10T12:00:00.000Z"),
    updatedAt: new Date("2026-08-10T12:00:00.000Z"),
    ...overrides,
  };
}
