import { isFailedPerformanceGrade } from "./performance-format.ts";

export interface SongPerformanceAttempt<TJudgments = unknown> {
  id?: string;
  score: number | null;
  grade: string | null;
  plate: string | null;
  playedAt: string | null;
  stageBreak: boolean;
  judgments: TJudgments;
}

export interface SongPerformanceCarousel<TJudgments = unknown> {
  entries: Array<SongPerformanceAttempt<TJudgments>>;
  primaryKind: "best" | "latest";
}

export function buildSongPerformanceCarousel<TJudgments>({
  bestGrade,
  bestPlate,
  bestScore,
  history,
  latestPlay,
}: {
  bestGrade: string | null;
  bestPlate: string | null;
  bestScore: number | null;
  history: Array<SongPerformanceAttempt<TJudgments>>;
  latestPlay: SongPerformanceAttempt<TJudgments> | null;
}): SongPerformanceCarousel<TJudgments> {
  const recentAttempts = uniqueAttempts([latestPlay, ...history].filter((play): play is SongPerformanceAttempt<TJudgments> => Boolean(play)));
  const latestFailed = latestPlay ? isFailedAttempt(latestPlay) : false;
  const bestAttempt = bestScore === null ? null : recentAttempts.find((play) => !isFailedAttempt(play) && play.score === bestScore) ?? null;
  const syntheticBest =
    bestScore === null
      ? null
      : {
          score: bestScore,
          grade: bestGrade,
          plate: bestPlate,
          playedAt: null,
          stageBreak: false,
          judgments: null as TJudgments,
        };
  const primary = latestFailed ? latestPlay : bestAttempt ?? latestPlay ?? recentAttempts[0] ?? syntheticBest;
  const primaryKind = latestFailed || !bestAttempt && bestScore === null ? "latest" : "best";

  if (!primary) {
    return { entries: [], primaryKind };
  }

  const primaryIndex = recentAttempts.findIndex((play) => attemptKey(play) === attemptKey(primary));
  return {
    entries: [primary, ...(primaryIndex === -1 ? recentAttempts : recentAttempts.slice(primaryIndex + 1))],
    primaryKind,
  };
}

function uniqueAttempts<TJudgments>(attempts: Array<SongPerformanceAttempt<TJudgments>>): Array<SongPerformanceAttempt<TJudgments>> {
  const seen = new Set<string>();
  const unique = attempts.filter((attempt) => {
    const key = attemptKey(attempt);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  return unique.sort((left, right) => timestampValue(right.playedAt) - timestampValue(left.playedAt));
}

function attemptKey<TJudgments>(attempt: SongPerformanceAttempt<TJudgments>): string {
  return attempt.playedAt?.trim() || [attempt.score ?? "", attempt.grade ?? "", attempt.plate ?? "", attempt.stageBreak ? "break" : "clear"].join(":");
}

function timestampValue(value: string | null): number {
  const timestamp = value ? new Date(value).getTime() : Number.NEGATIVE_INFINITY;
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}

function isFailedAttempt<TJudgments>(attempt: SongPerformanceAttempt<TJudgments>): boolean {
  return attempt.stageBreak || (isFailedPerformanceGrade(attempt.grade) && !String(attempt.grade ?? "").trim().toLowerCase().endsWith("_p"));
}
