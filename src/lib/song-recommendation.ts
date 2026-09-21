import { estimateSkillTargets, type ChartMode, type ChartSelectionEvidence } from "./chart-recommendation.ts";
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

export function rankChartRecommendations(args: {
  candidates: PopulationChartEvidence[];
  userEvidence: ChartSelectionEvidence[];
  preferredModes: ChartMode[];
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
  const mergedCandidates = mergePopulationEvidence(args.candidates);
  const maxAttempts = Math.max(1, ...mergedCandidates.map((candidate) => candidate.attempts));
  const ranked: RankedChartRecommendation[] = [];

  for (const candidate of mergedCandidates) {
    const chartToken = catalogChartTokenFromPlay(candidate);
    const mode = chartToken?.[0] as ChartMode | undefined;
    const level = Number.parseInt(String(candidate.level ?? ""), 10);
    const target = mode ? targets.get(mode) : undefined;
    if (!chartToken || !mode || !modes.includes(mode) || !target || !Number.isFinite(level)) continue;
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

function normalizeSongName(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
}

function stableUnitInterval(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}
