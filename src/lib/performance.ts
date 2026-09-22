import "server-only";

import { createHash } from "node:crypto";
import { MongoServerError, ObjectId, type Collection, type Filter, type Sort, type WithId } from "mongodb";
import { PiuClient, type BestPlay, type PlayerData, type RecentPlay, type TopPlay } from "@austinkimchi/piugame-sdk";

import { recommendChartToken, type ChartMode, type ChartSelectionEvidence } from "@/lib/chart-recommendation";
import type { CryptoPayloadV1 } from "@/lib/credential-crypto";
import { decryptCredential } from "@/lib/credential-crypto";
import { getMongoClient, hasMongoConfig } from "@/lib/mongodb";
import type { MobilePerformanceImport } from "@/lib/mobile-sync-schema";
import { performanceChartTokenCandidates, performanceChartTokenCandidatesFromPlay, performanceChartTokenKey } from "@/lib/performance-chart-key";
import { piuTimestampToDate } from "@/lib/performance-format";
import { PERFORMANCE_CHART_STATS_POPULATION_INDEX } from "@/lib/performance-indexes";
import { performancePlayKey } from "@/lib/performance-play-key";
import { metricChangeSince, roundedAverageBestScore } from "@/lib/performance-metrics";
import { startsNewSession } from "@/lib/performance-session";
import { applyBucketBestSummary, applyRecentPlaySummary, applyTopPlaySummary, type PerformanceChartStatSummary } from "@/lib/performance-stat-summary";
import { populationCandidatesInCatalog, rankChartRecommendations, recommendationCandidatesFromCatalog, type PopulationChartEvidence, type RankedChartRecommendation } from "@/lib/song-recommendation";
import { shouldTreatRecentPlaysAsEmpty } from "@/lib/performance-sync-errors";
import { fetchPumbilityScore } from "@/lib/piu-pumbility";
import { normalizePiuGameVersion } from "@/lib/piu-version";
import type { PiuCatalogVersion, PublicSong } from "@/lib/types";

const COMMUNITY_DB_NAME = process.env.COMMUNITY_DB_NAME ?? "piugame_web";
const USERS_COLLECTION = process.env.COMMUNITY_USERS_COLLECTION ?? "users";
const PERFORMANCE_PROFILES_COLLECTION = process.env.PERFORMANCE_PROFILES_COLLECTION ?? "performance_profiles";
const PERFORMANCE_PLAYS_COLLECTION = process.env.PERFORMANCE_PLAYS_COLLECTION ?? "performance_play_events";
const PERFORMANCE_CHART_STATS_COLLECTION = process.env.PERFORMANCE_CHART_STATS_COLLECTION ?? "performance_chart_stats";
const PERFORMANCE_METRIC_SNAPSHOTS_COLLECTION = process.env.PERFORMANCE_METRIC_SNAPSHOTS_COLLECTION ?? "performance_metric_snapshots";
const PERFORMANCE_REFRESH_MINUTES = Number(process.env.PERFORMANCE_REFRESH_MINUTES ?? "30");
const PERFORMANCE_TOP_PLAYS_REFRESH_HOURS = Number(process.env.PERFORMANCE_TOP_PLAYS_REFRESH_HOURS ?? "24");
const PERFORMANCE_SYNC_BATCH_SIZE = Number(process.env.PERFORMANCE_SYNC_BATCH_SIZE ?? "5");
const PERFORMANCE_RECENT_PLAYS_PAGE_SIZE = 35;
const PERFORMANCE_TOP_CHARTS_PAGE_SIZE = 35;

declare global {
  var piuPerformanceIndexesPromise: Promise<void> | undefined;
}

type SyncStatus = "idle" | "queued" | "syncing" | "synced" | "failed";
type AllPlaysSyncStatus = "queued" | "syncing" | "synced" | "failed";

interface MinimalUserDocument {
  updatedAt?: Date;
  preferences?: {
    performanceAutoRefresh?: boolean;
    piuGameVersion?: PiuCatalogVersion;
  };
  piuLink?: {
    piuUsername?: string;
    displayName?: string;
    avatarUrl?: string | null;
    lastProfileFetchedAt?: Date;
    lastMobileSnapshotGeneratedAt?: Date;
    encryptedPassword?: CryptoPayloadV1;
  };
}

interface PerformanceProfileDocument {
  userId: ObjectId;
  piuVersion: PiuCatalogVersion;
  piuUsername: string;
  displayName: string;
  titleName: string | null;
  gameId: string | null;
  pumpTag: string | null;
  avatarUrl: string | null;
  pumbilityScore: number | null;
  pp: number | null;
  rating: number | null;
  playCount: number | null;
  clearCount: number | null;
  totalCharts: number | null;
  progressPercent: number | null;
  plateCounts: Record<string, number>;
  recentArcade: string | null;
  lastAccess: string | null;
  syncStatus: SyncStatus;
  syncError: string | null;
  lastSyncedAt: Date | null;
  lastSnapshotGeneratedAt?: Date | null;
  allPlaysSyncStatus?: AllPlaysSyncStatus | null;
  allPlaysSyncError?: string | null;
  allPlaysSyncedAt?: Date | null;
  allPlaysLeaseUntil?: Date | null;
  topPlaysSyncedAt?: Date | null;
  nextTopPlaysRefreshAt?: Date | null;
  nextRefreshAt: Date;
  syncLeaseUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface PerformancePlayEventDocument {
  userId: ObjectId;
  piuVersion: PiuCatalogVersion;
  playHash: string;
  playKey?: string;
  piuUsername: string;
  songName: string;
  chartToken: string;
  mode: string | null;
  level: string | null;
  score: number | null;
  grade: string | null;
  plate: string | null;
  stageBreak: boolean;
  judgments: RecentPlay["judgments"];
  playedAt: Date | null;
  playedAtRaw: string | null;
  source: "recent";
  ingestedAt: Date;
}

interface PerformanceChartStatDocument extends PerformanceChartStatSummary {
  userId: ObjectId;
  piuVersion: PiuCatalogVersion;
  chartToken: string;
  piuUsername: string;
  revision?: number;
}

interface PerformanceMetricSnapshotDocument {
  userId: ObjectId;
  piuVersion: PiuCatalogVersion;
  capturedAt: Date;
  pumbilityScore: number | null;
  averageBestScore: number | null;
}

export interface PerformanceDashboard {
  profile: {
    displayName: string;
    piuUsername: string;
    titleName: string | null;
    gameId: string | null;
    pumpTag: string | null;
    avatarUrl: string | null;
    pumbilityScore: number | null;
    pp: number | null;
    rating: number | null;
    playCount: number | null;
    clearCount: number | null;
    totalCharts: number | null;
    progressPercent: number | null;
    recentArcade: string | null;
    lastAccess: string | null;
    syncStatus: SyncStatus;
    syncError: string | null;
    lastSyncedAt: string | null;
    allPlaysSyncStatus: AllPlaysSyncStatus | null;
    allPlaysSyncError: string | null;
    allPlaysSyncedAt: string | null;
    topPlaysSyncedAt: string | null;
    nextTopPlaysRefreshAt: string | null;
    nextRefreshAt: string | null;
  } | null;
  totals: {
    trackedPlays: number;
    trackedCharts: number;
    trackedPumbilityCharts: number;
    upscores: number;
    upscoresThisWeek: number;
    upscoresThisMonth: number;
    upscoresToday: number;
    recentNewScores: number;
    averageBestScore: number | null;
    pumbilityChange24Hours: number | null;
    averageBestScoreChange24Hours: number | null;
    recentlyPlayed: number;
  };
  recentPlays: Array<{
    songName: string;
    chartToken: string;
    score: number | null;
    grade: string | null;
    plate: string | null;
    mode: string | null;
    level: string | null;
    playedAt: string | null;
    stageBreak: boolean;
  }>;
  topCharts: Array<{
    songName: string;
    chartToken: string;
    bestScore: number | null;
    previousBestScore: number | null;
    delta: number | null;
    bestGrade: string | null;
    bestPlate: string | null;
    mode: string | null;
    level: string | null;
    bestBucketPage: number | null;
    bestSyncedAt: string | null;
    topPlayRank: number | null;
    topPumbilityScore: number | null;
    topPlayedAt: string | null;
    topPlaysSyncedAt: string | null;
  }>;
  canSync: boolean;
  mongoReady: boolean;
}

export interface PerformanceSyncResult {
  scanned: number;
  synced: number;
  backfilled: number;
  failed: number;
  skipped: number;
}

export interface PerformanceRecentPlaysPage {
  recentPlays: PerformanceDashboard["recentPlays"];
  nextOffset: number | null;
  total: number;
}

export interface FreshPerformanceRecentPlays {
  recentPlays: RecentPlay[];
  persist(): Promise<void>;
}

export interface MobilePerformanceImportResult {
  importedRecentPlays: number;
  duplicateRecentPlays: number;
}

export class MobilePerformanceImportError extends Error {
  readonly code: "account_not_found" | "piu_account_not_linked" | "piu_username_mismatch";

  constructor(code: "account_not_found" | "piu_account_not_linked" | "piu_username_mismatch") {
    super(code);
    this.code = code;
  }
}

export type PerformanceTopChartsSort = "pumbility" | "score";

export interface PerformanceTopChartsPage {
  topCharts: PerformanceDashboard["topCharts"];
  nextOffset: number | null;
  total: number;
  sort: PerformanceTopChartsSort;
}

export interface SongChartPerformance {
  latestPlay: {
    id: string;
    score: number | null;
    grade: string | null;
    plate: string | null;
    playedAt: string | null;
    stageBreak: boolean;
    judgments: RecentPlay["judgments"];
  } | null;
  history: Array<{
    id: string;
    score: number | null;
    grade: string | null;
    plate: string | null;
    playedAt: string | null;
    stageBreak: boolean;
    judgments: RecentPlay["judgments"];
  }>;
  stats: {
    bestScore: number | null;
    previousBestScore: number | null;
    latestScore: number | null;
    latestStageBreak: boolean;
    latestPlayedAt: string | null;
    recentPlayCount: number;
    stageBreakCount: number;
    bestGrade: string | null;
    bestPlate: string | null;
    bestBucketPage: number | null;
    bestSyncedAt: string | null;
  } | null;
}

export interface ScoreLinkablePerformancePlay {
  id: string;
  piuVersion: PiuCatalogVersion;
  score: number | null;
  grade: string | null;
  plate: string | null;
  stageBreak: boolean;
  judgments: RecentPlay["judgments"];
  playedAt: string | null;
}

async function collections() {
  if (!hasMongoConfig()) {
    throw new Error("MongoDB is required for performance features.");
  }

  const client = await getMongoClient();
  const db = client.db(COMMUNITY_DB_NAME);
  const result = {
    users: db.collection<MinimalUserDocument>(USERS_COLLECTION),
    profiles: db.collection<PerformanceProfileDocument>(PERFORMANCE_PROFILES_COLLECTION),
    plays: db.collection<PerformancePlayEventDocument>(PERFORMANCE_PLAYS_COLLECTION),
    chartStats: db.collection<PerformanceChartStatDocument>(PERFORMANCE_CHART_STATS_COLLECTION),
    metricSnapshots: db.collection<PerformanceMetricSnapshotDocument>(PERFORMANCE_METRIC_SNAPSHOTS_COLLECTION),
  };

  if (!globalThis.piuPerformanceIndexesPromise) {
    globalThis.piuPerformanceIndexesPromise = ensurePerformanceIndexes(result);
  }
  await globalThis.piuPerformanceIndexesPromise;

  return result;
}

async function ensurePerformanceIndexes(args: {
  profiles: Collection<PerformanceProfileDocument>;
  plays: Collection<PerformancePlayEventDocument>;
  chartStats: Collection<PerformanceChartStatDocument>;
  metricSnapshots: Collection<PerformanceMetricSnapshotDocument>;
}): Promise<void> {
  await Promise.all([
    dropLegacyPerformanceVersionIndexes(args.profiles),
    dropLegacyPerformanceVersionIndexes(args.plays),
    dropLegacyPerformanceVersionIndexes(args.chartStats),
  ]);

  await Promise.all([
    args.profiles.createIndex({ userId: 1, piuVersion: 1 }, { unique: true }),
    args.profiles.createIndex({ piuVersion: 1, nextRefreshAt: 1, syncStatus: 1, syncLeaseUntil: 1 }),
    args.profiles.createIndex({ piuVersion: 1, allPlaysSyncStatus: 1, allPlaysLeaseUntil: 1, updatedAt: 1 }),
    args.plays.createIndex({ userId: 1, piuVersion: 1, playHash: 1 }, { unique: true }),
    args.plays.createIndex({ userId: 1, piuVersion: 1, playKey: 1 }, { unique: true, partialFilterExpression: { playKey: { $type: "string" } } }),
    args.plays.createIndex({ userId: 1, piuVersion: 1, playedAt: -1, ingestedAt: -1 }),
    args.plays.createIndex({ userId: 1, piuVersion: 1, chartToken: 1, playedAt: -1 }),
    args.chartStats.createIndex({ userId: 1, piuVersion: 1, chartToken: 1 }, { unique: true }),
    args.chartStats.createIndex({ userId: 1, piuVersion: 1, songName: 1 }),
    args.chartStats.createIndex(PERFORMANCE_CHART_STATS_POPULATION_INDEX),
    args.chartStats.createIndex({ userId: 1, piuVersion: 1, bestScore: -1 }),
    args.chartStats.createIndex({ userId: 1, piuVersion: 1, topPlayRank: 1, bestScore: -1 }),
    args.chartStats.createIndex({ userId: 1, piuVersion: 1, updatedAt: -1 }),
    args.metricSnapshots.createIndex({ userId: 1, piuVersion: 1, capturedAt: -1 }),
  ]);
}

async function dropLegacyPerformanceVersionIndexes<T extends PerformanceProfileDocument | PerformancePlayEventDocument | PerformanceChartStatDocument>(collection: Collection<T>): Promise<void> {
  const indexes = await collection.indexes();
  const legacyIndexes = indexes.filter(
    (index) =>
      index.name !== "_id_" &&
      index.unique === true &&
      Object.hasOwn(index.key ?? {}, "userId") &&
      !Object.hasOwn(index.key ?? {}, "piuVersion"),
  );
  const legacyIndexNames = legacyIndexes.map((index) => index.name).filter((name): name is string => Boolean(name));
  await Promise.all(legacyIndexNames.map((name) => collection.dropIndex(name)));
}

function recentPlaySort(direction: "asc" | "desc" = "desc") {
  const order = direction === "asc" ? 1 : -1;
  return { playedAt: order, ingestedAt: order, _id: order } as const;
}

async function getLatestSessionPlayCount(plays: Collection<PerformancePlayEventDocument>, userId: ObjectId, piuVersion: PiuCatalogVersion): Promise<number> {
  const cursor = plays
    .find({ userId, piuVersion, playedAt: { $type: "date" } }, { projection: { playedAt: 1 } })
    .sort({ playedAt: -1, ingestedAt: -1, _id: -1 });

  let previous: Date | null = null;
  let count = 0;

  try {
    for await (const play of cursor) {
      if (!play.playedAt) {
        continue;
      }
      if (previous && startsNewSession(previous, play.playedAt)) {
        break;
      }
      count += 1;
      previous = play.playedAt;
    }
  } finally {
    await cursor.close();
  }

  return count;
}

async function getRolling24HourMetricBaseline(
  metricSnapshots: Collection<PerformanceMetricSnapshotDocument>,
  userId: ObjectId,
  piuVersion: PiuCatalogVersion,
  twentyFourHoursAgo: Date,
): Promise<WithId<PerformanceMetricSnapshotDocument> | null> {
  const fullWindowBaseline = await metricSnapshots
    .find({ userId, piuVersion, capturedAt: { $lte: twentyFourHoursAgo } })
    .sort({ capturedAt: -1 })
    .limit(1)
    .next();

  if (fullWindowBaseline) {
    return fullWindowBaseline;
  }

  return metricSnapshots.find({ userId, piuVersion }).sort({ capturedAt: 1 }).limit(1).next();
}

function topChartsSort(sort: PerformanceTopChartsSort): Sort {
  if (sort === "pumbility") {
    return { topPlayRank: 1, bestScore: -1, updatedAt: -1, _id: 1 };
  }

  return { bestScore: -1, updatedAt: -1, _id: 1 };
}

export async function getPerformanceDashboard(userIdInput: string | null): Promise<PerformanceDashboard> {
  const empty = emptyDashboard(hasMongoConfig());
  const userId = objectIdFromString(userIdInput);
  if (!userId || !hasMongoConfig()) {
    return empty;
  }

  const { users, profiles, plays, chartStats, metricSnapshots } = await collections();
  const piuVersion = await performanceVersionForUser(users, userId);
  await ensureUserPerformanceSchedule(userId, users, profiles, piuVersion);

  const now = new Date();
  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setUTCDate(startOfWeek.getUTCDate() - 6);
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const upscoreFilter = { userId, piuVersion, lastUpscoredAt: { $ne: null } };
  const [profile, recentPlays, topCharts, trackedPlays, trackedCharts, trackedPumbilityCharts, upscoreCharts, upscoresThisWeek, upscoresThisMonth, upscoresToday, recentNewScores, averageScores, dailyBaseline, recentlyPlayed] = await Promise.all([
    profiles.findOne({ userId, piuVersion }),
    plays.find({ userId, piuVersion }).sort(recentPlaySort()).limit(PERFORMANCE_RECENT_PLAYS_PAGE_SIZE).toArray(),
    chartStats.find(topChartsFilter(userId, piuVersion, "pumbility")).sort(topChartsSort("pumbility")).limit(PERFORMANCE_TOP_CHARTS_PAGE_SIZE).toArray(),
    plays.countDocuments({ userId, piuVersion }),
    chartStats.countDocuments({ userId, piuVersion }),
    chartStats.countDocuments(topChartsFilter(userId, piuVersion, "pumbility")),
    chartStats.countDocuments(upscoreFilter),
    chartStats.countDocuments({ ...upscoreFilter, lastUpscoredAt: { $gte: startOfWeek } }),
    chartStats.countDocuments({ ...upscoreFilter, lastUpscoredAt: { $gte: startOfMonth } }),
    chartStats.countDocuments({ ...upscoreFilter, lastUpscoredAt: { $gte: startOfToday } }),
    chartStats.countDocuments({ ...upscoreFilter, lastUpscoredAt: { $gte: twentyFourHoursAgo } }),
    chartStats
      .aggregate<{ averageBestScore: number }>([
        { $match: { userId, piuVersion, bestScore: { $type: "number" } } },
        { $group: { _id: null, averageBestScore: { $avg: "$bestScore" } } },
      ])
      .toArray(),
    getRolling24HourMetricBaseline(metricSnapshots, userId, piuVersion, twentyFourHoursAgo),
    getLatestSessionPlayCount(plays, userId, piuVersion),
  ]);

  const averageBestScore = roundedAverageBestScore(averageScores[0]?.averageBestScore);

  const publicTopCharts = await publicTopChartsWithRecentBestFallback(plays, userId, piuVersion, topCharts);

  return {
    profile: profile ? publicProfile(profile) : null,
    totals: {
      trackedPlays,
      trackedCharts,
      trackedPumbilityCharts,
      upscores: upscoreCharts,
      upscoresThisWeek,
      upscoresThisMonth,
      upscoresToday,
      recentNewScores,
      averageBestScore,
      pumbilityChange24Hours: metricChangeSince(profile?.pumbilityScore ?? null, dailyBaseline?.pumbilityScore ?? null),
      averageBestScoreChange24Hours: metricChangeSince(averageBestScore, dailyBaseline?.averageBestScore ?? null),
      recentlyPlayed,
    },
    recentPlays: recentPlays.map(publicRecentPlay),
    topCharts: publicTopCharts,
    canSync: Boolean(profile),
    mongoReady: true,
  };
}

export async function getPerformanceTopCharts(
  userIdInput: string | null,
  args: { offset?: number; limit?: number; sort?: PerformanceTopChartsSort } = {},
): Promise<PerformanceTopChartsPage> {
  const userId = objectIdFromString(userIdInput);
  const sort = normalizeTopChartsSort(args.sort);
  if (!userId || !hasMongoConfig()) {
    return { topCharts: [], nextOffset: null, total: 0, sort };
  }

  const offset = Math.max(0, Math.trunc(args.offset ?? 0));
  const limit = Math.min(Math.max(1, Math.trunc(args.limit ?? PERFORMANCE_TOP_CHARTS_PAGE_SIZE)), PERFORMANCE_TOP_CHARTS_PAGE_SIZE);
  const { users, chartStats, plays } = await collections();
  const piuVersion = await performanceVersionForUser(users, userId);
  const filter = topChartsFilter(userId, piuVersion, sort);
  const [topCharts, total] = await Promise.all([
    chartStats.find(filter).sort(topChartsSort(sort)).skip(offset).limit(limit).toArray(),
    chartStats.countDocuments(filter),
  ]);

  return {
    topCharts: await publicTopChartsWithRecentBestFallback(plays, userId, piuVersion, topCharts),
    nextOffset: offset + topCharts.length < total ? offset + topCharts.length : null,
    total,
    sort,
  };
}

async function publicTopChartsWithRecentBestFallback(
  plays: Collection<PerformancePlayEventDocument>,
  userId: ObjectId,
  piuVersion: PiuCatalogVersion,
  charts: Array<WithId<PerformanceChartStatDocument>>,
): Promise<PerformanceDashboard["topCharts"]> {
  const chartTokensWithoutBest = charts.filter((chart) => chart.bestScore === null).map((chart) => chart.chartToken);
  if (chartTokensWithoutBest.length === 0) {
    return charts.map(publicTopChart);
  }

  const fallbackPlays = await plays
    .find({
      userId,
      piuVersion,
      chartToken: { $in: chartTokensWithoutBest },
      score: { $gte: 0 },
      stageBreak: { $ne: true },
      grade: { $not: /^x_/i },
    })
    .sort({ chartToken: 1, score: -1, playedAt: -1, ingestedAt: -1, _id: -1 })
    .toArray();
  const bestPlayByChart = new Map<string, PerformancePlayEventDocument>();
  for (const play of fallbackPlays) {
    if (!bestPlayByChart.has(play.chartToken)) {
      bestPlayByChart.set(play.chartToken, play);
    }
  }

  return charts.map((chart) => {
    const fallback = bestPlayByChart.get(chart.chartToken);
    if (!fallback) {
      return publicTopChart(chart);
    }

    return {
      ...publicTopChart(chart),
      bestScore: fallback.score,
      bestGrade: fallback.grade,
      bestPlate: fallback.plate,
      bestSyncedAt: fallback.playedAt?.toISOString() ?? null,
    };
  });
}

export async function getPerformanceRecentPlays(
  userIdInput: string | null,
  args: { offset?: number; limit?: number; sortDirection?: "asc" | "desc" } = {},
): Promise<PerformanceRecentPlaysPage> {
  const userId = objectIdFromString(userIdInput);
  if (!userId || !hasMongoConfig()) {
    return { recentPlays: [], nextOffset: null, total: 0 };
  }

  const offset = Math.max(0, Math.trunc(args.offset ?? 0));
  const limit = Math.min(Math.max(1, Math.trunc(args.limit ?? PERFORMANCE_RECENT_PLAYS_PAGE_SIZE)), PERFORMANCE_RECENT_PLAYS_PAGE_SIZE);
  const { users, plays } = await collections();
  const piuVersion = await performanceVersionForUser(users, userId);
  const [recentPlays, total] = await Promise.all([
    plays.find({ userId, piuVersion }).sort(recentPlaySort(args.sortDirection)).skip(offset).limit(limit).toArray(),
    plays.countDocuments({ userId, piuVersion }),
  ]);

  return {
    recentPlays: recentPlays.map(publicRecentPlay),
    nextOffset: offset + recentPlays.length < total ? offset + recentPlays.length : null,
    total,
  };
}

export async function addChartRecommendationsToSongs(
  userIdInput: string | null,
  piuVersion: PiuCatalogVersion,
  songs: PublicSong[],
  preferredModes: ChartMode[] = [],
): Promise<PublicSong[]> {
  const userId = objectIdFromString(userIdInput);
  if (!userId || !hasMongoConfig() || songs.length === 0) {
    return songs;
  }

  const songNames = Array.from(new Set(songs.map((song) => song.title)));
  const { chartStats } = await collections();
  const projection = {
    _id: 0,
    songName: 1,
    mode: 1,
    level: 1,
    bestScore: 1,
    latestPlayedAt: 1,
  } as const;
  const [songEvidence, skillEvidence] = await Promise.all([
    chartStats.find({ userId, piuVersion, songName: { $in: songNames } }, { projection }).toArray(),
    chartStats.find({ userId, piuVersion, bestScore: { $exists: true, $ne: null } }, { projection }).toArray(),
  ]);
  const evidenceBySong = new Map<string, ChartSelectionEvidence[]>();
  for (const evidence of songEvidence) {
    const key = songLookupKey(evidence.songName);
    const existing = evidenceBySong.get(key) ?? [];
    existing.push(evidence);
    evidenceBySong.set(key, existing);
  }
  const now = new Date();

  return songs.map((song) => ({
    ...song,
    recommendedChartToken: recommendChartToken({
      songName: song.title,
      chartTokens: song.chartSummary,
      songEvidence: evidenceBySong.get(songLookupKey(song.title)) ?? [],
      skillEvidence,
      preferredModes,
      now,
    }),
  }));
}

export async function getPerformanceChartRecommendations(
  userIdInput: string | null,
  piuVersion: PiuCatalogVersion,
  songs: Array<Pick<PublicSong, "title" | "chartSummary">>,
  preferredModes: ChartMode[],
  levels: string[] = [],
  limit = 1000,
): Promise<RankedChartRecommendation[]> {
  const userId = objectIdFromString(userIdInput);
  if (!userId || !hasMongoConfig()) return [];

  const { chartStats } = await collections();
  const [userEvidence, candidates] = await Promise.all([
    chartStats.find(
      { userId, piuVersion },
      { projection: { _id: 0, songName: 1, mode: 1, level: 1, bestScore: 1, latestPlayedAt: 1 } },
    ).toArray(),
    chartStats.aggregate<PopulationChartEvidence>([
      { $match: { piuVersion } },
      {
        $group: {
          _id: { songName: "$songName", mode: "$mode", level: "$level" },
          attempts: { $sum: 1 },
          clears: { $sum: { $cond: [{ $isNumber: "$bestScore" }, 1, 0] } },
        },
      },
      { $sort: { attempts: -1 } },
      { $limit: 1200 },
      { $project: { _id: 0, songName: "$_id.songName", mode: "$_id.mode", level: "$_id.level", attempts: 1, clears: 1 } },
    ]).toArray(),
  ]);

  const catalogCandidates = recommendationCandidatesFromCatalog(songs);
  const currentPopulationCandidates = populationCandidatesInCatalog(candidates, songs);

  return rankChartRecommendations({
    candidates: [...catalogCandidates, ...currentPopulationCandidates],
    userEvidence,
    preferredModes,
    levels,
    explorationSeed: userId.toHexString(),
    limit,
  });
}

export async function getSongChartPerformance(
  userIdInput: string | null,
  args: { songName: string; chartToken: string | null | undefined; piuVersion: PiuCatalogVersion; limit?: number },
): Promise<SongChartPerformance | null> {
  const userId = objectIdFromString(userIdInput);
  if (!userId || !hasMongoConfig()) {
    return null;
  }

  const chartTokens = performanceChartTokenCandidates(args.songName, args.chartToken);
  if (chartTokens.length === 0) {
    return null;
  }

  const limit = Math.min(Math.max(1, Math.trunc(args.limit ?? 30)), 100);
  const { plays, chartStats } = await collections();
  const [historyDesc, statsCandidates] = await Promise.all([
    plays.find({ userId, piuVersion: args.piuVersion, chartToken: { $in: chartTokens } }).sort(recentPlaySort()).limit(limit).toArray(),
    chartStats.find({ userId, piuVersion: args.piuVersion, chartToken: { $in: chartTokens } }).toArray(),
  ]);
  const stats = firstByCandidateOrder(statsCandidates, chartTokens);

  return {
    latestPlay: historyDesc[0] ? publicSongChartPlay(historyDesc[0]) : null,
    history: historyDesc.toReversed().map(publicSongChartPlay),
    stats: stats
        ? {
            bestScore: stats.bestScore,
            previousBestScore: stats.previousBestScore,
            latestScore: stats.latestScore,
            latestStageBreak: stats.latestStageBreak,
            latestPlayedAt: stats.latestPlayedAt?.toISOString() ?? null,
            recentPlayCount: stats.recentPlayCount,
            stageBreakCount: stats.stageBreakCount,
            bestGrade: stats.bestGrade,
            bestPlate: stats.bestPlate,
            bestBucketPage: stats.bestBucketPage,
            bestSyncedAt: stats.bestSyncedAt?.toISOString() ?? null,
          }
        : null,
  };
}

export async function getScoreLinkablePerformancePlay(
  userIdInput: string | null,
  args: { playId: string; songName: string; chartToken: string },
): Promise<ScoreLinkablePerformancePlay | null> {
  const userId = objectIdFromString(userIdInput);
  const playId = objectIdFromString(args.playId);
  const chartToken = args.chartToken.trim().toUpperCase();
  if (!userId || !playId || !chartToken || !hasMongoConfig()) {
    return null;
  }

  const chartTokens = performanceChartTokenCandidates(args.songName, chartToken);
  if (chartTokens.length === 0) {
    return null;
  }

  const { plays } = await collections();
  const play = await plays.findOne({ _id: playId, userId });
  if (!play || !chartTokens.includes(play.chartToken) || songLookupKey(play.songName) !== songLookupKey(args.songName)) {
    return null;
  }

  const playedAtFromRaw = parsePlayDate(play.playedAtRaw);
  return {
    id: play._id.toHexString(),
    piuVersion: play.piuVersion,
    score: play.score,
    grade: play.grade,
    plate: play.plate,
    stageBreak: play.stageBreak,
    judgments: play.judgments,
    playedAt: playedAtFromRaw?.toISOString() ?? play.playedAt?.toISOString() ?? play.playedAtRaw,
  };
}

export async function syncDuePerformanceUsers(): Promise<PerformanceSyncResult> {
  if (!hasMongoConfig()) {
    return { scanned: 0, synced: 0, backfilled: 0, failed: 0, skipped: 0 };
  }

  const { users, profiles } = await collections();
  const now = new Date();
  const batchSize = Math.max(1, PERFORMANCE_SYNC_BATCH_SIZE);
  const autoRefreshUsers = await users
    .find({
      "preferences.performanceAutoRefresh": true,
      "piuLink.piuUsername": { $type: "string" },
      "piuLink.encryptedPassword": { $exists: true },
    })
    .limit(batchSize * 2)
    .toArray();

  const result: PerformanceSyncResult = { scanned: 0, synced: 0, backfilled: 0, failed: 0, skipped: 0 };
  for (const user of autoRefreshUsers) {
    if (result.scanned >= batchSize) {
      break;
    }

    const piuVersion = normalizePiuGameVersion(user.preferences?.piuGameVersion);
    await ensureUserPerformanceSchedule(user._id, users, profiles, piuVersion);
    const profile = await profiles.findOne({
      userId: user._id,
      piuVersion,
      nextRefreshAt: { $lte: now },
      $or: [{ syncLeaseUntil: null }, { syncLeaseUntil: { $lte: now } }],
    });

    if (!profile) {
      result.skipped += 1;
      continue;
    }

    result.scanned += 1;
    const claimed = await profiles.findOneAndUpdate(
      { _id: profile._id, $or: [{ syncLeaseUntil: null }, { syncLeaseUntil: { $lte: now } }] },
      { $set: { syncStatus: "syncing", syncLeaseUntil: new Date(Date.now() + 5 * 60 * 1000), updatedAt: now } },
      { returnDocument: "after" },
    );

    if (!claimed) {
      result.skipped += 1;
      continue;
    }

    try {
      await syncSingleUserPerformance(profile.userId, user, piuVersion);
      result.synced += 1;
    } catch (error) {
      await markSyncFailed(profile.userId, piuVersion, error);
      result.failed += 1;
    }
  }

  const backfillResult = await syncQueuedAllPlaysBackfills(batchSize);
  result.scanned += backfillResult.scanned;
  result.backfilled += backfillResult.backfilled;
  result.failed += backfillResult.failed;
  result.skipped += backfillResult.skipped;

  return result;
}

export async function syncQueuedAllPlaysBackfillForUser(userIdInput: string | null): Promise<boolean> {
  const userId = objectIdFromString(userIdInput);
  if (!userId || !hasMongoConfig()) {
    return false;
  }

  const { users, profiles, chartStats } = await collections();
  const now = new Date();
  const profile = await profiles.findOne({
    userId,
    piuVersion: await performanceVersionForUser(users, userId),
    allPlaysSyncStatus: "queued",
    allPlaysSyncedAt: null,
    $or: [{ allPlaysLeaseUntil: null }, { allPlaysLeaseUntil: { $lte: now } }],
  });

  if (!profile) {
    return false;
  }

  const claimed = await profiles.findOneAndUpdate(
    {
      _id: profile._id,
      allPlaysSyncStatus: "queued",
      allPlaysSyncedAt: null,
      $or: [{ allPlaysLeaseUntil: null }, { allPlaysLeaseUntil: { $lte: now } }],
    },
    {
      $set: {
        allPlaysSyncStatus: "syncing",
        allPlaysSyncError: null,
        allPlaysLeaseUntil: new Date(Date.now() + 30 * 60 * 1000),
        updatedAt: now,
      },
    },
    { returnDocument: "after" },
  );

  if (!claimed) {
    return false;
  }

  try {
    const user = await users.findOne({ _id: userId });
    await backfillAllPlaysForUser(userId, user, chartStats, claimed.piuVersion);
    return true;
  } catch (error) {
    await markAllPlaysBackfillFailed(userId, profile.piuVersion, error);
    return false;
  }
}

async function syncQueuedAllPlaysBackfills(batchSize: number): Promise<Pick<PerformanceSyncResult, "scanned" | "backfilled" | "failed" | "skipped">> {
  const { users, profiles, chartStats } = await collections();
  const now = new Date();
  const queuedProfiles = await profiles
    .find({
      allPlaysSyncStatus: "queued",
      allPlaysSyncedAt: null,
      $or: [{ allPlaysLeaseUntil: null }, { allPlaysLeaseUntil: { $lte: now } }],
    })
    .sort({ updatedAt: 1 })
    .limit(batchSize)
    .toArray();

  const result = { scanned: queuedProfiles.length, backfilled: 0, failed: 0, skipped: 0 };
  for (const profile of queuedProfiles) {
    const claimed = await profiles.findOneAndUpdate(
      {
        _id: profile._id,
        allPlaysSyncStatus: "queued",
        allPlaysSyncedAt: null,
        $or: [{ allPlaysLeaseUntil: null }, { allPlaysLeaseUntil: { $lte: now } }],
      },
      {
        $set: {
          allPlaysSyncStatus: "syncing",
          allPlaysSyncError: null,
          allPlaysLeaseUntil: new Date(Date.now() + 30 * 60 * 1000),
          updatedAt: now,
        },
      },
      { returnDocument: "after" },
    );

    if (!claimed) {
      result.skipped += 1;
      continue;
    }

    try {
      const user = await users.findOne({ _id: profile.userId });
      await backfillAllPlaysForUser(profile.userId, user, chartStats, profile.piuVersion);
      result.backfilled += 1;
    } catch (error) {
      await markAllPlaysBackfillFailed(profile.userId, profile.piuVersion, error);
      result.failed += 1;
    }
  }

  return result;
}

export async function syncCurrentUserPerformance(userIdInput: string | null): Promise<void> {
  const userId = objectIdFromString(userIdInput);
  if (!userId) {
    throw new Error("Sign in before syncing performance data.");
  }

  const { users } = await collections();
  const user = await users.findOne({ _id: userId });
  try {
    await syncSingleUserPerformance(userId, user, normalizePiuGameVersion(user?.preferences?.piuGameVersion));
  } catch (error) {
    await markSyncFailed(userId, normalizePiuGameVersion(user?.preferences?.piuGameVersion), error);
    throw error;
  }
}

export async function importMobilePerformanceSnapshot(
  userIdInput: string | null,
  input: MobilePerformanceImport,
): Promise<MobilePerformanceImportResult> {
  const userId = objectIdFromString(userIdInput);
  if (!userId) {
    throw new MobilePerformanceImportError("account_not_found");
  }

  const { users } = await collections();
  const user = await users.findOne({ _id: userId });
  if (!user) {
    throw new MobilePerformanceImportError("account_not_found");
  }

  const linkedUsername = user.piuLink?.piuUsername?.trim();
  if (!linkedUsername) {
    throw new MobilePerformanceImportError("piu_account_not_linked");
  }
  if (normalizePiuUsername(linkedUsername) !== normalizePiuUsername(input.profile.username)) {
    throw new MobilePerformanceImportError("piu_username_mismatch");
  }

  const profile: PlayerData = {
    username: input.profile.username,
    titleName: input.profile.titleName,
    gameIdTag: input.profile.pumpTag ?? input.profile.displayName,
    gameId: input.profile.gameId,
    gameTag: null,
    avatarUrl: input.profile.avatarUrl,
    pp: input.profile.pp,
    pumbilityScore: input.profile.pumbilityScore,
    lastAccess: input.profile.lastAccess,
    recentArcade: input.profile.recentArcade,
    playCount: input.profile.playCount,
    rating: input.profile.rating,
    clear: {
      cleared: input.profile.clearCount,
      total: input.profile.totalCharts,
      raw: input.profile.clearCount !== null && input.profile.totalCharts !== null
        ? `${input.profile.clearCount} / ${input.profile.totalCharts}`
        : null,
    },
    progressPercent: input.profile.progressPercent,
    plateCounts: input.profile.plateCounts,
  };
  const recentPlays: RecentPlay[] = input.recentPlays.map((play) => ({
    songName: play.songName,
    songImageUrl: null,
    mode: play.mode,
    level: play.level,
    score: play.score,
    grade: play.grade,
    plate: play.plate,
    stageBreak: play.stageBreak,
    judgments: play.judgments,
    playedAt: play.playedAt,
  }));

  const generatedAt = new Date(input.generatedAt);
  const result = await storePerformanceSnapshot(userId, input.piuVersion, profile, recentPlays, {
    observedAt: generatedAt,
    displayName: input.profile.displayName,
    pumpTag: input.profile.pumpTag,
  });
  const now = new Date();
  if (result.profileUpdated) {
    await users.updateOne(
      {
        _id: userId,
        $or: [
          { "piuLink.lastMobileSnapshotGeneratedAt": { $exists: false } },
          { "piuLink.lastMobileSnapshotGeneratedAt": null },
          { "piuLink.lastMobileSnapshotGeneratedAt": { $lte: generatedAt } },
        ],
      },
      {
        $set: {
          "preferences.piuGameVersion": input.piuVersion,
          "piuLink.displayName": input.profile.displayName,
          "piuLink.avatarUrl": input.profile.avatarUrl,
          "piuLink.lastProfileFetchedAt": now,
          "piuLink.lastMobileSnapshotGeneratedAt": generatedAt,
          updatedAt: now,
        },
      },
    );
  }
  return {
    importedRecentPlays: result.importedRecentPlays,
    duplicateRecentPlays: result.duplicateRecentPlays,
  };
}

/**
 * Fetches PIUGAME recent plays and profile data in parallel without waiting for MongoDB writes.
 * Call `persist` after the response has been sent to finish the full sync.
 */
export async function fetchCurrentUserRecentPlays(userIdInput: string | null): Promise<FreshPerformanceRecentPlays> {
  const userId = objectIdFromString(userIdInput);
  if (!userId) {
    throw new Error("Sign in before syncing performance data.");
  }

  const { users } = await collections();
  const user = await users.findOne({ _id: userId });
  const piuVersion = normalizePiuGameVersion(user?.preferences?.piuGameVersion);
  const piuUsername = user?.piuLink?.piuUsername?.trim();
  const encryptedPassword = user?.piuLink?.encryptedPassword;
  if (!piuUsername || !encryptedPassword) {
    throw new Error("A linked PIU account with saved credentials is required.");
  }

  const client = new PiuClient({ version: piuVersion });
  await client.login(piuUsername, decryptCredential(encryptedPassword));
  const profileResultPromise = getPlayerDataWithPumbility(client, piuUsername)
    .then((profile) => ({ ok: true as const, profile }))
    .catch((error: unknown) => ({ ok: false as const, error }));
  const recentPlays = await client.getRecentPlays(piuUsername);

  return {
    recentPlays,
    async persist() {
      try {
        const profileResult = await profileResultPromise;
        if (!profileResult.ok) {
          throw profileResult.error;
        }
        const profile = profileResult.profile;
        await storePerformanceSnapshot(userId, piuVersion, profile, recentPlays);
        await queueAllPlaysBackfill(userId, piuVersion);
      } catch (error) {
        await markSyncFailed(userId, piuVersion, error);
        throw error;
      }
    },
  };
}

export async function syncCurrentUserTopPlaysIfDue(userIdInput: string | null): Promise<void> {
  const userId = objectIdFromString(userIdInput);
  if (!userId || !hasMongoConfig()) {
    return;
  }

  const { users, profiles, chartStats } = await collections();
  const piuVersion = await performanceVersionForUser(users, userId);
  await ensureUserPerformanceSchedule(userId, users, profiles, piuVersion);
  await syncTopPlaysForUserIfDue(userId, users, profiles, chartStats, piuVersion);
}

async function ensureUserPerformanceSchedule(
  userId: ObjectId,
  users: Collection<MinimalUserDocument>,
  profiles: Collection<PerformanceProfileDocument>,
  piuVersion: PiuCatalogVersion,
): Promise<void> {
  const existing = await profiles.findOne({ userId, piuVersion }, { projection: { _id: 1 } });
  if (existing) {
    return;
  }

  const user = await users.findOne({ _id: userId });
  const piuUsername = user?.piuLink?.piuUsername?.trim();
  if (!piuUsername) {
    return;
  }

  const now = new Date();
  await profiles.updateOne(
    { userId, piuVersion },
    {
      $setOnInsert: {
        userId,
        piuVersion,
        piuUsername,
        displayName: user?.piuLink?.displayName?.trim() || piuUsername,
        titleName: null,
        gameId: null,
        pumpTag: null,
        avatarUrl: null,
        pumbilityScore: null,
        pp: null,
        rating: null,
        playCount: null,
        clearCount: null,
        totalCharts: null,
        progressPercent: null,
        plateCounts: {},
        recentArcade: null,
        lastAccess: null,
        syncStatus: "queued",
        syncError: null,
        lastSyncedAt: null,
        allPlaysSyncStatus: null,
        allPlaysSyncError: null,
        allPlaysSyncedAt: null,
        allPlaysLeaseUntil: null,
        topPlaysSyncedAt: null,
        nextTopPlaysRefreshAt: now,
        nextRefreshAt: now,
        syncLeaseUntil: null,
        createdAt: now,
        updatedAt: now,
      },
    },
    { upsert: true },
  );
}

async function syncSingleUserPerformance(userId: ObjectId, user: WithId<MinimalUserDocument> | null, piuVersion: PiuCatalogVersion): Promise<void> {
  const piuUsername = user?.piuLink?.piuUsername?.trim();
  const encryptedPassword = user?.piuLink?.encryptedPassword;
  if (!piuUsername || !encryptedPassword) {
    throw new Error("A linked PIU account with saved credentials is required.");
  }

  const password = decryptCredential(encryptedPassword);
  const client = new PiuClient({ version: piuVersion });
  await client.login(piuUsername, password);
  const profilePromise = getPlayerDataWithPumbility(client, piuUsername);
  const recentPlaysPromise = client
    .getRecentPlays(piuUsername)
    .then((plays) => ({ ok: true as const, plays }))
    .catch((error: unknown) => ({ ok: false as const, error }));
  const profile = await profilePromise;
  const recentPlaysResult = await recentPlaysPromise;
  if (!recentPlaysResult.ok) {
    if (!shouldTreatRecentPlaysAsEmpty({ profilePlayCount: profile.playCount, error: recentPlaysResult.error })) {
      throw recentPlaysResult.error;
    }
  }
  const recentPlays = recentPlaysResult.ok ? recentPlaysResult.plays : [];
  await storePerformanceSnapshot(userId, piuVersion, profile, recentPlays);
  await queueAllPlaysBackfill(userId, piuVersion);
}

async function getPlayerDataWithPumbility(client: PiuClient, username: string): Promise<PlayerData> {
  const profile = await client.getPlayerData(username);
  if (profile.pumbilityScore !== null) {
    return profile;
  }

  const pumbilityScore = await fetchPumbilityScore(client, username);
  return pumbilityScore === null ? profile : { ...profile, pumbilityScore };
}

async function storePerformanceSnapshot(
  userId: ObjectId,
  piuVersion: PiuCatalogVersion,
  profile: PlayerData,
  recentPlays: RecentPlay[],
  options: {
    observedAt?: Date;
    displayName?: string;
    pumpTag?: string | null;
  } = {},
): Promise<MobilePerformanceImportResult & { profileUpdated: boolean }> {
  const { profiles, plays, chartStats, metricSnapshots } = await collections();
  const now = new Date();
  const observedAt = options.observedAt ?? now;
  const piuUsername = profile.username.trim();
  const nextRefreshAt = new Date(now.getTime() + Math.max(5, PERFORMANCE_REFRESH_MINUTES) * 60 * 1000);
  const profileFields = {
    piuUsername,
    displayName: options.displayName?.trim() || profile.gameIdTag?.trim() || profile.gameId?.trim() || piuUsername,
    titleName: profile.titleName,
    gameId: profile.gameId,
    pumpTag: options.pumpTag === undefined ? profile.gameIdTag : options.pumpTag,
    avatarUrl: profile.avatarUrl,
    pumbilityScore: profile.pumbilityScore,
    pp: profile.pp,
    rating: profile.rating,
    playCount: profile.playCount,
    clearCount: profile.clear.cleared,
    totalCharts: profile.clear.total,
    progressPercent: profile.progressPercent,
    plateCounts: profile.plateCounts,
    recentArcade: profile.recentArcade,
    lastAccess: profile.lastAccess,
    syncStatus: "synced" as const,
    syncError: null,
    lastSyncedAt: now,
    lastSnapshotGeneratedAt: observedAt,
    nextRefreshAt,
    syncLeaseUntil: null,
    updatedAt: now,
  };

  const insertedProfile = await profiles.updateOne(
    { userId, piuVersion },
    {
      $setOnInsert: {
        userId,
        piuVersion,
        ...profileFields,
        createdAt: now,
      },
    },
    { upsert: true },
  );
  let profileUpdated = insertedProfile.upsertedCount > 0;
  if (!profileUpdated) {
    const updatedProfile = await profiles.updateOne(
      {
        userId,
        piuVersion,
        $or: [
          { lastSnapshotGeneratedAt: { $exists: false } },
          { lastSnapshotGeneratedAt: null },
          { lastSnapshotGeneratedAt: { $lte: observedAt } },
        ],
      },
      { $set: profileFields },
    );
    profileUpdated = updatedProfile.matchedCount > 0;
  }

  let importedRecentPlays = 0;
  let duplicateRecentPlays = 0;
  for (const play of recentPlays) {
    const playDoc = playEventDocument(userId, piuVersion, piuUsername, play, now);
    const { inserted, removedDuplicates } = await upsertRecentPlayEvent(plays, playDoc);

    if (inserted) {
      importedRecentPlays += 1;
      await updateChartStat(chartStats, playDoc, now);
    } else {
      duplicateRecentPlays += 1;
      if (removedDuplicates > 0) {
        await repairChartPlayCounts(chartStats, plays, playDoc, now);
      }
    }
  }

  if (profileUpdated) {
    const averageScores = await chartStats
      .aggregate<{ averageBestScore: number }>([
        { $match: { userId, piuVersion, bestScore: { $type: "number" } } },
        { $group: { _id: null, averageBestScore: { $avg: "$bestScore" } } },
      ])
      .toArray();
    await metricSnapshots.insertOne({
      userId,
      piuVersion,
      capturedAt: observedAt,
      pumbilityScore: profile.pumbilityScore,
      averageBestScore: roundedAverageBestScore(averageScores[0]?.averageBestScore),
    });
  }
  return { importedRecentPlays, duplicateRecentPlays, profileUpdated };
}

async function queueAllPlaysBackfill(userId: ObjectId, piuVersion: PiuCatalogVersion): Promise<void> {
  const { profiles } = await collections();
  const now = new Date();
  await profiles.updateOne(
    {
      userId,
      piuVersion,
      allPlaysSyncedAt: null,
      $or: [
        { allPlaysSyncStatus: null },
        { allPlaysSyncStatus: { $exists: false } },
        { allPlaysSyncStatus: "failed" },
      ],
    },
    {
      $set: {
        allPlaysSyncStatus: "queued",
        allPlaysSyncError: null,
        allPlaysLeaseUntil: null,
        updatedAt: now,
      },
    },
  );
}

async function backfillAllPlaysForUser(
  userId: ObjectId,
  user: WithId<MinimalUserDocument> | null,
  chartStats: Collection<PerformanceChartStatDocument>,
  piuVersion: PiuCatalogVersion,
): Promise<void> {
  const piuUsername = user?.piuLink?.piuUsername?.trim();
  const encryptedPassword = user?.piuLink?.encryptedPassword;
  if (!piuUsername || !encryptedPassword) {
    throw new Error("A linked PIU account with saved credentials is required.");
  }

  const password = decryptCredential(encryptedPassword);
  const client = new PiuClient({ version: piuVersion });
  await client.login(piuUsername, password);
  const result = await client.fetchAllPlays(piuUsername);
  const now = new Date();

  for (const play of result.plays) {
    await upsertHistoricalBestPlay(chartStats, userId, piuVersion, piuUsername, play, now);
  }

  const { profiles } = await collections();
  await profiles.updateOne(
    { userId, piuVersion },
    {
      $set: {
        allPlaysSyncStatus: "synced",
        allPlaysSyncError: null,
        allPlaysSyncedAt: now,
        allPlaysLeaseUntil: null,
        updatedAt: now,
      },
    },
  );
}

async function syncTopPlaysForUserIfDue(
  userId: ObjectId,
  users: Collection<MinimalUserDocument>,
  profiles: Collection<PerformanceProfileDocument>,
  chartStats: Collection<PerformanceChartStatDocument>,
  piuVersion: PiuCatalogVersion,
): Promise<void> {
  const now = new Date();
  const profile = await findDueTopPlaysProfile(userId, piuVersion, profiles, now);
  if (!profile) {
    return;
  }

  const user = await users.findOne({ _id: userId });
  const piuUsername = user?.piuLink?.piuUsername?.trim();
  const encryptedPassword = user?.piuLink?.encryptedPassword;
  if (!piuUsername || !encryptedPassword) {
    return;
  }

  const password = decryptCredential(encryptedPassword);
  const client = new PiuClient({ version: piuVersion });
  await client.login(piuUsername, password);
  const topPlays = await client.getTopPlays(piuUsername);
  await storeTopPlays(chartStats, userId, piuVersion, piuUsername, topPlays, now);
  await profiles.updateOne(
    { userId, piuVersion },
    {
      $set: {
        syncError: null,
        topPlaysSyncedAt: now,
        nextTopPlaysRefreshAt: nextTopPlaysRefreshDate(now),
        updatedAt: now,
      },
    },
  );
}

async function findDueTopPlaysProfile(
  userId: ObjectId,
  piuVersion: PiuCatalogVersion,
  profiles: Collection<PerformanceProfileDocument>,
  now: Date,
): Promise<WithId<PerformanceProfileDocument> | null> {
  return profiles.findOne({
    userId,
    piuVersion,
    $or: [
      { nextTopPlaysRefreshAt: null },
      { nextTopPlaysRefreshAt: { $exists: false } },
      { nextTopPlaysRefreshAt: { $lte: now } },
      { topPlaysSyncedAt: null },
      { topPlaysSyncedAt: { $exists: false } },
    ],
  });
}

function nextTopPlaysRefreshDate(now: Date): Date {
  return new Date(now.getTime() + Math.max(1, PERFORMANCE_TOP_PLAYS_REFRESH_HOURS) * 60 * 60 * 1000);
}

async function storeTopPlays(
  chartStats: Collection<PerformanceChartStatDocument>,
  userId: ObjectId,
  piuVersion: PiuCatalogVersion,
  piuUsername: string,
  topPlays: TopPlay[],
  now: Date,
): Promise<void> {
  await chartStats.updateMany(
    { userId, piuVersion, topPlayRank: { $ne: null } },
    { $set: { topPlayRank: null }, $inc: { revision: 1 } },
  );

  for (const play of topPlays) {
    const chartToken = chartTokenFromPlay(play);
    const playedAt = parsePlayDate(play.playedAt);
    await mutateChartStat(
      chartStats,
      { userId, piuVersion, chartToken },
      { userId, piuVersion, chartToken, piuUsername },
      (existing) => applyTopPlaySummary(existing, play, playedAt, now),
    );
  }
}

async function upsertHistoricalBestPlay(
  chartStats: Collection<PerformanceChartStatDocument>,
  userId: ObjectId,
  piuVersion: PiuCatalogVersion,
  piuUsername: string,
  play: BestPlay,
  now: Date,
): Promise<void> {
  const chartTokenCandidates = performanceChartTokenCandidatesFromPlay(play);
  const chartToken = chartTokenCandidates[0];
  await mutateChartStat(
    chartStats,
    { userId, piuVersion, chartToken: { $in: chartTokenCandidates } },
    { userId, piuVersion, chartToken, piuUsername },
    (existing) => applyBucketBestSummary(existing, play, now),
  );
}

async function updateChartStat(
  chartStats: Collection<PerformanceChartStatDocument>,
  play: PerformancePlayEventDocument,
  now: Date,
): Promise<void> {
  await mutateChartStat(
    chartStats,
    { userId: play.userId, piuVersion: play.piuVersion, chartToken: play.chartToken },
    {
      userId: play.userId,
      piuVersion: play.piuVersion,
      chartToken: play.chartToken,
      piuUsername: play.piuUsername,
    },
    (existing) => applyRecentPlaySummary(existing, play, play.playedAt, now),
  );
}

async function mutateChartStat(
  chartStats: Collection<PerformanceChartStatDocument>,
  lookup: Filter<PerformanceChartStatDocument>,
  identity: Pick<PerformanceChartStatDocument, "userId" | "piuVersion" | "chartToken" | "piuUsername">,
  summaryFor: (existing: PerformanceChartStatSummary | null) => PerformanceChartStatSummary,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const existing = await chartStats.findOne(lookup);
    const summary = summaryFor(existing ? withoutChartStatIdentity(existing) : null);

    if (!existing) {
      try {
        await chartStats.insertOne({
          ...identity,
          revision: 1,
          ...summary,
        });
        return;
      } catch (error) {
        if (error instanceof MongoServerError && error.code === 11000) {
          continue;
        }
        throw error;
      }
    }

    const revisionFilter = existing.revision === undefined
      ? { revision: { $exists: false as const } }
      : { revision: existing.revision };
    const updated = await chartStats.updateOne(
      { _id: existing._id, ...revisionFilter },
      {
        $set: {
          piuUsername: identity.piuUsername,
          ...summary,
        },
        $inc: { revision: 1 },
      },
    );
    if (updated.modifiedCount === 1) {
      return;
    }
  }

  throw new Error(`Could not update chart summary after concurrent writes: ${identity.chartToken}`);
}

function withoutChartStatIdentity(
  chart: WithId<PerformanceChartStatDocument>,
): PerformanceChartStatSummary {
  const summary = { ...chart };
  Reflect.deleteProperty(summary, "_id");
  Reflect.deleteProperty(summary, "userId");
  Reflect.deleteProperty(summary, "piuVersion");
  Reflect.deleteProperty(summary, "chartToken");
  Reflect.deleteProperty(summary, "piuUsername");
  Reflect.deleteProperty(summary, "revision");
  return summary;
}

async function markSyncFailed(userId: ObjectId, piuVersion: PiuCatalogVersion, error: unknown): Promise<void> {
  const { profiles } = await collections();
  const now = new Date();
  await profiles.updateOne(
    { userId, piuVersion },
    {
      $set: {
        syncStatus: "failed",
        syncError: error instanceof Error ? error.message : "Performance sync failed.",
        nextRefreshAt: new Date(now.getTime() + Math.max(5, PERFORMANCE_REFRESH_MINUTES) * 60 * 1000),
        syncLeaseUntil: null,
        updatedAt: now,
      },
    },
  );
}

async function markAllPlaysBackfillFailed(userId: ObjectId, piuVersion: PiuCatalogVersion, error: unknown): Promise<void> {
  const { profiles } = await collections();
  await profiles.updateOne(
    { userId, piuVersion },
    {
      $set: {
        allPlaysSyncStatus: "failed",
        allPlaysSyncError: error instanceof Error ? error.message : "Full play-history backfill failed.",
        allPlaysLeaseUntil: null,
        updatedAt: new Date(),
      },
    },
  );
}

function playEventDocument(userId: ObjectId, piuVersion: PiuCatalogVersion, piuUsername: string, play: RecentPlay, now: Date): PerformancePlayEventDocument {
  const chartToken = chartTokenFromPlay(play);
  const playedAt = parsePlayDate(play.playedAt);
  const playKey = performancePlayKey({ playedAt, playedAtRaw: play.playedAt });
  const playHash = createHash("sha256")
    .update([userId.toHexString(), piuVersion, playKey].join("|"))
    .digest("hex");

  return {
    userId,
    piuVersion,
    playHash,
    playKey,
    piuUsername,
    songName: play.songName,
    chartToken,
    mode: play.mode,
    level: play.level,
    score: play.score,
    grade: play.grade,
    plate: play.plate,
    stageBreak: play.stageBreak,
    judgments: play.judgments,
    playedAt,
    playedAtRaw: play.playedAt,
    source: "recent",
    ingestedAt: now,
  };
}

async function upsertRecentPlayEvent(
  plays: Collection<PerformancePlayEventDocument>,
  play: PerformancePlayEventDocument,
): Promise<{ inserted: boolean; removedDuplicates: number }> {
  const candidatePlays = await plays
    .find({
      userId: play.userId,
      piuVersion: play.piuVersion,
      $or: [
        { playKey: play.playKey },
        { playedAt: play.playedAt },
      ],
    })
    .sort({ ingestedAt: 1, _id: 1 })
    .toArray();
  const matchingPlays = candidatePlays.filter(
    (candidate) =>
      candidate.playKey === play.playKey ||
      performancePlayKey({ playedAt: candidate.playedAt, playedAtRaw: candidate.playedAtRaw }) === play.playKey,
  );
  const canonicalPlay = matchingPlays.find((candidate) => candidate.playKey === play.playKey) ?? matchingPlays[0];

  if (!canonicalPlay) {
    const result = await plays.updateOne({ userId: play.userId, piuVersion: play.piuVersion, playKey: play.playKey }, { $setOnInsert: play }, { upsert: true });
    return { inserted: result.upsertedCount > 0, removedDuplicates: 0 };
  }

  await plays.updateOne({ _id: canonicalPlay._id }, { $set: { playKey: play.playKey } });
  const duplicateIds = matchingPlays.slice(1).map((duplicate) => duplicate._id);
  if (duplicateIds.length > 0) {
    await plays.deleteMany({ _id: { $in: duplicateIds } });
  }
  return { inserted: false, removedDuplicates: duplicateIds.length };
}

async function repairChartPlayCounts(
  chartStats: Collection<PerformanceChartStatDocument>,
  plays: Collection<PerformancePlayEventDocument>,
  play: PerformancePlayEventDocument,
  now: Date,
): Promise<void> {
  const [recentPlayCount, stageBreakCount] = await Promise.all([
    plays.countDocuments({ userId: play.userId, piuVersion: play.piuVersion, chartToken: play.chartToken }),
    plays.countDocuments({ userId: play.userId, piuVersion: play.piuVersion, chartToken: play.chartToken, stageBreak: true }),
  ]);
  await chartStats.updateOne(
    { userId: play.userId, piuVersion: play.piuVersion, chartToken: play.chartToken },
    { $set: { recentPlayCount, stageBreakCount, updatedAt: now }, $inc: { revision: 1 } },
  );
}

function chartTokenFromPlay(play: Pick<RecentPlay, "songName" | "mode" | "level">): string {
  return performanceChartTokenKey(play.songName, play.mode, play.level);
}

function parsePlayDate(value: string | null): Date | null {
  return piuTimestampToDate(value);
}

function songLookupKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizePiuUsername(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function firstByCandidateOrder<T extends { chartToken: string }>(documents: T[], chartTokens: string[]): T | null {
  const byToken = new Map(documents.map((document) => [document.chartToken, document]));
  for (const chartToken of chartTokens) {
    const document = byToken.get(chartToken);
    if (document) {
      return document;
    }
  }
  return documents[0] ?? null;
}

function publicProfile(profile: WithId<PerformanceProfileDocument>): NonNullable<PerformanceDashboard["profile"]> {
  return {
    displayName: profile.displayName,
    piuUsername: profile.piuUsername,
    titleName: profile.titleName,
    gameId: profile.gameId,
    pumpTag: profile.pumpTag,
    avatarUrl: profile.avatarUrl,
    pumbilityScore: profile.pumbilityScore,
    pp: profile.pp,
    rating: profile.rating,
    playCount: profile.playCount,
    clearCount: profile.clearCount,
    totalCharts: profile.totalCharts,
    progressPercent: profile.progressPercent,
    recentArcade: profile.recentArcade,
    lastAccess: profile.lastAccess,
    syncStatus: profile.syncStatus,
    syncError: profile.syncError,
    lastSyncedAt: profile.lastSyncedAt?.toISOString() ?? null,
    allPlaysSyncStatus: profile.allPlaysSyncStatus ?? null,
    allPlaysSyncError: profile.allPlaysSyncError ?? null,
    allPlaysSyncedAt: profile.allPlaysSyncedAt?.toISOString() ?? null,
    topPlaysSyncedAt: profile.topPlaysSyncedAt?.toISOString() ?? null,
    nextTopPlaysRefreshAt: profile.nextTopPlaysRefreshAt?.toISOString() ?? null,
    nextRefreshAt: profile.nextRefreshAt?.toISOString() ?? null,
  };
}

function publicRecentPlay(play: WithId<PerformancePlayEventDocument>): PerformanceDashboard["recentPlays"][number] {
  const playedAtFromRaw = parsePlayDate(play.playedAtRaw);
  return {
    songName: play.songName,
    chartToken: play.chartToken,
    score: play.score,
    grade: play.grade,
    plate: play.plate,
    mode: play.mode,
    level: play.level,
    playedAt: playedAtFromRaw?.toISOString() ?? play.playedAt?.toISOString() ?? play.playedAtRaw,
    stageBreak: play.stageBreak,
  };
}

function publicSongChartPlay(play: WithId<PerformancePlayEventDocument>): NonNullable<SongChartPerformance["latestPlay"]> {
  const playedAtFromRaw = parsePlayDate(play.playedAtRaw);
  return {
    id: play._id.toHexString(),
    score: play.score,
    grade: play.grade,
    plate: play.plate,
    playedAt: playedAtFromRaw?.toISOString() ?? play.playedAt?.toISOString() ?? play.playedAtRaw,
    stageBreak: play.stageBreak,
    judgments: play.judgments,
  };
}

function publicTopChart(chart: WithId<PerformanceChartStatDocument>): PerformanceDashboard["topCharts"][number] {
  return {
    songName: chart.songName,
    chartToken: chart.chartToken,
    bestScore: chart.bestScore,
    previousBestScore: chart.previousBestScore,
    delta: chart.bestScore !== null && chart.previousBestScore !== null ? chart.bestScore - chart.previousBestScore : null,
    bestGrade: chart.bestGrade,
    bestPlate: chart.bestPlate,
    mode: chart.mode,
    level: chart.level,
    bestBucketPage: chart.bestBucketPage,
    bestSyncedAt: chart.bestSyncedAt?.toISOString() ?? null,
    topPlayRank: chart.topPlayRank ?? null,
    topPumbilityScore: chart.topPumbilityScore,
    topPlayedAt: chart.topPlayedAt?.toISOString() ?? null,
    topPlaysSyncedAt: chart.topPlaysSyncedAt?.toISOString() ?? null,
  };
}

function emptyDashboard(mongoReady: boolean): PerformanceDashboard {
  return {
    profile: null,
    totals: {
      trackedPlays: 0,
      trackedCharts: 0,
      trackedPumbilityCharts: 0,
      upscores: 0,
      upscoresThisWeek: 0,
      upscoresThisMonth: 0,
      upscoresToday: 0,
      recentNewScores: 0,
      averageBestScore: null,
      pumbilityChange24Hours: null,
      averageBestScoreChange24Hours: null,
      recentlyPlayed: 0,
    },
    recentPlays: [],
    topCharts: [],
    canSync: false,
    mongoReady,
  };
}

function normalizeTopChartsSort(value: PerformanceTopChartsSort | null | undefined): PerformanceTopChartsSort {
  return value === "score" ? "score" : "pumbility";
}

function topChartsFilter(userId: ObjectId, piuVersion: PiuCatalogVersion, sort: PerformanceTopChartsSort): Filter<PerformanceChartStatDocument> {
  if (sort === "pumbility") {
    return { userId, piuVersion, topPlayRank: { $exists: true, $ne: null } };
  }

  return { userId, piuVersion, bestScore: { $exists: true, $ne: null } };
}

async function performanceVersionForUser(users: Collection<MinimalUserDocument>, userId: ObjectId): Promise<PiuCatalogVersion> {
  const user = await users.findOne({ _id: userId }, { projection: { "preferences.piuGameVersion": 1 } });
  return normalizePiuGameVersion(user?.preferences?.piuGameVersion);
}

function objectIdFromString(value: string | null | undefined): ObjectId | null {
  if (!value || !ObjectId.isValid(value)) {
    return null;
  }

  return new ObjectId(value);
}
