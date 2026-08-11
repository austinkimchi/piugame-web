import "server-only";

import { createHash } from "node:crypto";
import { ObjectId, type Collection, type Filter, type Sort, type WithId } from "mongodb";
import { PiuClient, type BestPlay, type PlayerData, type RecentPlay, type TopPlay } from "@austinkimchi/piugame-sdk";

import type { CryptoPayloadV1 } from "@/lib/credential-crypto";
import { decryptCredential } from "@/lib/credential-crypto";
import { getMongoClient, hasMongoConfig } from "@/lib/mongodb";
import { performanceChartTokenCandidates, performanceChartTokenCandidatesFromPlay, performanceChartTokenKey } from "@/lib/performance-chart-key";
import { piuTimestampToDate } from "@/lib/performance-format";
import { applyBucketBestSummary, applyRecentPlaySummary, applyTopPlaySummary, type PerformanceChartStatSummary } from "@/lib/performance-stat-summary";
import { shouldTreatRecentPlaysAsEmpty } from "@/lib/performance-sync-errors";
import { normalizePiuGameVersion } from "@/lib/piu-version";
import type { PiuCatalogVersion } from "@/lib/types";

const COMMUNITY_DB_NAME = process.env.COMMUNITY_DB_NAME ?? "piugame_web";
const USERS_COLLECTION = process.env.COMMUNITY_USERS_COLLECTION ?? "users";
const PERFORMANCE_PROFILES_COLLECTION = process.env.PERFORMANCE_PROFILES_COLLECTION ?? "performance_profiles";
const PERFORMANCE_PLAYS_COLLECTION = process.env.PERFORMANCE_PLAYS_COLLECTION ?? "performance_play_events";
const PERFORMANCE_CHART_STATS_COLLECTION = process.env.PERFORMANCE_CHART_STATS_COLLECTION ?? "performance_chart_stats";
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
  preferences?: {
    performanceAutoRefresh?: boolean;
    piuGameVersion?: PiuCatalogVersion;
  };
  piuLink?: {
    piuUsername?: string;
    displayName?: string;
    encryptedPassword?: CryptoPayloadV1;
  };
}

interface PerformanceProfileDocument {
  userId: ObjectId;
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
  playHash: string;
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
  chartToken: string;
  piuUsername: string;
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
    averageBestScore: number | null;
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

export type PerformanceTopChartsSort = "pumbility" | "score";

export interface PerformanceTopChartsPage {
  topCharts: PerformanceDashboard["topCharts"];
  nextOffset: number | null;
  total: number;
  sort: PerformanceTopChartsSort;
}

export interface SongChartPerformance {
  latestPlay: {
    score: number | null;
    grade: string | null;
    plate: string | null;
    playedAt: string | null;
    stageBreak: boolean;
    judgments: RecentPlay["judgments"];
  } | null;
  history: Array<{
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
    recentPlayCount: number;
    stageBreakCount: number;
    bestGrade: string | null;
    bestPlate: string | null;
    bestBucketPage: number | null;
    bestSyncedAt: string | null;
  } | null;
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
}): Promise<void> {
  await Promise.all([
    args.profiles.createIndex({ userId: 1 }, { unique: true }),
    args.profiles.createIndex({ nextRefreshAt: 1, syncStatus: 1, syncLeaseUntil: 1 }),
    args.profiles.createIndex({ allPlaysSyncStatus: 1, allPlaysLeaseUntil: 1, updatedAt: 1 }),
    args.plays.createIndex({ userId: 1, playHash: 1 }, { unique: true }),
    args.plays.createIndex({ userId: 1, playedAt: -1, ingestedAt: -1 }),
    args.plays.createIndex({ userId: 1, chartToken: 1, playedAt: -1 }),
    args.chartStats.createIndex({ userId: 1, chartToken: 1 }, { unique: true }),
    args.chartStats.createIndex({ userId: 1, bestScore: -1 }),
    args.chartStats.createIndex({ userId: 1, topPlayRank: 1, bestScore: -1 }),
    args.chartStats.createIndex({ userId: 1, updatedAt: -1 }),
  ]);
}

function recentPlaySort() {
  return { playedAt: -1, ingestedAt: -1, _id: -1 } as const;
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

  const { users, profiles, plays, chartStats } = await collections();
  await ensureUserPerformanceSchedule(userId, users, profiles);

  const [profile, recentPlays, topCharts, trackedPlays, trackedCharts, trackedPumbilityCharts, upscoreCharts, averageScores] = await Promise.all([
    profiles.findOne({ userId }),
    plays.find({ userId }).sort(recentPlaySort()).limit(PERFORMANCE_RECENT_PLAYS_PAGE_SIZE).toArray(),
    chartStats.find(topChartsFilter(userId, "pumbility")).sort(topChartsSort("pumbility")).limit(PERFORMANCE_TOP_CHARTS_PAGE_SIZE).toArray(),
    plays.countDocuments({ userId }),
    chartStats.countDocuments({ userId }),
    chartStats.countDocuments(topChartsFilter(userId, "pumbility")),
    chartStats.countDocuments({ userId, previousBestScore: { $ne: null } }),
    chartStats
      .aggregate<{ averageBestScore: number }>([
        { $match: { userId, bestScore: { $type: "number" } } },
        { $group: { _id: null, averageBestScore: { $avg: "$bestScore" } } },
      ])
      .toArray(),
  ]);

  return {
    profile: profile ? publicProfile(profile) : null,
    totals: {
      trackedPlays,
      trackedCharts,
      trackedPumbilityCharts,
      upscores: upscoreCharts,
      averageBestScore: averageScores[0]?.averageBestScore ? Math.round(averageScores[0].averageBestScore) : null,
    },
    recentPlays: recentPlays.map(publicRecentPlay),
    topCharts: topCharts.map(publicTopChart),
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
  const { chartStats } = await collections();
  const filter = topChartsFilter(userId, sort);
  const [topCharts, total] = await Promise.all([
    chartStats.find(filter).sort(topChartsSort(sort)).skip(offset).limit(limit).toArray(),
    chartStats.countDocuments(filter),
  ]);

  return {
    topCharts: topCharts.map(publicTopChart),
    nextOffset: offset + topCharts.length < total ? offset + topCharts.length : null,
    total,
    sort,
  };
}

export async function getPerformanceRecentPlays(
  userIdInput: string | null,
  args: { offset?: number; limit?: number } = {},
): Promise<PerformanceRecentPlaysPage> {
  const userId = objectIdFromString(userIdInput);
  if (!userId || !hasMongoConfig()) {
    return { recentPlays: [], nextOffset: null, total: 0 };
  }

  const offset = Math.max(0, Math.trunc(args.offset ?? 0));
  const limit = Math.min(Math.max(1, Math.trunc(args.limit ?? PERFORMANCE_RECENT_PLAYS_PAGE_SIZE)), PERFORMANCE_RECENT_PLAYS_PAGE_SIZE);
  const { plays } = await collections();
  const [recentPlays, total] = await Promise.all([
    plays.find({ userId }).sort(recentPlaySort()).skip(offset).limit(limit).toArray(),
    plays.countDocuments({ userId }),
  ]);

  return {
    recentPlays: recentPlays.map(publicRecentPlay),
    nextOffset: offset + recentPlays.length < total ? offset + recentPlays.length : null,
    total,
  };
}

export async function getSongChartPerformance(
  userIdInput: string | null,
  args: { songName: string; chartToken: string | null | undefined; limit?: number },
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
    plays.find({ userId, chartToken: { $in: chartTokens } }).sort(recentPlaySort()).limit(limit).toArray(),
    chartStats.find({ userId, chartToken: { $in: chartTokens } }).toArray(),
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

    await ensureUserPerformanceSchedule(user._id, users, profiles);
    const profile = await profiles.findOne({
      userId: user._id,
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
      await syncSingleUserPerformance(profile.userId, user);
      result.synced += 1;
    } catch (error) {
      await markSyncFailed(profile.userId, error);
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
    await backfillAllPlaysForUser(userId, user, chartStats);
    return true;
  } catch (error) {
    await markAllPlaysBackfillFailed(userId, error);
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
      await backfillAllPlaysForUser(profile.userId, user, chartStats);
      result.backfilled += 1;
    } catch (error) {
      await markAllPlaysBackfillFailed(profile.userId, error);
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
    await syncSingleUserPerformance(userId, user);
  } catch (error) {
    await markSyncFailed(userId, error);
    throw error;
  }
}

export async function syncCurrentUserTopPlaysIfDue(userIdInput: string | null): Promise<void> {
  const userId = objectIdFromString(userIdInput);
  if (!userId || !hasMongoConfig()) {
    return;
  }

  const { users, profiles, chartStats } = await collections();
  await ensureUserPerformanceSchedule(userId, users, profiles);
  await syncTopPlaysForUserIfDue(userId, users, profiles, chartStats);
}

async function ensureUserPerformanceSchedule(
  userId: ObjectId,
  users: Collection<MinimalUserDocument>,
  profiles: Collection<PerformanceProfileDocument>,
): Promise<void> {
  const existing = await profiles.findOne({ userId }, { projection: { _id: 1 } });
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
    { userId },
    {
      $setOnInsert: {
        userId,
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

async function syncSingleUserPerformance(userId: ObjectId, user: WithId<MinimalUserDocument> | null): Promise<void> {
  const piuUsername = user?.piuLink?.piuUsername?.trim();
  const encryptedPassword = user?.piuLink?.encryptedPassword;
  if (!piuUsername || !encryptedPassword) {
    throw new Error("A linked PIU account with saved credentials is required.");
  }

  const password = decryptCredential(encryptedPassword);
  const client = new PiuClient({ version: normalizePiuGameVersion(user?.preferences?.piuGameVersion) });
  await client.login(piuUsername, password);
  const profilePromise = client.getPlayerData(piuUsername);
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
  await storePerformanceSnapshot(userId, profile, recentPlays);
  await queueAllPlaysBackfill(userId);
}

async function storePerformanceSnapshot(
  userId: ObjectId,
  profile: PlayerData,
  recentPlays: RecentPlay[],
): Promise<void> {
  const { profiles, plays, chartStats } = await collections();
  const now = new Date();
  const piuUsername = profile.username.trim();
  const nextRefreshAt = new Date(now.getTime() + Math.max(5, PERFORMANCE_REFRESH_MINUTES) * 60 * 1000);

  await profiles.updateOne(
    { userId },
    {
      $set: {
        piuUsername,
        displayName: profile.gameIdTag?.trim() || profile.gameId?.trim() || piuUsername,
        titleName: profile.titleName,
        gameId: profile.gameId,
        pumpTag: profile.gameIdTag,
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
        syncStatus: "synced",
        syncError: null,
        lastSyncedAt: now,
        nextRefreshAt,
        syncLeaseUntil: null,
        updatedAt: now,
      },
      $setOnInsert: {
        userId,
        createdAt: now,
      },
    },
    { upsert: true },
  );

  for (const play of recentPlays) {
    const playDoc = playEventDocument(userId, piuUsername, play, now);
    const inserted = await plays.updateOne(
      { userId, playHash: playDoc.playHash },
      { $setOnInsert: playDoc },
      { upsert: true },
    );

    if (inserted.upsertedCount > 0) {
      await updateChartStat(chartStats, playDoc, now);
    }
  }
}

async function queueAllPlaysBackfill(userId: ObjectId): Promise<void> {
  const { profiles } = await collections();
  const now = new Date();
  await profiles.updateOne(
    {
      userId,
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
): Promise<void> {
  const piuUsername = user?.piuLink?.piuUsername?.trim();
  const encryptedPassword = user?.piuLink?.encryptedPassword;
  if (!piuUsername || !encryptedPassword) {
    throw new Error("A linked PIU account with saved credentials is required.");
  }

  const password = decryptCredential(encryptedPassword);
  const client = new PiuClient({ version: normalizePiuGameVersion(user?.preferences?.piuGameVersion) });
  await client.login(piuUsername, password);
  const result = await client.fetchAllPlays(piuUsername);
  const now = new Date();

  for (const play of result.plays) {
    await upsertHistoricalBestPlay(chartStats, userId, piuUsername, play, now);
  }

  const { profiles } = await collections();
  await profiles.updateOne(
    { userId },
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
): Promise<void> {
  const now = new Date();
  const profile = await findDueTopPlaysProfile(userId, profiles, now);
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
  const client = new PiuClient({ version: normalizePiuGameVersion(user?.preferences?.piuGameVersion) });
  await client.login(piuUsername, password);
  const topPlays = await client.getTopPlays(piuUsername);
  await storeTopPlays(chartStats, userId, piuUsername, topPlays, now);
  await profiles.updateOne(
    { userId },
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
  profiles: Collection<PerformanceProfileDocument>,
  now: Date,
): Promise<WithId<PerformanceProfileDocument> | null> {
  return profiles.findOne({
    userId,
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
  piuUsername: string,
  topPlays: TopPlay[],
  now: Date,
): Promise<void> {
  await chartStats.updateMany({ userId, topPlayRank: { $ne: null } }, { $set: { topPlayRank: null } });

  for (const play of topPlays) {
    const chartToken = chartTokenFromPlay(play);
    const playedAt = parsePlayDate(play.playedAt);
    const existing = await chartStats.findOne({ userId, chartToken });
    const summary = applyTopPlaySummary(existing, play, playedAt, now);
    await chartStats.updateOne(
      { userId, chartToken },
      {
        $set: {
          userId,
          chartToken,
          piuUsername,
          ...summary,
        },
      },
      { upsert: true },
    );
  }
}

async function upsertHistoricalBestPlay(
  chartStats: Collection<PerformanceChartStatDocument>,
  userId: ObjectId,
  piuUsername: string,
  play: BestPlay,
  now: Date,
): Promise<void> {
  const chartTokenCandidates = performanceChartTokenCandidatesFromPlay(play);
  const chartToken = chartTokenCandidates[0];
  const existing = await chartStats.findOne({ userId, chartToken: { $in: chartTokenCandidates } });
  const targetChartToken = existing?.chartToken ?? chartToken;
  const summary = applyBucketBestSummary(existing, play, now);

  if (!existing) {
    await chartStats.insertOne({
      userId,
      chartToken,
      piuUsername,
      ...summary,
    });
    return;
  }

  await chartStats.updateOne(
    { userId, chartToken: targetChartToken },
    {
      $set: {
        piuUsername,
        ...summary,
      },
    },
  );
}

async function updateChartStat(
  chartStats: Collection<PerformanceChartStatDocument>,
  play: PerformancePlayEventDocument,
  now: Date,
): Promise<void> {
  const existing = await chartStats.findOne({ userId: play.userId, chartToken: play.chartToken });
  const summary = applyRecentPlaySummary(existing, play, play.playedAt, now);

  if (!existing) {
    await chartStats.insertOne({
      userId: play.userId,
      chartToken: play.chartToken,
      piuUsername: play.piuUsername,
      ...summary,
    });
    return;
  }

  await chartStats.updateOne(
    { userId: play.userId, chartToken: play.chartToken },
    {
      $set: {
        piuUsername: play.piuUsername,
        ...summary,
      },
    },
  );
}

async function markSyncFailed(userId: ObjectId, error: unknown): Promise<void> {
  const { profiles } = await collections();
  const now = new Date();
  await profiles.updateOne(
    { userId },
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

async function markAllPlaysBackfillFailed(userId: ObjectId, error: unknown): Promise<void> {
  const { profiles } = await collections();
  await profiles.updateOne(
    { userId },
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

function playEventDocument(userId: ObjectId, piuUsername: string, play: RecentPlay, now: Date): PerformancePlayEventDocument {
  const chartToken = chartTokenFromPlay(play);
  const playedAt = parsePlayDate(play.playedAt);
  const playHash = createHash("sha256")
    .update([userId.toHexString(), chartToken, play.playedAt ?? "", play.score ?? "", play.grade ?? "", play.plate ?? ""].join("|"))
    .digest("hex");

  return {
    userId,
    playHash,
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

function chartTokenFromPlay(play: Pick<RecentPlay, "songName" | "mode" | "level">): string {
  return performanceChartTokenKey(play.songName, play.mode, play.level);
}

function parsePlayDate(value: string | null): Date | null {
  return piuTimestampToDate(value);
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
      averageBestScore: null,
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

function topChartsFilter(userId: ObjectId, sort: PerformanceTopChartsSort): Filter<PerformanceChartStatDocument> {
  if (sort === "pumbility") {
    return { userId, topPlayRank: { $exists: true, $ne: null } };
  }

  return { userId, bestScore: { $exists: true, $ne: null } };
}

function objectIdFromString(value: string | null | undefined): ObjectId | null {
  if (!value || !ObjectId.isValid(value)) {
    return null;
  }

  return new ObjectId(value);
}
