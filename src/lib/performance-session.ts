import { isFailedPerformanceGrade } from "./performance-format.ts";

const SESSION_BREAK_MS = 2 * 60 * 60 * 1000;

export interface PerformanceSessionPlay {
  playedAt: Date | null;
  score: number | null;
  grade?: string | null;
  stageBreak: boolean;
  chartToken: string;
}

export interface PerformanceSessionSummary {
  playCount: number;
  clearCount: number;
  failedCount: number;
  stageBreakCount: number;
  averageScore: number | null;
  bestScore: number | null;
  distinctCharts: number;
  startedAt: Date;
  endedAt: Date;
  durationMinutes: number;
}

export function startsNewSession(previous: Date, next: Date): boolean {
  return previous.getTime() - next.getTime() >= SESSION_BREAK_MS;
}

/** Counts the consecutive newest plays that belong to the current play session. */
export function countLatestSessionPlays(playedAtValues: Iterable<Date | null>): number {
  let count = 0;
  let previous: Date | null = null;

  for (const playedAt of playedAtValues) {
    if (!playedAt || Number.isNaN(playedAt.getTime())) {
      continue;
    }

    if (previous && startsNewSession(previous, playedAt)) {
      break;
    }

    count += 1;
    previous = playedAt;
  }

  return count;
}

export function summarizePerformanceSession(
  plays: Iterable<PerformanceSessionPlay>,
): PerformanceSessionSummary | null {
  let playCount = 0;
  let clearCount = 0;
  let failedCount = 0;
  let stageBreakCount = 0;
  let scoreTotal = 0;
  let scoredClearCount = 0;
  let bestScore: number | null = null;
  let startedAt: Date | null = null;
  let endedAt: Date | null = null;
  const chartTokens = new Set<string>();

  for (const play of plays) {
    const playedAt = play.playedAt;
    if (!playedAt || Number.isNaN(playedAt.getTime())) {
      continue;
    }

    playCount += 1;
    const failed = play.stageBreak || isFailedPerformanceGrade(play.grade);
    if (failed) {
      failedCount += 1;
    }
    if (play.stageBreak) {
      stageBreakCount += 1;
    }
    if (!failed) {
      clearCount += 1;
      if (typeof play.score === "number" && Number.isFinite(play.score)) {
        scoreTotal += play.score;
        scoredClearCount += 1;
        bestScore = bestScore === null ? play.score : Math.max(bestScore, play.score);
      }
    }

    const chartToken = play.chartToken.trim().toLowerCase();
    if (chartToken) {
      chartTokens.add(chartToken);
    }
    if (!startedAt || playedAt < startedAt) {
      startedAt = playedAt;
    }
    if (!endedAt || playedAt > endedAt) {
      endedAt = playedAt;
    }
  }

  if (!startedAt || !endedAt || playCount === 0) {
    return null;
  }

  return {
    playCount,
    clearCount,
    failedCount,
    stageBreakCount,
    averageScore: scoredClearCount > 0 ? Math.round(scoreTotal / scoredClearCount) : null,
    bestScore,
    distinctCharts: chartTokens.size,
    startedAt,
    endedAt,
    durationMinutes: Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000)),
  };
}
