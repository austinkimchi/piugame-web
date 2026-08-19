export interface PerformancePlayKeyInput {
  playedAt: Date | null;
  playedAtRaw?: string | null;
}

export function performancePlayKey(play: PerformancePlayKeyInput): string {
  if (play.playedAt) {
    return play.playedAt.toISOString();
  }

  const raw = String(play.playedAtRaw ?? "").trim();
  if (raw) {
    return `raw:${raw}`;
  }

  return "missing-played-at";
}
