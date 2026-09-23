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
  lastUpscoredAt: Date | null;
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

export interface StoredRecentPlaySummaryInput extends Pick<RecentPlay, "songName" | "mode" | "level" | "score" | "grade" | "plate" | "stageBreak" | "judgments"> {
  playedAt: Date | null;
  ingestedAt?: Date;
}

export function applyRecentPlaySummary(
  existing: ExistingPerformanceChartStatSummary | null,
  play: Pick<RecentPlay, "songName" | "mode" | "level" | "score" | "grade" | "plate" | "stageBreak" | "judgments">,
  playedAt: Date | null,
  now: Date,
): PerformanceChartStatSummary {
  const summary = {
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

  // Recent plays arrive before the historical bests bucket. A completed play
  // supplies the initial best and promotes a newly observed upscore.
  if (isCompletedPlay(play) && (summary.bestScore === null || play.score > summary.bestScore)) {
    return {
      ...summary,
      bestScore: play.score,
      bestGrade: play.grade,
      bestPlate: play.plate,
      bestSyncedAt: now,
      previousBestScore: summary.bestScore,
      previousBestGrade: summary.bestGrade,
      previousBestPlate: summary.bestPlate,
      previousBestSyncedAt: summary.bestSyncedAt,
      lastUpscoredAt: summary.bestScore === null ? summary.lastUpscoredAt : now,
    };
  }

  return summary;
}

export function reconcileRecentPlaySummary(
  existing: ExistingPerformanceChartStatSummary | null,
  plays: StoredRecentPlaySummaryInput[],
  now: Date,
): PerformanceChartStatSummary {
  const ordered = [...plays].sort(compareStoredRecentPlays);
  const latest = ordered.at(-1);
  if (!latest) {
    if (existing) return existing as PerformanceChartStatSummary;
    throw new Error("Cannot reconcile a chart without recent plays.");
  }

  const bestRecent = ordered
    .filter((play): play is StoredRecentPlaySummaryInput & { score: number } => isCompletedPlay(play))
    .sort((left, right) => (right.score - left.score) || compareStoredRecentPlays(right, left))[0];
  const summary: PerformanceChartStatSummary = {
    ...emptySummary(latest.songName, latest.mode, latest.level, now),
    ...existing,
    songName: latest.songName,
    mode: latest.mode,
    level: latest.level,
    latestScore: latest.score,
    latestGrade: latest.grade,
    latestPlate: latest.plate,
    latestStageBreak: latest.stageBreak,
    latestJudgments: latest.judgments,
    latestPlayedAt: latest.playedAt,
    recentPlayCount: ordered.length,
    stageBreakCount: ordered.filter((play) => play.stageBreak).length,
    updatedAt: now,
  };

  if (bestRecent && (summary.bestScore === null || bestRecent.score > summary.bestScore)) {
    return {
      ...summary,
      bestScore: bestRecent.score,
      bestGrade: bestRecent.grade,
      bestPlate: bestRecent.plate,
      bestSyncedAt: now,
      previousBestScore: summary.bestScore,
      previousBestGrade: summary.bestGrade,
      previousBestPlate: summary.bestPlate,
      previousBestSyncedAt: summary.bestSyncedAt,
      lastUpscoredAt: summary.bestScore === null ? summary.lastUpscoredAt : now,
    };
  }

  return summary;
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
    lastUpscoredAt: currentBest !== null && incomingBest > currentBest ? now : existing?.lastUpscoredAt ?? null,
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

export function combineChartStatSummaries(
  candidates: PerformanceChartStatSummary[],
): PerformanceChartStatSummary | null {
  const fallback = candidates[0];
  if (!fallback) return null;

  const best = candidates
    .filter((candidate): candidate is PerformanceChartStatSummary & { bestScore: number } => typeof candidate.bestScore === "number")
    .sort((left, right) => right.bestScore - left.bestScore || dateValue(right.bestSyncedAt) - dateValue(left.bestSyncedAt))[0];
  const latest = [...candidates].sort((left, right) => dateValue(right.latestPlayedAt) - dateValue(left.latestPlayedAt))[0];
  const top = candidates
    .filter((candidate): candidate is PerformanceChartStatSummary & { topPlayRank: number } => typeof candidate.topPlayRank === "number")
    .sort((left, right) => left.topPlayRank - right.topPlayRank)[0];

  return {
    ...fallback,
    ...(best
      ? {
          bestScore: best.bestScore,
          bestGrade: best.bestGrade,
          bestPlate: best.bestPlate,
          bestBucketPage: best.bestBucketPage,
          bestSyncedAt: best.bestSyncedAt,
          previousBestScore: best.previousBestScore,
          previousBestGrade: best.previousBestGrade,
          previousBestPlate: best.previousBestPlate,
          previousBestSyncedAt: best.previousBestSyncedAt,
          lastUpscoredAt: best.lastUpscoredAt,
        }
      : {}),
    latestScore: latest.latestScore,
    latestGrade: latest.latestGrade,
    latestPlate: latest.latestPlate,
    latestStageBreak: latest.latestStageBreak,
    latestJudgments: latest.latestJudgments,
    latestPlayedAt: latest.latestPlayedAt,
    recentPlayCount: candidates.reduce((total, candidate) => total + candidate.recentPlayCount, 0),
    stageBreakCount: candidates.reduce((total, candidate) => total + candidate.stageBreakCount, 0),
    ...(top
      ? {
          topPlayRank: top.topPlayRank,
          topPumbilityScore: top.topPumbilityScore,
          topPlayedAt: top.topPlayedAt,
          topPlaysSyncedAt: top.topPlaysSyncedAt,
        }
      : {}),
    firstSeenAt: new Date(Math.min(...candidates.map((candidate) => candidate.firstSeenAt.getTime()))),
    updatedAt: new Date(Math.max(...candidates.map((candidate) => candidate.updatedAt.getTime()))),
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
    firstSeenAt: now,
    updatedAt: now,
  };
}

function isCompletedPlay(play: Pick<RecentPlay, "score" | "grade" | "stageBreak">): play is Pick<RecentPlay, "score" | "grade" | "stageBreak"> & { score: number } {
  return !play.stageBreak && typeof play.score === "number" && !String(play.grade ?? "").trim().toLowerCase().startsWith("x_");
}

function compareStoredRecentPlays(left: StoredRecentPlaySummaryInput, right: StoredRecentPlaySummaryInput): number {
  const playedAtDifference = (left.playedAt?.getTime() ?? 0) - (right.playedAt?.getTime() ?? 0);
  if (playedAtDifference !== 0) return playedAtDifference;
  return (left.ingestedAt?.getTime() ?? 0) - (right.ingestedAt?.getTime() ?? 0);
}

function dateValue(value: Date | null): number {
  return value?.getTime() ?? Number.NEGATIVE_INFINITY;
}
