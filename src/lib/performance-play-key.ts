export interface PerformancePlayKeyInput {
  playedAt: Date | null;
}

export function performancePlayKey(play: PerformancePlayKeyInput): string {
  return play.playedAt?.toISOString() ?? "";
}
