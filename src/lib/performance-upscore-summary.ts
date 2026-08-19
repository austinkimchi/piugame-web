export function homeUpscoreMetric(args: {
  lastSyncedAt: string | null;
  recentNewScores: number;
  upscoresThisWeek: number;
  upscoresToday: number;
  now?: number;
}): { label: string; value: number } {
  const syncedAt = args.lastSyncedAt ? new Date(args.lastSyncedAt).getTime() : Number.NaN;
  const age = (args.now ?? Date.now()) - syncedAt;

  if (Number.isFinite(age) && age >= 0 && age <= 60 * 60 * 1000) {
    return { label: "Upscores today", value: args.upscoresToday };
  }
  if (Number.isFinite(age) && age >= 0 && age <= 24 * 60 * 60 * 1000) {
    return { label: "Recent new scores", value: args.recentNewScores };
  }
  return { label: "Upscores this week", value: args.upscoresThisWeek };
}
