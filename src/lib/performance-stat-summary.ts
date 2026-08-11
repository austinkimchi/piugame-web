import type { BestPlay, RecentPlay, TopPlay } from "@austinkimchi/piugame-sdk";

export interface PerformanceChartStatSummary {
  songName: string;
  mode: string | null;
  level: string | null;
  bestScore: number | null;
  bestGrade: string | null;
  bestPlate: string | null;
  bestBucketPage: number | null;
  bestSyncedAt: Date | null;
  previousBestScore: number | null;
  previousBestGrade: string | null;
  previousBestPlate: string | null;
  previousBestSyncedAt: Date | null;
  latestScore: number | null;
  latestGrade: string | null;
  latestPlate: string | null;
  latestStageBreak: boolean;
  latestJudgments: RecentPlay["judgments"] | null;
  latestPlayedAt: Date | null;
  recentPlayCount: number;
  stageBreakCount: number;
  topPlayRank: number | null;
  topPumbilityScore: number | null;
  topPlayedAt: Date | null;
  topPlaysSyncedAt: Date | null;
  firstSeenAt: Date;
  updatedAt: Date;
}

export type ExistingPerformanceChartStatSummary = Partial<PerformanceChartStatSummary>;

export function applyRecentPlaySummary(
  existing: ExistingPerformanceChartStatSummary | null,
  play: Pick<RecentPlay, "songName" | "mode" | "level" | "score" | "grade" | "plate" | "stageBreak" | "judgments">,
  playedAt: Date | null,
  now: Date,
): PerformanceChartStatSummary {
  return {
    ...emptySummary(play.songName, play.mode, play.level, now),
    ...existing,
    songName: play.songName,
    mode: play.mode,
    level: play.level,
    latestScore: play.score,
    latestGrade: play.grade,
    latestPlate: play.plate,
    latestStageBreak: play.stageBreak,
    latestJudgments: play.judgments,
    latestPlayedAt: playedAt,
    recentPlayCount: (existing?.recentPlayCount ?? 0) + 1,
    stageBreakCount: (existing?.stageBreakCount ?? 0) + (play.stageBreak ? 1 : 0),
    updatedAt: now,
  };
}

export function applyBucketBestSummary(
  existing: ExistingPerformanceChartStatSummary | null,
  play: Pick<BestPlay, "songName" | "mode" | "level" | "score" | "grade" | "plate" | "page">,
  now: Date,
): PerformanceChartStatSummary {
  const base = {
    ...emptySummary(play.songName, play.mode, play.level, now),
    ...existing,
    songName: play.songName,
    mode: play.mode,
    level: play.level,
    updatedAt: now,
  };
  const currentBest = existing?.bestScore ?? null;
  const incomingBest = play.score;
  const shouldReplaceBest = incomingBest !== null && (currentBest === null || incomingBest !== currentBest);

  if (!shouldReplaceBest) {
    return {
      ...base,
      bestBucketPage: play.page,
      bestSyncedAt: now,
    };
  }

  return {
    ...base,
    bestScore: incomingBest,
    bestGrade: play.grade,
    bestPlate: play.plate,
    bestBucketPage: play.page,
    bestSyncedAt: now,
    previousBestScore: currentBest,
    previousBestGrade: existing?.bestGrade ?? null,
    previousBestPlate: existing?.bestPlate ?? null,
    previousBestSyncedAt: existing?.bestSyncedAt ?? null,
  };
}

export function applyTopPlaySummary(
  existing: ExistingPerformanceChartStatSummary | null,
  play: Pick<TopPlay, "songName" | "mode" | "level" | "rank" | "score">,
  playedAt: Date | null,
  now: Date,
): PerformanceChartStatSummary {
  return {
    ...emptySummary(play.songName, play.mode, play.level, now),
    ...existing,
    songName: play.songName,
    mode: play.mode,
    level: play.level,
    topPlayRank: play.rank,
    topPumbilityScore: play.score,
    topPlayedAt: playedAt,
    topPlaysSyncedAt: now,
    updatedAt: now,
  };
}

function emptySummary(songName: string, mode: string | null, level: string | null, now: Date): PerformanceChartStatSummary {
  return {
    songName,
    mode,
    level,
    bestScore: null,
    bestGrade: null,
    bestPlate: null,
    bestBucketPage: null,
    bestSyncedAt: null,
    previousBestScore: null,
    previousBestGrade: null,
    previousBestPlate: null,
    previousBestSyncedAt: null,
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
    firstSeenAt: now,
    updatedAt: now,
  };
}
