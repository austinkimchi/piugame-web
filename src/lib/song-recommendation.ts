import { estimateSkillTargets, normalizeSongName, type ChartMode, type ChartSelectionEvidence } from "./chart-recommendation.ts";
import { catalogChartTokenFromPlay } from "./performance-chart-key.ts";

export interface PopulationChartEvidence {
  songName: string;
  mode: string | null;
  level: string | null;
  attempts: number;
  clears: number;
}

export interface RankedChartRecommendation {
  songName: string;
  chartToken: string;
  score: number;
  targetLevel: number;
}

export function recommendationCandidatesFromCatalog(
  songs: Array<{ title: string; chartSummary: string[] }>,
): PopulationChartEvidence[] {
  return songs.flatMap((song) => song.chartSummary.flatMap((chartToken) => {
    const match = /^([SD])(\d{1,2}[+-]?)$/i.exec(chartToken.trim());
    if (!match) return [];
    return [{ songName: song.title, mode: match[1], level: match[2], attempts: 0, clears: 0 }];
  }));
}

export function populationCandidatesInCatalog(
  candidates: PopulationChartEvidence[],
  songs: Array<{ title: string; chartSummary: string[] }>,
): PopulationChartEvidence[] {
  const currentCharts = new Set(recommendationCandidatesFromCatalog(songs).flatMap((candidate) => {
    const chartToken = catalogChartTokenFromPlay(candidate);
    return chartToken ? [`${normalizeSongName(candidate.songName)}:${chartToken.toUpperCase()}`] : [];
  }));

  return candidates.filter((candidate) => {
    const chartToken = catalogChartTokenFromPlay(candidate);
    return chartToken !== null && currentCharts.has(`${normalizeSongName(candidate.songName)}:${chartToken.toUpperCase()}`);
  });
}

export function rankChartRecommendations(args: {
  candidates: PopulationChartEvidence[];
  userEvidence: ChartSelectionEvidence[];
  preferredModes: ChartMode[];
  levels?: string[];
  explorationSeed?: string;
  limit?: number;
}): RankedChartRecommendation[] {
  const targets = estimateSkillTargets(args.userEvidence);
  const modes = args.preferredModes.length > 0
    ? args.preferredModes
    : Array.from(targets.entries())
        .sort((left, right) => right[1].sampleSize - left[1].sampleSize)
        .map(([mode]) => mode);
  const playedSongs = new Set(args.userEvidence.map((evidence) => normalizeSongName(evidence.songName)));
  const levels = new Set((args.levels ?? []).map((level) => level.trim()).filter(Boolean));
  const mergedCandidates = mergePopulationEvidence(args.candidates);
  const maxAttempts = Math.max(1, ...mergedCandidates.map((candidate) => candidate.attempts));
  const ranked: RankedChartRecommendation[] = [];

  for (const candidate of mergedCandidates) {
    const chartToken = catalogChartTokenFromPlay(candidate);
    const mode = chartToken?.[0] as ChartMode | undefined;
    const rawLevel = String(candidate.level ?? "").trim();
    const level = Number.parseInt(rawLevel, 10);
    const target = mode ? targets.get(mode) : undefined;
    if (!chartToken || !mode || !modes.includes(mode) || !target || !Number.isFinite(level)) continue;
    if (!matchesLevelFilter(rawLevel, levels)) continue;
    if (playedSongs.has(normalizeSongName(candidate.songName))) continue;

    const levelDelta = level - target.level;
    if (levelDelta < -3 || levelDelta > 2) continue;

    const difficultyFit = Math.max(0, 1 - Math.abs(levelDelta) / (levelDelta > 0 ? 2.5 : 3.5));
    const passability = (candidate.clears + 2) / (candidate.attempts + 4);
    const popularity = Math.log1p(candidate.attempts) / Math.log1p(maxAttempts);
    const exploration = stableUnitInterval(`${args.explorationSeed ?? "recommendation"}:${candidate.songName}:${chartToken}`);
    const score = difficultyFit * 0.58 + passability * 0.25 + popularity * 0.15 + exploration * 0.02;
    ranked.push({ songName: candidate.songName, chartToken, score, targetLevel: target.level });
  }

  ranked.sort((left, right) => right.score - left.score || left.songName.localeCompare(right.songName) || left.chartToken.localeCompare(right.chartToken));

  const seenSongs = new Set<string>();
  return ranked.filter((candidate) => {
    const key = normalizeSongName(candidate.songName);
    if (seenSongs.has(key)) return false;
    seenSongs.add(key);
    return true;
  }).slice(0, Math.max(1, args.limit ?? 200));
}

function matchesLevelFilter(rawLevel: string, levels: Set<string>): boolean {
  if (levels.size === 0 || levels.has(rawLevel)) return true;
  const numericLevel = Number.parseInt(rawLevel, 10);
  const catalogLevel = /^\d{1,2}$/.test(rawLevel) && numericLevel >= 1 && numericLevel <= 27
    ? String(numericLevel)
    : "+";
  return levels.has(catalogLevel);
}

function mergePopulationEvidence(candidates: PopulationChartEvidence[]): PopulationChartEvidence[] {
  const merged = new Map<string, PopulationChartEvidence>();
  for (const candidate of candidates) {
    const token = catalogChartTokenFromPlay(candidate);
    if (!token) continue;
    const key = `${normalizeSongName(candidate.songName)}:${token}`;
    const current = merged.get(key);
    if (current) {
      current.attempts += candidate.attempts;
      current.clears += candidate.clears;
    } else {
      merged.set(key, { ...candidate });
    }
  }
  return Array.from(merged.values());
}

function stableUnitInterval(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}
