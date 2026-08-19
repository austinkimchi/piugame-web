export function roundedAverageBestScore(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

export function metricChangeSince(current: number | null, baseline: number | null): number | null {
  if (current === null || baseline === null) {
    return null;
  }

  return current - baseline;
}
