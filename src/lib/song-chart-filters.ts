import type { LevelFilterMode } from "./types.ts";

interface SongChartSummary {
  chartSummary: string[];
}

export function songMatchesChartFilters(
  song: SongChartSummary,
  levels: string[],
  charts: string[],
  levelMode: LevelFilterMode | undefined,
): boolean {
  if (!songMatchesLevelFilters(song, levels, charts, levelMode)) {
    return false;
  }

  if (charts.length > 0 && levels.length === 0) {
    return charts[levelMode === "and" ? "every" : "some"]((chart) =>
      song.chartSummary.some((token) => chart === chartTypeFromToken(token)),
    );
  }

  return true;
}

function songMatchesLevelFilters(song: SongChartSummary, levels: string[], charts: string[], levelMode: LevelFilterMode | undefined): boolean {
  if (levels.length === 0) {
    return true;
  }

  if (levelMode === "and") {
    if (charts.length > 0) {
      return charts.every((chart) =>
        levels.every((level) => song.chartSummary.some((token) => tokenMatchesLevelForChart(token, level, chart))),
      );
    }

    return levels.every((level) => song.chartSummary.some((token) => tokenMatchesLevelForChart(token, level, null)));
  }

  return levels.some((level) => song.chartSummary.some((token) =>
    charts.length > 0
      ? charts.some((chart) => tokenMatchesLevelForChart(token, level, chart))
      : tokenMatchesLevelForChart(token, level, null),
  ));
}

function tokenMatchesLevelForChart(token: string, level: string, chart: string | null): boolean {
  if (chart === "co-op") {
    return level === coOpPlayerCountFromToken(token);
  }

  if (chart && chart !== chartTypeFromToken(token)) {
    return false;
  }

  return level === levelFromChartToken(token);
}

function chartTypeFromToken(token: string): string | null {
  const normalized = token.trim().toUpperCase();
  if (normalized.startsWith("CO") || normalized.startsWith("C")) return "co-op";
  if (normalized.startsWith("D")) return "doubles";
  if (normalized.startsWith("S")) return "singles";
  return null;
}

function coOpPlayerCountFromToken(token: string): string | null {
  return token.trim().match(/^C([2-5])$/i)?.[1] ?? null;
}

function levelFromChartToken(token: string): string | null {
  const normalized = token.trim();
  if (/^C(?:O-?OP|[2-5])?$/i.test(normalized)) return null;
  const match = normalized.match(/(\d{1,2})$/);
  if (!match) return normalized ? "+" : null;
  const level = Number.parseInt(match[1], 10);
  return Number.isFinite(level) && level >= 1 && level <= 27 ? String(level) : "+";
}
