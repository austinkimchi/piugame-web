export function displayedRecentPlayCount(stats: {
  bestBucketPage: number | null;
  bestScore: number | null;
  bestSyncedAt: string | null;
  recentPlayCount: number | null | undefined;
} | null | undefined): number | null | undefined {
  if (!stats) {
    return undefined;
  }

  const recentPlayCount = Math.max(0, Math.trunc(stats.recentPlayCount ?? 0));
  const hasBucketSyncedBest =
    stats.bestBucketPage !== null &&
    stats.bestSyncedAt !== null &&
    typeof stats.bestScore === "number" &&
    Number.isFinite(stats.bestScore);

  return recentPlayCount === 0 && hasBucketSyncedBest ? 1 : recentPlayCount;
}
