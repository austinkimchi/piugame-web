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
  skillTargets?: ReturnType<typeof estimateSkillTargets>;
}

const RECENT_PLAY_WINDOW_MS = 24 * 60 * 60 * 1000;
const SKILL_PERCENTILE = 0.7;
const COMFORT_SCORE = 950_000;
const SCORE_PER_LEVEL = 50_000;
const MIN_SCORE_ADJUSTMENT = -2;
const MAX_SCORE_ADJUSTMENT = 0.75;

export function recommendChartToken({
  songName,
  chartTokens,
  songEvidence,
  skillEvidence,
  preferredModes = [],
  now = new Date(),
  skillTargets: preparedSkillTargets,
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

  const passedCharts = evidenceForSong.filter(({ evidence }) => isNumericScore(evidence.bestScore));
  const preferredPassedCharts = passedCharts.filter(({ chart }) => preferredModes.includes(chart.mode));
  const relevantPassedCharts = preferredPassedCharts.length > 0 ? preferredPassedCharts : passedCharts;
  if (relevantPassedCharts.length > 0) {
    relevantPassedCharts.sort((left, right) => {
      return (
        right.chart.level - left.chart.level ||
        timestamp(right.evidence.latestPlayedAt) - timestamp(left.evidence.latestPlayedAt) ||
        (right.evidence.bestScore ?? -1) - (left.evidence.bestScore ?? -1)
      );
    });
    return relevantPassedCharts[0].chart.token;
  }

  const latestAttempt = evidenceForSong
    .filter(({ evidence }) => timestamp(evidence.latestPlayedAt) !== Number.MIN_SAFE_INTEGER)
    .sort((left, right) => timestamp(right.evidence.latestPlayedAt) - timestamp(left.evidence.latestPlayedAt))[0];
  if (latestAttempt) {
    return latestAttempt.chart.token;
  }

  const skillTargets = preparedSkillTargets ?? estimateSkillTargets(skillEvidence);
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

/** Private SSR overlay; never include this in a public catalog snapshot. */
export type CatalogChartRecommendations = Record<string, Record<string, string | null>>;

export function chartRecommendationModeKey(filters: string[]): string {
  return chartModesFromFilters(filters).join("") || "all";
}

export function catalogChartRecommendationMap(
  songs: ReadonlyArray<{ slug: string; title: string; chartSummary: string[] }>,
  evidence: ChartSelectionEvidence[],
  now = new Date(),
): CatalogChartRecommendations {
  if (songs.length === 0 || evidence.length === 0) return {};
  const bySong = new Map<string, ChartSelectionEvidence[]>();
  for (const item of evidence) {
    const key = normalizeSongName(item.songName);
    const entries = bySong.get(key) ?? [];
    entries.push(item);
    bySong.set(key, entries);
  }
  const modes: ChartMode[] = ["S", "D", "C"];
  const selections: ChartMode[][] = [[]];
  function append(prefix: ChartMode[]) {
    for (const mode of modes) {
      if (prefix.includes(mode)) continue;
      const selection = [...prefix, mode];
      selections.push(selection);
      append(selection);
    }
  }
  append([]);
  const skillTargets = estimateSkillTargets(evidence);
  const result: CatalogChartRecommendations = {};
  for (const song of songs) {
    const tokens = Object.fromEntries(selections.map((preferredModes) => [preferredModes.join("") || "all", recommendChartToken({
      songName: song.title,
      chartTokens: song.chartSummary,
      songEvidence: bySong.get(normalizeSongName(song.title)) ?? [],
      skillEvidence: evidence,
      skillTargets,
      preferredModes,
      now,
    })]));
    if (Object.values(tokens).some(Boolean)) result[song.slug] = tokens;
  }
  return result;
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

export function estimateSkillTargets(evidence: ChartSelectionEvidence[]): Map<ChartMode, { level: number; sampleSize: number }> {
  const levelsByMode = new Map<ChartMode, number[]>();

  for (const result of evidence) {
    if (!isNumericScore(result.bestScore)) continue;
    const token = catalogChartTokenFromPlay(result);
    const chart = token ? parseChartToken(token) : null;
    if (!chart || chart.mode === "C") continue;
    const levels = levelsByMode.get(chart.mode) ?? [];
    levels.push(scoreAdjustedLevel(chart.level, result.bestScore));
    levelsByMode.set(chart.mode, levels);
  }

  const targets = new Map<ChartMode, { level: number; sampleSize: number }>();
  for (const [mode, levels] of levelsByMode) {
    const sorted = levels.sort((left, right) => left - right);
    const level = percentile(sorted, SKILL_PERCENTILE);
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

export function normalizeSongName(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
}

function isNumericScore(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function scoreAdjustedLevel(level: number, bestScore: number): number {
  const adjustment = Math.max(
    MIN_SCORE_ADJUSTMENT,
    Math.min(MAX_SCORE_ADJUSTMENT, (bestScore - COMFORT_SCORE) / SCORE_PER_LEVEL),
  );
  return level + adjustment;
}

function percentile(sortedValues: number[], percentileValue: number): number {
  const position = (sortedValues.length - 1) * percentileValue;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const interpolation = position - lowerIndex;
  return sortedValues[lowerIndex] * (1 - interpolation) + sortedValues[upperIndex] * interpolation;
}
