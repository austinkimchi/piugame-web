import { catalogChartTokenFromPlay } from "./performance-chart-key.ts";

export type ChartMode = "S" | "D" | "C";

export interface ChartSelectionEvidence {
  songName: string;
  mode: string | null;
  level: string | null;
  bestScore: number | null;
  latestPlayedAt: Date | string | null;
}

interface RecommendChartArgs {
  songName: string;
  chartTokens: string[];
  songEvidence: ChartSelectionEvidence[];
  skillEvidence: ChartSelectionEvidence[];
  preferredModes?: ChartMode[];
  now?: Date;
}

export const CHART_RECOMMENDATION_HIGH_SCORE = 900_000;
const RECENT_PLAY_WINDOW_MS = 24 * 60 * 60 * 1000;
const SKILL_FRONTIER_SIZE = 5;

export function recommendChartToken({
  songName,
  chartTokens,
  songEvidence,
  skillEvidence,
  preferredModes = [],
  now = new Date(),
}: RecommendChartArgs): string | null {
  const availableCharts = chartTokens.map(parseChartToken).filter((chart): chart is ParsedChart => chart !== null);
  if (availableCharts.length === 0) {
    return null;
  }

  const availableByToken = new Map(availableCharts.map((chart) => [chart.token.toUpperCase(), chart]));
  const evidenceForSong = songEvidence
    .filter((evidence) => normalizeSongName(evidence.songName) === normalizeSongName(songName))
    .flatMap((evidence) => {
      const token = catalogChartTokenFromPlay(evidence);
      const chart = token ? availableByToken.get(token.toUpperCase()) : null;
      return chart ? [{ chart, evidence }] : [];
    });
  const recentCutoff = now.getTime() - RECENT_PLAY_WINDOW_MS;
  const recent = evidenceForSong
    .filter(({ evidence }) => timestamp(evidence.latestPlayedAt) >= recentCutoff)
    .sort((left, right) => timestamp(right.evidence.latestPlayedAt) - timestamp(left.evidence.latestPlayedAt))[0];
  if (recent) {
    return recent.chart.token;
  }

  const highScores = evidenceForSong.filter(({ evidence }) => (evidence.bestScore ?? -1) >= CHART_RECOMMENDATION_HIGH_SCORE);
  if (highScores.length > 0) {
    highScores.sort((left, right) => {
      return (
        (right.evidence.bestScore ?? -1) - (left.evidence.bestScore ?? -1) ||
        right.chart.level - left.chart.level ||
        timestamp(right.evidence.latestPlayedAt) - timestamp(left.evidence.latestPlayedAt)
      );
    });
    return highScores[0].chart.token;
  }

  const skillTargets = estimateSkillTargets(skillEvidence);
  const modeOrder = Array.from(new Set([
    ...preferredModes,
    ...Array.from(skillTargets.entries())
      .sort((left, right) => right[1].sampleSize - left[1].sampleSize || right[1].level - left[1].level)
      .map(([mode]) => mode),
  ]));

  for (const mode of modeOrder) {
    const target = skillTargets.get(mode);
    const modeCharts = availableCharts.filter((chart) => chart.mode === mode);
    if (!target || modeCharts.length === 0) continue;

    modeCharts.sort((left, right) => {
      const distanceDifference = Math.abs(left.level - target.level) - Math.abs(right.level - target.level);
      return distanceDifference || right.level - left.level || left.position - right.position;
    });
    return modeCharts[0].token;
  }

  return null;
}

export function chartModesFromFilters(filters: string[]): ChartMode[] {
  return Array.from(new Set(filters.flatMap((filter) => {
    const normalized = filter.replace(/[^a-z]/gi, "").toLowerCase();
    if (normalized === "single" || normalized === "singles" || normalized === "s") return ["S" as const];
    if (normalized === "double" || normalized === "doubles" || normalized === "d") return ["D" as const];
    if (normalized === "coop" || normalized === "cooperative" || normalized === "c") return ["C" as const];
    return [];
  })));
}

function estimateSkillTargets(evidence: ChartSelectionEvidence[]): Map<ChartMode, { level: number; sampleSize: number }> {
  const levelsByMode = new Map<ChartMode, number[]>();

  for (const result of evidence) {
    if ((result.bestScore ?? -1) < CHART_RECOMMENDATION_HIGH_SCORE) continue;
    const token = catalogChartTokenFromPlay(result);
    const chart = token ? parseChartToken(token) : null;
    if (!chart || chart.mode === "C") continue;
    const levels = levelsByMode.get(chart.mode) ?? [];
    levels.push(chart.level);
    levelsByMode.set(chart.mode, levels);
  }

  const targets = new Map<ChartMode, { level: number; sampleSize: number }>();
  for (const [mode, levels] of levelsByMode) {
    const frontier = levels.sort((left, right) => right - left).slice(0, SKILL_FRONTIER_SIZE).sort((left, right) => left - right);
    const middle = Math.floor(frontier.length / 2);
    const level = frontier.length % 2 === 0 ? (frontier[middle - 1] + frontier[middle]) / 2 : frontier[middle];
    targets.set(mode, { level, sampleSize: levels.length });
  }

  return targets;
}

interface ParsedChart {
  token: string;
  mode: ChartMode;
  level: number;
  position: number;
}

function parseChartToken(token: string, position = 0): ParsedChart | null {
  const match = /^([SDC])(?:X)?(\d{1,2})(?:[+-])?$/i.exec(token.trim());
  if (!match) return null;
  return { token, mode: match[1].toUpperCase() as ChartMode, level: Number(match[2]), position };
}

function timestamp(value: Date | string | null): number {
  if (!value) return Number.MIN_SAFE_INTEGER;
  const result = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(result) ? result : Number.MIN_SAFE_INTEGER;
}

function normalizeSongName(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
}
