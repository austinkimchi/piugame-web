import "server-only";

import { createHash } from "node:crypto";
import { ObjectId, type Collection, type WithId } from "mongodb";
import { PiuClient, type PlayerData, type RecentPlay } from "@austinkimchi/piugame-sdk";

import type { CryptoPayloadV1 } from "@/lib/credential-crypto";
import { decryptCredential } from "@/lib/credential-crypto";
import { getMongoClient, hasMongoConfig } from "@/lib/mongodb";

const COMMUNITY_DB_NAME = process.env.COMMUNITY_DB_NAME ?? "piugame_web";
const USERS_COLLECTION = process.env.COMMUNITY_USERS_COLLECTION ?? "users";
const PERFORMANCE_PROFILES_COLLECTION = process.env.PERFORMANCE_PROFILES_COLLECTION ?? "performance_profiles";
const PERFORMANCE_PLAYS_COLLECTION = process.env.PERFORMANCE_PLAYS_COLLECTION ?? "performance_play_events";
const PERFORMANCE_CHART_STATS_COLLECTION = process.env.PERFORMANCE_CHART_STATS_COLLECTION ?? "performance_chart_stats";
const PERFORMANCE_REFRESH_MINUTES = Number(process.env.PERFORMANCE_REFRESH_MINUTES ?? "30");
const PERFORMANCE_SYNC_BATCH_SIZE = Number(process.env.PERFORMANCE_SYNC_BATCH_SIZE ?? "5");

declare global {
  var piuPerformanceIndexesPromise: Promise<void> | undefined;
}

type SyncStatus = "idle" | "queued" | "syncing" | "synced" | "failed";

interface MinimalUserDocument {
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

interface PerformanceChartStatDocument {
  userId: ObjectId;
  chartToken: string;
  piuUsername: string;
  songName: string;
  mode: string | null;
  level: string | null;
  bestScore: number | null;
  bestGrade: string | null;
  bestPlate: string | null;
  bestPlayedAt: Date | null;
  previousBestScore: number | null;
  lastScore: number | null;
  lastPlayedAt: Date | null;
  playCount: number;
  firstSeenAt: Date;
  updatedAt: Date;
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
    nextRefreshAt: string | null;
  } | null;
  totals: {
    trackedPlays: number;
    trackedCharts: number;
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
    bestPlayedAt: string | null;
  }>;
  canSync: boolean;
  mongoReady: boolean;
}

export interface PerformanceSyncResult {
  scanned: number;
  synced: number;
  failed: number;
  skipped: number;
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
    args.plays.createIndex({ userId: 1, playHash: 1 }, { unique: true }),
    args.plays.createIndex({ userId: 1, playedAt: -1, ingestedAt: -1 }),
    args.plays.createIndex({ userId: 1, chartToken: 1, playedAt: -1 }),
    args.chartStats.createIndex({ userId: 1, chartToken: 1 }, { unique: true }),
    args.chartStats.createIndex({ userId: 1, bestScore: -1 }),
    args.chartStats.createIndex({ userId: 1, updatedAt: -1 }),
  ]);
}

export async function getPerformanceDashboard(userIdInput: string | null): Promise<PerformanceDashboard> {
  const empty = emptyDashboard(hasMongoConfig());
  const userId = objectIdFromString(userIdInput);
  if (!userId || !hasMongoConfig()) {
    return empty;
  }

  const { users, profiles, plays, chartStats } = await collections();
  await ensureUserPerformanceSchedule(userId, users, profiles);

  const [profile, recentPlays, topCharts, trackedPlays, trackedCharts, upscoreCharts, averageScores] = await Promise.all([
    profiles.findOne({ userId }),
    plays.find({ userId }).sort({ playedAt: -1, ingestedAt: -1 }).limit(12).toArray(),
    chartStats.find({ userId }).sort({ bestScore: -1, updatedAt: -1 }).limit(10).toArray(),
    plays.countDocuments({ userId }),
    chartStats.countDocuments({ userId }),
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
      upscores: upscoreCharts,
      averageBestScore: averageScores[0]?.averageBestScore ? Math.round(averageScores[0].averageBestScore) : null,
    },
    recentPlays: recentPlays.map(publicRecentPlay),
    topCharts: topCharts.map(publicTopChart),
    canSync: Boolean(profile),
    mongoReady: true,
  };
}

export async function syncDuePerformanceUsers(): Promise<PerformanceSyncResult> {
  if (!hasMongoConfig()) {
    return { scanned: 0, synced: 0, failed: 0, skipped: 0 };
  }

  const { users, profiles } = await collections();
  await seedPerformanceSchedulesForLinkedUsers(users, profiles);

  const now = new Date();
  const dueProfiles = await profiles
    .find({
      nextRefreshAt: { $lte: now },
      $or: [{ syncLeaseUntil: null }, { syncLeaseUntil: { $lte: now } }],
    })
    .sort({ nextRefreshAt: 1 })
    .limit(Math.max(1, PERFORMANCE_SYNC_BATCH_SIZE))
    .toArray();

  const result: PerformanceSyncResult = { scanned: dueProfiles.length, synced: 0, failed: 0, skipped: 0 };
  for (const profile of dueProfiles) {
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
      const user = await users.findOne({ _id: profile.userId });
      await syncSingleUserPerformance(profile.userId, user);
      result.synced += 1;
    } catch (error) {
      await markSyncFailed(profile.userId, error);
      result.failed += 1;
    }
  }

  return result;
}

async function seedPerformanceSchedulesForLinkedUsers(
  users: Collection<MinimalUserDocument>,
  profiles: Collection<PerformanceProfileDocument>,
): Promise<void> {
  const linkedUsers = await users
    .find({
      "piuLink.piuUsername": { $type: "string" },
      "piuLink.encryptedPassword": { $exists: true },
    })
    .limit(Math.max(1, PERFORMANCE_SYNC_BATCH_SIZE * 2))
    .toArray();

  for (const user of linkedUsers) {
    await ensureUserPerformanceSchedule(user._id, users, profiles);
  }
}

export async function syncCurrentUserPerformance(userIdInput: string | null): Promise<void> {
  const userId = objectIdFromString(userIdInput);
  if (!userId) {
    throw new Error("Sign in before syncing performance data.");
  }

  const { users } = await collections();
  const user = await users.findOne({ _id: userId });
  await syncSingleUserPerformance(userId, user);
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
  const client = new PiuClient({ version: "phoenix2" });
  await client.login(piuUsername, password);
  const [profile, recentPlays] = await Promise.all([client.getPlayerData(piuUsername), client.getRecentPlays(piuUsername)]);
  await storePerformanceSnapshot(userId, profile, recentPlays);
}

async function storePerformanceSnapshot(userId: ObjectId, profile: PlayerData, recentPlays: RecentPlay[]): Promise<void> {
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

async function updateChartStat(
  chartStats: Collection<PerformanceChartStatDocument>,
  play: PerformancePlayEventDocument,
  now: Date,
): Promise<void> {
  const existing = await chartStats.findOne({ userId: play.userId, chartToken: play.chartToken });
  const currentScore = play.score;
  const existingBest = existing?.bestScore ?? null;
  const isNewBest = currentScore !== null && (existingBest === null || currentScore > existingBest);

  if (!existing) {
    await chartStats.insertOne({
      userId: play.userId,
      chartToken: play.chartToken,
      piuUsername: play.piuUsername,
      songName: play.songName,
      mode: play.mode,
      level: play.level,
      bestScore: currentScore,
      bestGrade: play.grade,
      bestPlate: play.plate,
      bestPlayedAt: play.playedAt,
      previousBestScore: null,
      lastScore: currentScore,
      lastPlayedAt: play.playedAt,
      playCount: 1,
      firstSeenAt: now,
      updatedAt: now,
    });
    return;
  }

  await chartStats.updateOne(
    { userId: play.userId, chartToken: play.chartToken },
    {
      $set: {
        piuUsername: play.piuUsername,
        songName: play.songName,
        mode: play.mode,
        level: play.level,
        lastScore: currentScore,
        lastPlayedAt: play.playedAt,
        updatedAt: now,
        ...(isNewBest
          ? {
              bestScore: currentScore,
              bestGrade: play.grade,
              bestPlate: play.plate,
              bestPlayedAt: play.playedAt,
              previousBestScore: existingBest,
            }
          : {}),
      },
      $inc: { playCount: 1 },
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
  return [play.songName, play.mode ?? "unknown", play.level ?? "unknown"]
    .map((part) => part.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""))
    .join(":");
}

function parsePlayDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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
    nextRefreshAt: profile.nextRefreshAt?.toISOString() ?? null,
  };
}

function publicRecentPlay(play: WithId<PerformancePlayEventDocument>): PerformanceDashboard["recentPlays"][number] {
  return {
    songName: play.songName,
    chartToken: play.chartToken,
    score: play.score,
    grade: play.grade,
    plate: play.plate,
    mode: play.mode,
    level: play.level,
    playedAt: play.playedAt?.toISOString() ?? play.playedAtRaw,
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
    bestPlayedAt: chart.bestPlayedAt?.toISOString() ?? null,
  };
}

function emptyDashboard(mongoReady: boolean): PerformanceDashboard {
  return {
    profile: null,
    totals: {
      trackedPlays: 0,
      trackedCharts: 0,
      upscores: 0,
      averageBestScore: null,
    },
    recentPlays: [],
    topCharts: [],
    canSync: false,
    mongoReady,
  };
}

function objectIdFromString(value: string | null | undefined): ObjectId | null {
  if (!value || !ObjectId.isValid(value)) {
    return null;
  }

  return new ObjectId(value);
}
