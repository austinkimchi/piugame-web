import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { ObjectId, type Collection, type WithId } from "mongodb";
import { cookies } from "next/headers";
import { cache } from "react";

import type { CryptoPayloadV1 } from "@/lib/credential-crypto";
import { withActiveAccountWrite } from "@/lib/account-write-fence";
import { getMongoClient, hasMongoConfig } from "@/lib/mongodb";
import { encryptCredential } from "@/lib/credential-crypto";
import { withPerformanceUserLease } from "@/lib/performance-user-lock";
import { piuDisplayName } from "@/lib/piu-account";
import { getScoreLinkablePerformancePlay } from "@/lib/performance";
import { isFailedPerformanceGrade } from "@/lib/performance-format";
import { DEFAULT_PIU_GAME_VERSION, isPiuGameVersion, normalizePiuGameVersion } from "@/lib/piu-version";
import type { DiscordProfile } from "@/lib/discord-oauth";
import type { PiuCatalogVersion, SongSortOption, SortDirection } from "@/lib/types";
import type { PlayerData } from "@austinkimchi/piugame-sdk";

export const SESSION_COOKIE_NAME = "piu_session";
export const OAUTH_STATE_COOKIE_NAME = "piu_oauth_state";
export const OAUTH_NEXT_COOKIE_NAME = "piu_oauth_next";

const COMMUNITY_DB_NAME = process.env.COMMUNITY_DB_NAME ?? "piugame_web";
const USERS_COLLECTION = process.env.COMMUNITY_USERS_COLLECTION ?? "users";
const SESSIONS_COLLECTION = process.env.COMMUNITY_SESSIONS_COLLECTION ?? "auth_sessions";
const SAVED_SONGS_COLLECTION = process.env.COMMUNITY_SAVED_SONGS_COLLECTION ?? "saved_songs";
const TAG_CONTRIBUTIONS_COLLECTION = process.env.COMMUNITY_TAG_CONTRIBUTIONS_COLLECTION ?? "song_tag_contributions";
const TAG_VOTES_COLLECTION = process.env.COMMUNITY_TAG_VOTES_COLLECTION ?? "song_tag_votes";
const NOTES_COLLECTION = process.env.COMMUNITY_NOTES_COLLECTION ?? "song_notes";
const POSTS_COLLECTION = process.env.COMMUNITY_POSTS_COLLECTION ?? "song_community_posts";
const SITE_LOGS_COLLECTION = process.env.SITE_LOGS_COLLECTION ?? "site_logs";
const DISCORD_BOT_DB_NAME = process.env.DISCORD_BOT_DB_NAME ?? "piugame_discord";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const COMMUNITY_CHART_KEY_MAX_LENGTH = 80;

export type UserRole = "user" | "moderator" | "admin";
type AuthProvider = "google" | "discord" | "piugame";

declare global {
  var piuCommunityIndexesPromise: Promise<void> | undefined;
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  username: string | null;
  imageUrl: string | null;
  provider: AuthProvider;
  roles: UserRole[];
  mutedUntil: string | null;
  preferences: UserPreferences;
  discord: {
    userId: string;
    username: string;
    linkedAt: string | null;
  } | null;
  piuProfile: {
    piuUsername: string;
    displayName: string;
    gameId: string | null;
    pumpTag: string | null;
    avatarUrl: string | null;
    linkedAt: string | null;
    lastProfileFetchedAt: string | null;
  } | null;
}

export interface UserPreferences {
  performanceAutoRefresh: boolean;
  piuGameVersion: PiuCatalogVersion;
  songDetailCompactView: boolean;
  songPreviewMuted: boolean;
  songPreviewVolume: number;
  songExplorerSortBy: SongSortOption;
  songExplorerSortDirection: SortDirection;
  songExplorerFavoritesFirst: boolean;
}

interface AuthProviderIdentity {
  provider: AuthProvider;
  providerAccountId: string;
  email?: string;
  username?: string;
}

interface UserDocument {
  email: string;
  emailVerified: boolean;
  name: string;
  username?: string | null;
  usernameLower?: string | null;
  imageUrl: string | null;
  primaryProvider: AuthProvider;
  providers: AuthProviderIdentity[];
  roles?: UserRole[];
  mutedUntil?: Date | null;
  mutedReason?: string | null;
  mutedBy?: ObjectId | null;
  preferences?: Partial<UserPreferences> & {
    piuGameVersionUpdatedAt?: Date;
  };
  piuLink?: {
    piuUsername?: string;
    displayName?: string;
    gameId?: string | null;
    pumpTag?: string | null;
    avatarUrl?: string | null;
    encryptedPassword?: CryptoPayloadV1;
    discordUserId?: string;
    discordUsername?: string;
    botDatabase?: string;
    linkedAt?: Date;
    lastProfileFetchedAt?: Date;
  };
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date;
}

interface SessionDocument {
  userId: ObjectId;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  lastSeenAt: Date;
}

export interface SongCommunityState {
  saved: boolean;
  note: string;
  userTags: Array<{ chartToken: string; tag: string }>;
  communityTags: Array<{ chartToken: string; tag: string; score: number; mine: boolean; myVote: 1 | -1 | null }>;
  tagVotes: Array<{ chartToken: string; tag: string; vote: 1 | -1 }>;
  posts: CommunityPost[];
}

interface SavedSongDocument {
  userId: ObjectId;
  songSlug: string;
  title: string;
  artist: string;
  version: string;
  createdAt: Date;
  updatedAt: Date;
}

interface TagContributionDocument {
  userId: ObjectId;
  songSlug: string;
  chartToken: string;
  tag: string;
  title: string;
  artist: string;
  createdAt: Date;
  updatedAt: Date;
}

interface TagVoteDocument {
  userId: ObjectId;
  songSlug: string;
  chartToken: string;
  tag: string;
  value: 1 | -1;
  title: string;
  artist: string;
  createdAt: Date;
}

type CommunityPostStatus = "active" | "archived" | "removed";

interface CommunityPostDocument {
  userId: ObjectId;
  username: string;
  songSlug: string;
  chartToken: string;
  title: string;
  artist: string;
  body: string;
  youtubeUrl: string | null;
  youtubeVideoId: string | null;
  caption: string | null;
  scoreLink?: CommunityPostScoreLinkDocument | null;
  status: CommunityPostStatus;
  createdAt: Date;
  updatedAt: Date;
  removedAt?: Date | null;
  removedBy?: ObjectId | null;
  archivedAt?: Date | null;
  moderationNote?: string | null;
}

interface CommunityPostScoreLinkDocument {
  performancePlayId: ObjectId;
  score: number | null;
  grade: string | null;
  plate: string | null;
  stageBreak: boolean;
  judgments: { perfect: number | null; great: number | null; good: number | null; bad: number | null; miss: number | null } | null;
  playedAt: Date | null;
  showPlate: boolean;
  showJudgments: boolean;
}

export interface CommunityPost {
  id: string;
  authorId: string;
  username: string;
  body: string;
  youtubeUrl: string | null;
  youtubeVideoId: string | null;
  caption: string | null;
  scoreLink: {
    performancePlayId: string;
    score: number | null;
    grade: string | null;
    plate: string | null;
    stageBreak: boolean;
    judgments: { perfect: number | null; great: number | null; good: number | null; bad: number | null; miss: number | null } | null;
    playedAt: string | null;
    showPlate: boolean;
    showJudgments: boolean;
  } | null;
  createdAt: string;
  canDelete: boolean;
  canArchive: boolean;
  canModerate: boolean;
}

interface SongNoteDocument {
  userId: ObjectId;
  songSlug: string;
  chartToken: string;
  title: string;
  artist: string;
  note: string;
  source: "web";
  botCompatibility: {
    database: "piugame_discord";
    collection: "player_profiles" | "play_snapshots" | "none";
  };
  createdAt: Date;
  updatedAt: Date;
}

interface SiteLogDocument {
  category: "moderation" | "admin";
  class: "community" | "user" | "role";
  action: "post.remove" | "user.mute" | "role.assign" | "role.revoke";
  actorId: ObjectId;
  actorUsername: string | null;
  targetUserId?: ObjectId | null;
  targetUsername?: string | null;
  songSlug?: string | null;
  postId?: ObjectId | null;
  notes?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

interface BotAccountLinkDocument {
  discordUserId: string;
  piuUsername: string;
  piuPassword: CryptoPayloadV1;
  defaultVisibility?: "private" | "public";
  hideRecentPagerButtons?: boolean;
  recentPagerHideAfterSeconds?: 0 | 30 | 60 | 120 | 300;
  recentImageQuality?: "small" | "decent" | "best";
  createdAt: Date;
  updatedAt: Date;
}

interface BotPlayerProfileDocument {
  discordUserId: string;
  piuUsername: string;
  pumpTag: string | null;
  gameId: string | null;
  displayName: string;
  avatarUrl: string | null;
  pumpTagNormalized: string | null;
  piuUsernameNormalized: string;
  createdAt: Date;
  updatedAt: Date;
  lastProfileFetchedAt: Date;
}

const DEFAULT_USER_PREFERENCES: UserPreferences = {
  performanceAutoRefresh: false,
  piuGameVersion: DEFAULT_PIU_GAME_VERSION,
  songDetailCompactView: false,
  songPreviewMuted: true,
  songPreviewVolume: 0.5,
  songExplorerSortBy: "series",
  songExplorerSortDirection: "desc",
  songExplorerFavoritesFirst: false,
};

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function syntheticDiscordEmail(discordId: string): string {
  return `discord-${discordId}@piugame.local`;
}

function sessionExpiresAt(): Date {
  return new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
}

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeTag(value: unknown): string {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9 +#.'-]/g, "").slice(0, 40);
}

function normalizeLookupValue(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeOptionalLookupValue(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = normalizeLookupValue(value);
  return normalized.length > 0 ? normalized : null;
}

async function collections() {
  if (!hasMongoConfig()) {
    throw new Error("MongoDB is required for login and community features.");
  }

  const client = await getMongoClient();
  const db = client.db(COMMUNITY_DB_NAME);
  const result = {
    users: db.collection<UserDocument>(USERS_COLLECTION),
    sessions: db.collection<SessionDocument>(SESSIONS_COLLECTION),
    savedSongs: db.collection<SavedSongDocument>(SAVED_SONGS_COLLECTION),
    tagContributions: db.collection<TagContributionDocument>(TAG_CONTRIBUTIONS_COLLECTION),
    tagVotes: db.collection<TagVoteDocument>(TAG_VOTES_COLLECTION),
    notes: db.collection<SongNoteDocument>(NOTES_COLLECTION),
    posts: db.collection<CommunityPostDocument>(POSTS_COLLECTION),
    siteLogs: db.collection<SiteLogDocument>(SITE_LOGS_COLLECTION),
  };

  if (!globalThis.piuCommunityIndexesPromise) {
    globalThis.piuCommunityIndexesPromise = ensureIndexes(result);
  }
  await globalThis.piuCommunityIndexesPromise;

  return result;
}

async function botCollections() {
  if (!hasMongoConfig()) {
    throw new Error("MongoDB is required for bot account linking.");
  }

  const client = await getMongoClient();
  const db = client.db(DISCORD_BOT_DB_NAME);
  return {
    accountLinks: db.collection<BotAccountLinkDocument>("account_links"),
    playerProfiles: db.collection<BotPlayerProfileDocument>("player_profiles"),
  };
}

async function ensureIndexes(args: {
  users: Collection<UserDocument>;
  sessions: Collection<SessionDocument>;
  savedSongs: Collection<SavedSongDocument>;
  tagContributions: Collection<TagContributionDocument>;
  tagVotes: Collection<TagVoteDocument>;
  notes: Collection<SongNoteDocument>;
  posts: Collection<CommunityPostDocument>;
  siteLogs: Collection<SiteLogDocument>;
}): Promise<void> {
  await Promise.all([dropLegacyTagIndexes(args.tagContributions), dropLegacyNoteIndexes(args.notes)]);

  await Promise.all([
    args.users.createIndex({ email: 1 }, { unique: true }),
    args.users.createIndex({ usernameLower: 1 }, { unique: true, partialFilterExpression: { usernameLower: { $type: "string" } } }),
    args.users.createIndex({ "providers.provider": 1, "providers.providerAccountId": 1 }),
    args.sessions.createIndex({ tokenHash: 1 }, { unique: true }),
    args.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    args.savedSongs.createIndex({ userId: 1, songSlug: 1 }, { unique: true }),
    args.savedSongs.createIndex({ songSlug: 1 }),
    args.tagContributions.createIndex({ userId: 1, songSlug: 1, chartToken: 1, tag: 1 }, { unique: true }),
    args.tagContributions.createIndex({ songSlug: 1, chartToken: 1, tag: 1 }),
    args.tagVotes.createIndex({ userId: 1, songSlug: 1, chartToken: 1, tag: 1 }, { unique: true }),
    args.tagVotes.createIndex({ songSlug: 1, chartToken: 1, tag: 1 }),
    args.notes.createIndex({ userId: 1, songSlug: 1, chartToken: 1 }, { unique: true }),
    args.notes.createIndex({ songSlug: 1, chartToken: 1 }),
    args.posts.createIndex({ songSlug: 1, chartToken: 1, status: 1, createdAt: -1 }),
    args.posts.createIndex({ userId: 1, status: 1 }),
    args.posts.createIndex({ userId: 1, songSlug: 1, chartToken: 1, status: 1 }),
    args.siteLogs.createIndex({ category: 1, createdAt: -1 }),
    args.siteLogs.createIndex({ actorId: 1, createdAt: -1 }),
  ]);
}

async function dropLegacyTagIndexes(collection: Collection<TagContributionDocument>): Promise<void> {
  const indexes = await collection.indexes();
  const legacyIndexNames = indexes
    .filter((index) => JSON.stringify(index.key) === JSON.stringify({ userId: 1, songSlug: 1, tag: 1 }) || JSON.stringify(index.key) === JSON.stringify({ songSlug: 1, tag: 1 }))
    .map((index) => index.name)
    .filter((name): name is string => typeof name === "string");

  for (const indexName of legacyIndexNames) {
    await collection.dropIndex(indexName).catch(() => {});
  }
}

async function dropLegacyNoteIndexes(collection: Collection<SongNoteDocument>): Promise<void> {
  const indexes = await collection.indexes();
  const legacyIndexNames = indexes
    .filter((index) => JSON.stringify(index.key) === JSON.stringify({ userId: 1, songSlug: 1 }))
    .map((index) => index.name)
    .filter((name): name is string => typeof name === "string");

  for (const indexName of legacyIndexNames) {
    await collection.dropIndex(indexName).catch(() => {});
  }
}

function publicUser(document: WithId<UserDocument>): PublicUser {
  const roles = publicRoles(document);
  const discordIdentity = document.providers.find((provider) => provider.provider === "discord");
  return {
    id: document._id.toHexString(),
    name: document.name,
    email: document.email,
    username: document.username ?? null,
    imageUrl: document.imageUrl,
    provider: document.primaryProvider,
    roles,
    mutedUntil: document.mutedUntil && document.mutedUntil > new Date() ? document.mutedUntil.toISOString() : null,
    preferences: publicUserPreferences(document.preferences),
    discord: discordIdentity
      ? {
          userId: discordIdentity.providerAccountId,
          username: discordIdentity.username ?? document.piuLink?.discordUsername ?? "Discord",
          linkedAt: document.piuLink?.linkedAt?.toISOString() ?? null,
        }
      : null,
    piuProfile: document.piuLink?.piuUsername
      ? {
          piuUsername: document.piuLink.piuUsername,
          displayName: document.piuLink.displayName ?? document.piuLink.piuUsername,
          gameId: document.piuLink.gameId ?? null,
          pumpTag: document.piuLink.pumpTag ?? null,
          avatarUrl: document.piuLink.avatarUrl ?? null,
          linkedAt: document.piuLink.linkedAt?.toISOString() ?? null,
          lastProfileFetchedAt: document.piuLink.lastProfileFetchedAt?.toISOString() ?? null,
        }
      : null,
  };
}

export async function upsertGoogleUser(profile: {
  googleId: string;
  email: string;
  emailVerified: boolean;
  name: string;
  imageUrl: string | null;
}): Promise<WithId<UserDocument>> {
  const { users } = await collections();
  const now = new Date();
  const email = profile.email.toLowerCase();
  const providerIdentity: AuthProviderIdentity = {
    provider: "google",
    providerAccountId: profile.googleId,
    email,
  };

  const existing = await users.findOne({
    $or: [{ email }, { providers: { $elemMatch: { provider: "google", providerAccountId: profile.googleId } } }],
  });

  if (!existing) {
    const inserted = await users.insertOne({
      email,
      emailVerified: profile.emailVerified,
      name: profile.name || email,
      username: null,
      usernameLower: null,
      imageUrl: profile.imageUrl,
      primaryProvider: "google",
      providers: [providerIdentity],
      roles: ["user"],
      preferences: DEFAULT_USER_PREFERENCES,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });
    const created = await users.findOne({ _id: inserted.insertedId });
    if (!created) {
      throw new Error("Failed to create user.");
    }
    return created;
  }

  const hasGoogleProvider = existing.providers.some((provider) => provider.provider === "google" && provider.providerAccountId === profile.googleId);
  await users.updateOne(
    { _id: existing._id },
    {
      $set: {
        emailVerified: profile.emailVerified,
        name: profile.name || existing.name,
        imageUrl: profile.imageUrl ?? existing.imageUrl,
        roles: existing.roles?.length ? existing.roles : ["user"],
        updatedAt: now,
        lastLoginAt: now,
      },
      ...(hasGoogleProvider ? {} : { $push: { providers: providerIdentity } }),
    },
  );

  return {
    ...existing,
    emailVerified: profile.emailVerified,
    name: profile.name || existing.name,
    imageUrl: profile.imageUrl ?? existing.imageUrl,
    roles: existing.roles?.length ? existing.roles : ["user"],
    updatedAt: now,
    lastLoginAt: now,
    providers: hasGoogleProvider ? existing.providers : [...existing.providers, providerIdentity],
  };
}

export async function upsertDiscordUser(profile: DiscordProfile, linkToUserId?: string): Promise<WithId<UserDocument>> {
  const { users } = await collections();
  const now = new Date();
  const providerIdentity: AuthProviderIdentity = {
    provider: "discord",
    providerAccountId: profile.discordId,
    email: profile.email ?? undefined,
    username: profile.username,
  };
  const linkedUserObjectId = linkToUserId ? objectIdFromString(linkToUserId) : null;
  if (linkToUserId && !linkedUserObjectId) {
    throw new Error("Could not link Discord to this session.");
  }

  const providerOwner = await users.findOne({
    providers: { $elemMatch: { provider: "discord", providerAccountId: profile.discordId } },
  });

  if (linkedUserObjectId) {
    if (providerOwner && !providerOwner._id.equals(linkedUserObjectId)) {
      throw new Error("That Discord account is already linked to another user.");
    }

    const existing = await users.findOne({ _id: linkedUserObjectId });
    if (!existing) {
      throw new Error("User not found.");
    }

    const hasDiscordProvider = existing.providers.some((provider) => provider.provider === "discord" && provider.providerAccountId === profile.discordId);
    const piuLink = {
      ...(existing.piuLink ?? {}),
      discordUserId: profile.discordId,
      discordUsername: profile.username,
      linkedAt: existing.piuLink?.linkedAt ?? now,
    };
    await users.updateOne(
      { _id: existing._id },
      {
        $set: {
          imageUrl: existing.imageUrl ?? profile.imageUrl,
          piuLink,
          roles: existing.roles?.length ? existing.roles : ["user"],
          updatedAt: now,
          lastLoginAt: now,
        },
        ...(hasDiscordProvider ? {} : { $push: { providers: providerIdentity } }),
      },
    );
    await withActiveAccountWrite([existing._id], (assertLeaseOwned) => syncBotLinkFromPiuLink(piuLink, assertLeaseOwned));

    return {
      ...existing,
      imageUrl: existing.imageUrl ?? profile.imageUrl,
      providers: hasDiscordProvider ? existing.providers : [...existing.providers, providerIdentity],
      piuLink,
      roles: existing.roles?.length ? existing.roles : ["user"],
      updatedAt: now,
      lastLoginAt: now,
    };
  }

  const email = profile.email?.toLowerCase() ?? syntheticDiscordEmail(profile.discordId);
  const existing = providerOwner ?? (profile.email ? await users.findOne({ email }) : null);

  if (!existing) {
    const inserted = await users.insertOne({
      email,
      emailVerified: profile.emailVerified,
      name: profile.displayName,
      username: null,
      usernameLower: null,
      imageUrl: profile.imageUrl,
      primaryProvider: "discord",
      providers: [providerIdentity],
      roles: ["user"],
      preferences: DEFAULT_USER_PREFERENCES,
      piuLink: {
        discordUserId: profile.discordId,
        discordUsername: profile.username,
        linkedAt: now,
      },
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });
    const created = await users.findOne({ _id: inserted.insertedId });
    if (!created) {
      throw new Error("Failed to create user.");
    }
    return created;
  }

  const hasDiscordProvider = existing.providers.some((provider) => provider.provider === "discord" && provider.providerAccountId === profile.discordId);
  const piuLink = {
    ...(existing.piuLink ?? {}),
    discordUserId: profile.discordId,
    discordUsername: profile.username,
    linkedAt: existing.piuLink?.linkedAt ?? now,
  };
  await users.updateOne(
    { _id: existing._id },
    {
      $set: {
        emailVerified: existing.email === email ? profile.emailVerified : existing.emailVerified,
        name: existing.name || profile.displayName,
        imageUrl: existing.imageUrl ?? profile.imageUrl,
        piuLink,
        roles: existing.roles?.length ? existing.roles : ["user"],
        updatedAt: now,
        lastLoginAt: now,
      },
      ...(hasDiscordProvider ? {} : { $push: { providers: providerIdentity } }),
    },
  );
  await withActiveAccountWrite([existing._id], (assertLeaseOwned) => syncBotLinkFromPiuLink(piuLink, assertLeaseOwned));

  return {
    ...existing,
    emailVerified: existing.email === email ? profile.emailVerified : existing.emailVerified,
    name: existing.name || profile.displayName,
    imageUrl: existing.imageUrl ?? profile.imageUrl,
    providers: hasDiscordProvider ? existing.providers : [...existing.providers, providerIdentity],
    piuLink,
    roles: existing.roles?.length ? existing.roles : ["user"],
    updatedAt: now,
    lastLoginAt: now,
  };
}

export async function createSession(userId: ObjectId): Promise<string> {
  return withActiveAccountWrite([userId], async (assertLeaseOwned) => {
    const { sessions } = await collections();
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    await assertLeaseOwned();
    await sessions.insertOne({
      userId,
      tokenHash: tokenHash(token),
      createdAt: now,
      expiresAt: sessionExpiresAt(),
      lastSeenAt: now,
    });
    return token;
  });
}

export async function getCurrentUserId(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token || !hasMongoConfig()) {
    return null;
  }

  const { sessions, users } = await collections();
  const session = await sessions.findOne({ tokenHash: tokenHash(token), expiresAt: { $gt: new Date() } });
  if (!session) {
    return null;
  }
  const user = await users.findOne({ _id: session.userId }, { projection: { _id: 1 } });
  return user ? session.userId.toHexString() : null;
}

export const getCurrentUser = cache(async (): Promise<PublicUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token || !hasMongoConfig()) {
    return null;
  }

  const { sessions, users } = await collections();
  const session = await sessions.findOne({ tokenHash: tokenHash(token), expiresAt: { $gt: new Date() } });
  if (!session) {
    return null;
  }

  const user = await users.findOne({ _id: session.userId });
  if (!user) {
    return null;
  }

  void sessions.updateOne({ _id: session._id }, { $set: { lastSeenAt: new Date() } });
  return publicUser(user);
});

export async function linkPiuAccount(
  user: PublicUser,
  args: {
    piuUsername: string;
    password: string;
    profile: PlayerData;
  },
): Promise<PublicUser> {
  return withPerformanceUserLease(user.id, (assertLeaseOwned) => linkPiuAccountWhileLocked(user, args, assertLeaseOwned));
}

async function linkPiuAccountWhileLocked(
  user: PublicUser,
  args: {
    piuUsername: string;
    password: string;
    profile: PlayerData;
  },
  assertLeaseOwned: () => Promise<void>,
): Promise<PublicUser> {
  const { users } = await collections();
  const now = new Date();
  const piuUsername = args.profile.username.trim().length > 0 ? args.profile.username : args.piuUsername.trim();
  const existing = await users.findOne({ _id: objectIdFromUser(user) });
  if (!existing) {
    throw new Error("User not found.");
  }

  const piuIdentity: AuthProviderIdentity = {
    provider: "piugame",
    providerAccountId: piuUsername.toLowerCase(),
    username: piuUsername,
  };
  const hasPiuProvider = existing.providers.some((provider) => provider.provider === "piugame" && provider.providerAccountId === piuIdentity.providerAccountId);
  const piuLink = {
    ...(existing.piuLink ?? {}),
    piuUsername,
    displayName: piuDisplayName(args.profile, piuUsername),
    gameId: args.profile.gameId,
    pumpTag: args.profile.gameIdTag,
    avatarUrl: args.profile.avatarUrl,
    encryptedPassword: encryptCredential(args.password),
    botDatabase: "piugame_discord",
    linkedAt: existing.piuLink?.linkedAt ?? now,
    lastProfileFetchedAt: now,
  };

  await assertLeaseOwned();
  const result = await users.findOneAndUpdate(
    { _id: existing._id },
    {
      $set: {
        imageUrl: args.profile.avatarUrl ?? existing.imageUrl,
        piuLink,
        updatedAt: now,
      },
      ...(hasPiuProvider ? {} : { $push: { providers: piuIdentity } }),
    },
    { returnDocument: "after" },
  );

  if (!result) {
    throw new Error("Failed to link PIU account.");
  }
  await assertLeaseOwned();
  await syncBotLinkFromPiuLink(piuLink, assertLeaseOwned);
  return publicUser(result);
}

export async function unlinkDiscordAccount(user: PublicUser): Promise<PublicUser> {
  const { users } = await collections();
  const existing = await users.findOne({ _id: objectIdFromUser(user) });
  if (!existing) {
    throw new Error("User not found.");
  }

  const discordIdentity = existing.providers.find((provider) => provider.provider === "discord");
  if (!discordIdentity) {
    return publicUser(existing);
  }
  if (existing.providers.length <= 1) {
    throw new Error("Link another sign-in service before disconnecting Discord.");
  }

  const piuLinkWithoutDiscord = { ...(existing.piuLink ?? {}) };
  delete piuLinkWithoutDiscord.discordUserId;
  delete piuLinkWithoutDiscord.discordUsername;
  const updated = await users.findOneAndUpdate(
    { _id: existing._id },
    {
      $pull: { providers: { provider: "discord" } },
      $set: {
        piuLink: piuLinkWithoutDiscord,
        updatedAt: new Date(),
      },
    },
    { returnDocument: "after" },
  );
  if (!updated) {
    throw new Error("Could not disconnect Discord.");
  }

  const { accountLinks, playerProfiles } = await botCollections();
  await Promise.all([
    accountLinks.deleteOne({ discordUserId: discordIdentity.providerAccountId }),
    playerProfiles.deleteOne({ discordUserId: discordIdentity.providerAccountId }),
  ]);

  return publicUser(updated);
}

async function syncBotLinkFromPiuLink(
  piuLink: UserDocument["piuLink"],
  assertLeaseOwned: () => Promise<void>,
): Promise<void> {
  if (!piuLink?.discordUserId || !piuLink.piuUsername || !piuLink.encryptedPassword) {
    return;
  }

  const { accountLinks, playerProfiles } = await botCollections();
  const now = new Date();
  await assertLeaseOwned();
  await Promise.all([
    accountLinks.updateOne(
      { discordUserId: piuLink.discordUserId },
      {
        $set: {
          piuUsername: piuLink.piuUsername,
          piuPassword: piuLink.encryptedPassword,
          updatedAt: now,
        },
        $setOnInsert: {
          discordUserId: piuLink.discordUserId,
          defaultVisibility: "public",
          hideRecentPagerButtons: true,
          recentPagerHideAfterSeconds: 60,
          recentImageQuality: "decent",
          createdAt: now,
        },
        $unset: {
          ssoUsername: "",
          ssoPassword: "",
        },
      },
      { upsert: true },
    ),
    playerProfiles.updateOne(
      { discordUserId: piuLink.discordUserId },
      {
        $set: {
          discordUserId: piuLink.discordUserId,
          piuUsername: piuLink.piuUsername,
          pumpTag: piuLink.pumpTag ?? null,
          gameId: piuLink.gameId ?? null,
          displayName: piuLink.displayName ?? piuLink.piuUsername,
          avatarUrl: piuLink.avatarUrl ?? null,
          pumpTagNormalized: normalizeOptionalLookupValue(piuLink.pumpTag),
          piuUsernameNormalized: normalizeLookupValue(piuLink.piuUsername),
          updatedAt: now,
          lastProfileFetchedAt: piuLink.lastProfileFetchedAt ?? now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true },
    ),
  ]);
}

export async function deleteCurrentSession(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token || !hasMongoConfig()) {
    return;
  }

  const { sessions } = await collections();
  await sessions.deleteOne({ tokenHash: tokenHash(token) });
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export async function getSongCommunityState(user: PublicUser | null, songSlug: string, selectedChartToken?: string | null, communityKeyInput?: string | null): Promise<SongCommunityState> {
  const emptyState: SongCommunityState = {
    saved: false,
    note: "",
    userTags: [],
    communityTags: [],
    tagVotes: [],
    posts: [],
  };

  if (!hasMongoConfig()) {
    return emptyState;
  }

  const { savedSongs, tagVotes, notes, posts } = await collections();
  const userId = user ? objectIdFromUser(user) : null;
  const chartToken = cleanText(selectedChartToken).slice(0, 24);
  const communityKey = cleanText(communityKeyInput ?? chartToken).slice(0, COMMUNITY_CHART_KEY_MAX_LENGTH);
  const [saved, note, userVotes, tagScores, communityPosts] = await Promise.all([
    userId ? savedSongs.findOne({ userId, songSlug }) : null,
    userId && communityKey ? notes.findOne({ userId, songSlug, chartToken: communityKey }) : null,
    userId
      ? tagVotes
          .find({ userId, songSlug, chartToken: { $type: "string" } })
          .project<{ chartToken: string; tag: string; value: 1 | -1 }>({ chartToken: 1, tag: 1, value: 1, _id: 0 })
          .toArray()
      : [],
    tagVotes
      .aggregate<{ _id: { chartToken: string; tag: string }; score: number }>([
        { $match: { songSlug, chartToken: { $type: "string" } } },
        { $group: { _id: { chartToken: "$chartToken", tag: "$tag" }, score: { $sum: "$value" } } },
        { $match: { score: { $gt: 0 } } },
        { $sort: { "_id.chartToken": 1, score: -1, "_id.tag": 1 } },
      ])
      .toArray(),
    communityKey ? posts.find({ songSlug, chartToken: communityKey, status: "active" }).sort({ createdAt: -1 }).limit(40).toArray() : [],
  ]);
  const myVotes = new Map(userVotes.map((entry) => [`${entry.chartToken}:${entry.tag}`, entry.value]));
  const canModerate = isModerator(user);

  return {
    saved: Boolean(saved),
    note: note?.note ?? "",
    userTags: userVotes.filter((entry) => entry.value === 1 && entry.chartToken === communityKey).map((entry) => ({ chartToken, tag: entry.tag })),
    communityTags: tagScores.filter((entry) => entry._id.chartToken === communityKey).map((entry) => ({
      chartToken,
      tag: entry._id.tag,
      score: entry.score,
      mine: myVotes.get(`${communityKey}:${entry._id.tag}`) === 1,
      myVote: myVotes.get(`${communityKey}:${entry._id.tag}`) ?? null,
    })),
    tagVotes: userVotes.filter((entry) => entry.chartToken === communityKey).map((entry) => ({ chartToken, tag: entry.tag, vote: entry.value })),
    posts: communityPosts.map((post) => publicCommunityPost(post, user, canModerate)),
  };
}

export async function getFavoriteSongSlugSet(user: PublicUser | null, songSlugs: string[]): Promise<Set<string>> {
  if (!user || !hasMongoConfig() || songSlugs.length === 0) {
    return new Set();
  }

  const { savedSongs } = await collections();
  const documents = await savedSongs
    .find({ userId: objectIdFromUser(user), songSlug: { $in: songSlugs } })
    .project<{ songSlug: string }>({ songSlug: 1, _id: 0 })
    .toArray();

  return new Set(documents.map((document) => document.songSlug));
}

export async function getAllFavoriteSongSlugs(user: PublicUser | null): Promise<Set<string>> {
  if (!user || !hasMongoConfig()) {
    return new Set();
  }

  const { savedSongs } = await collections();
  const documents = await savedSongs
    .find({ userId: objectIdFromUser(user) })
    .project<{ songSlug: string }>({ songSlug: 1, _id: 0 })
    .toArray();

  return new Set(documents.map((document) => document.songSlug));
}

export async function setSongSaved(user: PublicUser, song: { slug: string; title: string; artist: string; version: string }, saved: boolean): Promise<void> {
  const { savedSongs } = await collections();
  const userId = objectIdFromUser(user);
  if (!saved) {
    await savedSongs.deleteOne({ userId, songSlug: song.slug });
    return;
  }

  const now = new Date();
  await withActiveAccountWrite([userId], async (assertLeaseOwned) => {
    await assertLeaseOwned();
    await savedSongs.updateOne(
      { userId, songSlug: song.slug },
      {
        $set: {
          title: song.title,
          artist: song.artist,
          version: song.version,
          updatedAt: now,
        },
        $setOnInsert: {
          userId,
          songSlug: song.slug,
          createdAt: now,
        },
      },
      { upsert: true },
    );
  });
}

export async function addSongTag(user: PublicUser, song: { slug: string; title: string; artist: string }, chartTokenInput: string, tagInput: string): Promise<string | null> {
  return voteSongTag(user, song, chartTokenInput, tagInput, 1);
}

export async function voteSongTag(user: PublicUser, song: { slug: string; title: string; artist: string }, chartTokenInput: string, tagInput: string, value: 1 | -1): Promise<string | null> {
  requireUsername(user);
  requireNotMuted(user);
  const chartToken = cleanText(chartTokenInput).slice(0, COMMUNITY_CHART_KEY_MAX_LENGTH);
  const tag = normalizeTag(tagInput);
  if (!chartToken || !tag) {
    return null;
  }

  const { tagContributions, tagVotes } = await collections();
  const now = new Date();
  const userId = objectIdFromUser(user);
  return withActiveAccountWrite([userId], async (assertLeaseOwned) => {
    const existingVote = await tagVotes.findOne({ userId, songSlug: song.slug, chartToken, tag });
    if (existingVote) {
      throw new Error("You already voted on that tag.");
    }
    await assertLeaseOwned();
    await tagVotes.insertOne({
      userId,
      songSlug: song.slug,
      chartToken,
      tag,
      value,
      title: song.title,
      artist: song.artist,
      createdAt: now,
    });

    if (value === -1) {
      return tag;
    }

    await assertLeaseOwned();
    await tagContributions.updateOne(
      { userId, songSlug: song.slug, chartToken, tag },
      {
        $set: {
          title: song.title,
          artist: song.artist,
          updatedAt: now,
        },
        $setOnInsert: {
          userId,
          songSlug: song.slug,
          chartToken,
          tag,
          createdAt: now,
        },
      },
      { upsert: true },
    );
    return tag;
  });
}

export async function removeSongTag(user: PublicUser, songSlug: string, chartTokenInput: string, tagInput: string): Promise<void> {
  requireUsername(user);
  const chartToken = cleanText(chartTokenInput).slice(0, COMMUNITY_CHART_KEY_MAX_LENGTH);
  const tag = normalizeTag(tagInput);
  if (!chartToken || !tag) {
    return;
  }

  const { tagContributions, tagVotes } = await collections();
  const userId = objectIdFromUser(user);
  await Promise.all([
    tagContributions.deleteOne({ userId, songSlug, chartToken, tag }),
    tagVotes.deleteOne({ userId, songSlug, chartToken, tag, value: 1 }),
  ]);
}

export async function createCommunityPost(
  user: PublicUser,
  song: { slug: string; title: string; artist: string },
  chartTokenInput: string,
  bodyInput: string,
  youtubeUrlInput?: string,
  captionInput?: string,
  scoreLinkInput?: { performancePlayId?: string; piuVersion?: string; showPlate?: boolean; showJudgments?: boolean },
  performanceChartTokenInput?: string,
): Promise<void> {
  requireUsername(user);
  requireNotMuted(user);
  const chartToken = cleanText(chartTokenInput).slice(0, COMMUNITY_CHART_KEY_MAX_LENGTH);
  const body = cleanMultiline(bodyInput).slice(0, 1600);
  const youtube = parseYouTubeUrl(youtubeUrlInput);
  const caption = cleanText(captionInput).slice(0, 180) || null;
  if (!chartToken) {
    throw new Error("Select a chart before posting.");
  }
  if (body.length < 2 && !youtube && !scoreLinkInput?.performancePlayId) {
    throw new Error("Add a comment or YouTube video.");
  }

  const scoreLink = scoreLinkInput?.performancePlayId
    ? await scoreLinkForPost(user, song, cleanText(performanceChartTokenInput ?? chartToken).slice(0, 24), scoreLinkInput)
    : null;

  const { posts } = await collections();
  const userId = objectIdFromUser(user);
  await withActiveAccountWrite([userId], async (assertLeaseOwned) => {
    const activePost = await posts.findOne({ userId, songSlug: song.slug, chartToken, status: "active" });
    if (activePost) {
      throw new Error("Archive your current post before adding a new one.");
    }

    const now = new Date();
    await assertLeaseOwned();
    await posts.insertOne({
      userId,
      username: user.username ?? user.name,
      songSlug: song.slug,
      chartToken,
      title: song.title,
      artist: song.artist,
      body,
      youtubeUrl: youtube?.url ?? null,
      youtubeVideoId: youtube?.videoId ?? null,
      caption,
      scoreLink,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function scoreLinkForPost(
  user: PublicUser,
  song: { slug: string; title: string; artist: string },
  chartToken: string,
  input: { performancePlayId?: string; piuVersion?: string; showPlate?: boolean; showJudgments?: boolean },
): Promise<CommunityPostScoreLinkDocument> {
  const performancePlay = await getScoreLinkablePerformancePlay(user.id, {
    playId: input.performancePlayId ?? "",
    songName: song.title,
    chartToken,
  });
  if (!performancePlay) {
    throw new Error("That performance attempt is no longer available to link.");
  }
  const performancePlayId = objectIdFromString(performancePlay.id);
  if (!performancePlayId) {
    throw new Error("That performance attempt is no longer available to link.");
  }
  const failedAttempt = performancePlay.stageBreak || isFailedPerformanceGrade(performancePlay.grade);

  return {
    performancePlayId,
    score: performancePlay.score,
    grade: performancePlay.grade,
    plate: performancePlay.plate,
    stageBreak: performancePlay.stageBreak,
    judgments: performancePlay.judgments,
    playedAt: performancePlay.playedAt ? new Date(performancePlay.playedAt) : null,
    showPlate: !failedAttempt && input.showPlate !== false,
    showJudgments: input.showJudgments === true,
  };
}

export async function archiveCommunityPost(user: PublicUser, postIdInput: string): Promise<void> {
  requireUsername(user);
  const postId = objectIdFromString(postIdInput);
  if (!postId) {
    throw new Error("Post not found.");
  }

  const { posts } = await collections();
  const userId = objectIdFromUser(user);
  const post = await posts.findOne({ _id: postId, userId, status: "active" });
  if (!post) {
    throw new Error("Post not found.");
  }

  await posts.updateOne(
    { _id: postId, userId, status: "active" },
    {
      $set: {
        status: "archived",
        archivedAt: new Date(),
        updatedAt: new Date(),
      },
    },
  );
}

export async function deleteCommunityPost(user: PublicUser, postIdInput: string): Promise<void> {
  const postId = objectIdFromString(postIdInput);
  if (!postId) {
    throw new Error("Post not found.");
  }

  const { posts } = await collections();
  const post = await posts.findOne({ _id: postId, status: "active" });
  if (!post) {
    throw new Error("Post not found.");
  }
  if (!post.userId.equals(objectIdFromUser(user)) && !isModerator(user)) {
    throw new Error("You cannot delete this post.");
  }

  const actorId = objectIdFromUser(user);
  await withActiveAccountWrite([actorId, post.userId], async (assertLeaseOwned) => {
    await assertLeaseOwned();
    await posts.updateOne(
      { _id: postId },
      {
        $set: {
          status: "removed",
          removedAt: new Date(),
          removedBy: actorId,
          moderationNote: post.userId.equals(actorId) ? "Deleted by author." : "Removed by moderator.",
        },
      },
    );
  });
}

export async function removeCommunityPost(user: PublicUser, postIdInput: string, notesInput?: string): Promise<void> {
  requireModerator(user);
  const postId = objectIdFromString(postIdInput);
  if (!postId) {
    throw new Error("Post not found.");
  }

  const { posts, siteLogs } = await collections();
  const post = await posts.findOne({ _id: postId, status: "active" });
  if (!post) {
    throw new Error("Post not found.");
  }

  const notes = cleanText(notesInput).slice(0, 600) || null;
  const now = new Date();
  const actorId = objectIdFromUser(user);
  await withActiveAccountWrite([actorId, post.userId], async (assertLeaseOwned) => {
    await assertLeaseOwned();
    await posts.updateOne(
      { _id: postId },
      {
        $set: {
          status: "removed",
          removedAt: now,
          removedBy: actorId,
          moderationNote: notes,
        },
      },
    );
    await assertLeaseOwned();
    await siteLogs.insertOne({
      category: "moderation",
      class: "community",
      action: "post.remove",
      actorId,
      actorUsername: user.username,
      targetUserId: post.userId,
      targetUsername: post.username,
      songSlug: post.songSlug,
      postId,
      notes,
      createdAt: now,
    });
  });
}

export async function muteCommunityUser(user: PublicUser, targetUserIdInput: string, notesInput?: string, daysInput = 7): Promise<void> {
  requireModerator(user);
  const targetUserId = objectIdFromString(targetUserIdInput);
  if (!targetUserId) {
    throw new Error("User not found.");
  }
  const { users, siteLogs } = await collections();
  const target = await users.findOne({ _id: targetUserId });
  if (!target) {
    throw new Error("User not found.");
  }
  const days = Math.min(Math.max(Math.floor(daysInput), 1), 365);
  const mutedUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const notes = cleanText(notesInput).slice(0, 600) || null;
  const now = new Date();
  const actorId = objectIdFromUser(user);
  await withActiveAccountWrite([actorId, targetUserId], async (assertLeaseOwned) => {
    await assertLeaseOwned();
    await users.updateOne(
      { _id: targetUserId },
      {
        $set: {
          mutedUntil,
          mutedReason: notes,
          mutedBy: actorId,
          updatedAt: now,
        },
      },
    );
    await assertLeaseOwned();
    await siteLogs.insertOne({
      category: "moderation",
      class: "user",
      action: "user.mute",
      actorId,
      actorUsername: user.username,
      targetUserId,
      targetUsername: target.username ?? target.name,
      notes,
      metadata: { days, mutedUntil: mutedUntil.toISOString() },
      createdAt: now,
    });
  });
}

export async function saveSongNote(user: PublicUser, song: { slug: string; title: string; artist: string }, chartTokenInput: string, noteInput: string): Promise<void> {
  requireUsername(user);
  const chartToken = cleanText(chartTokenInput).slice(0, COMMUNITY_CHART_KEY_MAX_LENGTH);
  const note = String(noteInput ?? "").trim().slice(0, 4000);
  if (!chartToken) {
    throw new Error("Select a chart before saving a note.");
  }
  const { notes } = await collections();
  const userId = objectIdFromUser(user);
  if (!note) {
    await notes.deleteOne({ userId, songSlug: song.slug, chartToken });
    return;
  }

  const now = new Date();
  await withActiveAccountWrite([userId], async (assertLeaseOwned) => {
    await assertLeaseOwned();
    await notes.updateOne(
      { userId, songSlug: song.slug, chartToken },
      {
        $set: {
          title: song.title,
          artist: song.artist,
          note,
          source: "web",
          botCompatibility: {
            database: "piugame_discord",
            collection: "none",
          },
          updatedAt: now,
        },
        $setOnInsert: {
          userId,
          songSlug: song.slug,
          chartToken,
          createdAt: now,
        },
      },
      { upsert: true },
    );
  });
}

export async function setUsername(user: PublicUser, usernameInput: string): Promise<PublicUser> {
  const username = normalizeUsername(usernameInput);
  if (!username) {
    throw new Error("Choose a username using 3-20 letters, numbers, underscores, or hyphens.");
  }

  const { users } = await collections();
  const now = new Date();
  const result = await users.findOneAndUpdate(
    { _id: objectIdFromUser(user) },
    {
      $set: {
        username,
        usernameLower: username.toLowerCase(),
        updatedAt: now,
      },
    },
    { returnDocument: "after" },
  );

  if (!result) {
    throw new Error("User not found.");
  }
  return publicUser(result);
}

export async function updateUserPreferences(user: PublicUser, preferences: Partial<UserPreferences>): Promise<PublicUser> {
  const now = new Date();
  const updates: {
    "preferences.performanceAutoRefresh"?: boolean;
    "preferences.piuGameVersion"?: PiuCatalogVersion;
    "preferences.piuGameVersionUpdatedAt"?: Date;
    "preferences.songDetailCompactView"?: boolean;
    "preferences.songPreviewMuted"?: boolean;
    "preferences.songPreviewVolume"?: number;
    "preferences.songExplorerSortBy"?: SongSortOption;
    "preferences.songExplorerSortDirection"?: SortDirection;
    "preferences.songExplorerFavoritesFirst"?: boolean;
    updatedAt: Date;
  } = {
    updatedAt: now,
  };

  if (typeof preferences.songDetailCompactView === "boolean") {
    updates["preferences.songDetailCompactView"] = preferences.songDetailCompactView;
  }
  if (typeof preferences.performanceAutoRefresh === "boolean") {
    updates["preferences.performanceAutoRefresh"] = preferences.performanceAutoRefresh;
  }
  if (isPiuGameVersion(preferences.piuGameVersion)) {
    updates["preferences.piuGameVersion"] = preferences.piuGameVersion;
    updates["preferences.piuGameVersionUpdatedAt"] = now;
  }
  if (typeof preferences.songPreviewMuted === "boolean") {
    updates["preferences.songPreviewMuted"] = preferences.songPreviewMuted;
  }
  if (typeof preferences.songPreviewVolume === "number") {
    updates["preferences.songPreviewVolume"] = Math.min(Math.max(preferences.songPreviewVolume, 0), 1);
  }
  if (isSongExplorerSortBy(preferences.songExplorerSortBy)) {
    updates["preferences.songExplorerSortBy"] = preferences.songExplorerSortBy;
  }
  if (isSongExplorerSortDirection(preferences.songExplorerSortDirection)) {
    updates["preferences.songExplorerSortDirection"] = preferences.songExplorerSortDirection;
  }
  if (typeof preferences.songExplorerFavoritesFirst === "boolean") {
    updates["preferences.songExplorerFavoritesFirst"] = preferences.songExplorerFavoritesFirst;
  }

  const { users } = await collections();
  const result = await users.findOneAndUpdate(
    { _id: objectIdFromUser(user) },
    { $set: updates },
    { returnDocument: "after" },
  );

  if (!result) {
    throw new Error("User not found.");
  }
  return publicUser(result);
}

export interface AdminUserSearchResult {
  id: string;
  name: string;
  username: string | null;
  email: string;
  roles: UserRole[];
  mutedUntil: string | null;
  createdAt: string;
}

export async function searchUsersForAdmin(actor: PublicUser, queryInput: string): Promise<AdminUserSearchResult[]> {
  requireAdmin(actor);
  const query = cleanText(queryInput).slice(0, 80);
  const { users } = await collections();
  const filter = query
    ? {
        $or: [
          { usernameLower: { $regex: escapeRegex(query.toLowerCase()), $options: "i" } },
          { email: { $regex: escapeRegex(query.toLowerCase()), $options: "i" } },
          { name: { $regex: escapeRegex(query), $options: "i" } },
        ],
      }
    : {};
  const documents = await users.find(filter).sort({ updatedAt: -1 }).limit(25).toArray();
  return documents.map((document) => {
    const user = publicUser(document);
    return {
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      roles: user.roles,
      mutedUntil: user.mutedUntil,
      createdAt: document.createdAt.toISOString(),
    };
  });
}

export async function setUserModeratorRole(actor: PublicUser, targetUserIdInput: string, enabled: boolean, notesInput?: string): Promise<void> {
  requireAdmin(actor);
  const targetUserId = objectIdFromString(targetUserIdInput);
  if (!targetUserId) {
    throw new Error("User not found.");
  }

  const { users, siteLogs } = await collections();
  const now = new Date();
  const target = await users.findOne({ _id: targetUserId });
  if (!target) {
    throw new Error("User not found.");
  }

  const actorId = objectIdFromUser(actor);
  await withActiveAccountWrite([actorId, targetUserId], async (assertLeaseOwned) => {
    await assertLeaseOwned();
    if (enabled) {
      await users.updateOne({ _id: targetUserId }, { $addToSet: { roles: "moderator" }, $set: { updatedAt: now } });
    } else {
      await users.updateOne({ _id: targetUserId }, { $pull: { roles: "moderator" }, $set: { updatedAt: now } });
    }

    await assertLeaseOwned();
    await siteLogs.insertOne({
      category: "admin",
      class: "role",
      action: enabled ? "role.assign" : "role.revoke",
      actorId,
      actorUsername: actor.username,
      targetUserId,
      targetUsername: target.username ?? target.name,
      notes: cleanText(notesInput).slice(0, 600) || null,
      metadata: { role: "moderator" },
      createdAt: now,
    });
  });
}

export function isModerator(user: PublicUser | null): boolean {
  return Boolean(user && (user.roles.includes("moderator") || user.roles.includes("admin")));
}

export function isAdmin(user: PublicUser | null): boolean {
  return Boolean(user?.roles.includes("admin"));
}

function objectIdFromUser(user: PublicUser): ObjectId {
  return new ObjectId(user.id);
}

function objectIdFromString(value: string): ObjectId | null {
  return ObjectId.isValid(value) ? new ObjectId(value) : null;
}

function publicRoles(document: WithId<UserDocument>): UserRole[] {
  const roles = new Set<UserRole>(["user"]);
  for (const role of document.roles ?? []) {
    if (role === "moderator") {
      roles.add("moderator");
    }
  }
  if (adminEmailSet().has(document.email.toLowerCase())) {
    roles.add("admin");
    roles.add("moderator");
  }
  return Array.from(roles);
}

function publicUserPreferences(preferences: Partial<UserPreferences> | undefined): UserPreferences {
  const volume = Number(preferences?.songPreviewVolume);

  return {
    performanceAutoRefresh: preferences?.performanceAutoRefresh === true,
    piuGameVersion: normalizePiuGameVersion(preferences?.piuGameVersion),
    songDetailCompactView: preferences?.songDetailCompactView === true,
    songPreviewMuted: preferences?.songPreviewMuted !== false,
    songPreviewVolume: Number.isFinite(volume) ? Math.min(Math.max(volume, 0), 1) : DEFAULT_USER_PREFERENCES.songPreviewVolume,
    songExplorerSortBy: isSongExplorerSortBy(preferences?.songExplorerSortBy) ? preferences.songExplorerSortBy : DEFAULT_USER_PREFERENCES.songExplorerSortBy,
    songExplorerSortDirection: isSongExplorerSortDirection(preferences?.songExplorerSortDirection)
      ? preferences.songExplorerSortDirection
      : DEFAULT_USER_PREFERENCES.songExplorerSortDirection,
    songExplorerFavoritesFirst: preferences?.songExplorerFavoritesFirst === true,
  };
}

function isSongExplorerSortBy(value: unknown): value is SongSortOption {
  return value === "series" || value === "title" || value === "artist" || value === "folder";
}

function isSongExplorerSortDirection(value: unknown): value is SortDirection {
  return value === "asc" || value === "desc";
}

function adminEmailSet(): Set<string> {
  return new Set(
    String(process.env.SITE_ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

function publicCommunityPost(post: WithId<CommunityPostDocument>, viewer: PublicUser | null, viewerCanModerate: boolean): CommunityPost {
  const authorId = post.userId.toHexString();
  return {
    id: post._id.toHexString(),
    authorId,
    username: post.username,
    body: post.body,
    youtubeUrl: post.youtubeUrl,
    youtubeVideoId: post.youtubeVideoId,
    caption: post.caption,
    scoreLink: post.scoreLink
      ? {
          performancePlayId: post.scoreLink.performancePlayId.toHexString(),
          score: post.scoreLink.score,
          grade: post.scoreLink.grade,
          plate: post.scoreLink.showPlate ? post.scoreLink.plate : null,
          stageBreak: post.scoreLink.stageBreak,
          judgments: post.scoreLink.showJudgments ? post.scoreLink.judgments : null,
          playedAt: post.scoreLink.playedAt?.toISOString() ?? null,
          showPlate: post.scoreLink.showPlate,
          showJudgments: post.scoreLink.showJudgments,
        }
      : null,
    createdAt: post.createdAt.toISOString(),
    canDelete: Boolean(viewer && (viewer.id === authorId || viewerCanModerate)),
    canArchive: Boolean(viewer && viewer.id === authorId),
    canModerate: viewerCanModerate && viewer?.id !== authorId,
  };
}

function requireUsername(user: PublicUser): void {
  if (!user.username) {
    throw new Error("Choose a site username before using community features.");
  }
}

function requireNotMuted(user: PublicUser): void {
  if (user.mutedUntil && new Date(user.mutedUntil) > new Date()) {
    throw new Error("Your account is muted from community actions right now.");
  }
}

function requireModerator(user: PublicUser): void {
  if (!isModerator(user)) {
    throw new Error("Moderator permission required.");
  }
}

function requireAdmin(user: PublicUser): void {
  if (!isAdmin(user)) {
    throw new Error("Admin permission required.");
  }
}

function normalizeUsername(value: string): string | null {
  const username = cleanText(value).replace(/\s+/g, "_");
  if (!/^[a-zA-Z0-9_-]{3,20}$/.test(username)) {
    return null;
  }
  return username;
}

function cleanMultiline(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseYouTubeUrl(value: unknown): { url: string; videoId: string } | null {
  const raw = cleanText(value).slice(0, 300);
  if (!raw) {
    return null;
  }

  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, "");
    let videoId = "";
    if (host === "youtu.be") {
      videoId = url.pathname.split("/").filter(Boolean)[0] ?? "";
    } else if (host === "youtube.com" || host === "m.youtube.com") {
      videoId = url.searchParams.get("v") ?? "";
      if (!videoId && url.pathname.startsWith("/shorts/")) {
        videoId = url.pathname.split("/").filter(Boolean)[1] ?? "";
      }
    }
    if (!/^[a-zA-Z0-9_-]{6,20}$/.test(videoId)) {
      return null;
    }
    return { url: `https://www.youtube.com/watch?v=${videoId}`, videoId };
  } catch {
    return null;
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
