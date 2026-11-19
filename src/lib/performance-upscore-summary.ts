export interface HomeUpscoreMetric {
  key: "today" | "week" | "month" | "all-time";
  label: string;
  value: number | null;
}

export function homeUpscoreMetrics(args: {
  passedMaps: number | null;
  upscoresThisMonth: number;
  upscoresThisWeek: number;
  upscoresToday: number;
}): HomeUpscoreMetric[] {
  const metrics: HomeUpscoreMetric[] = [
    { key: "today", label: "Upscores today", value: args.upscoresToday },
    { key: "week", label: "Upscores this week", value: args.upscoresThisWeek },
    { key: "month", label: "Upscores this month", value: args.upscoresThisMonth },
    { key: "all-time", label: "All-time passed maps", value: args.passedMaps },
  ];
  return metrics.filter((metric) => metric.value !== null && metric.value > 0);
}

export function homeUpscoreMetric(args: Parameters<typeof homeUpscoreMetrics>[0]): HomeUpscoreMetric {
  const metrics = homeUpscoreMetrics(args);

  if (args.upscoresToday > 5) {
    return metrics.find((metric) => metric.key === "today")!;
  }
  if (args.upscoresThisWeek > 0) {
    return metrics.find((metric) => metric.key === "week")!;
  }
  if (args.upscoresThisMonth > 0) {
    return metrics.find((metric) => metric.key === "month")!;
  }
  return metrics.find((metric) => metric.key === "all-time") ?? { key: "all-time", label: "All-time passed maps", value: args.passedMaps };
}
