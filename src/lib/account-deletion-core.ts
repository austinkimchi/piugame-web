import type { ObjectId } from "mongodb";

export const DISCORD_BOT_USER_COLLECTIONS = [
  "account_links",
  "play_snapshots",
  "recent_pagers",
  "song_pagers",
  "player_profiles",
  "title_caches",
] as const;

export type AccountDeletionDatabase = "community" | "discordBot";

export interface AccountDeletionCollectionNames {
  users: string;
  sessions: string;
  savedSongs: string;
  tagContributions: string;
  tagVotes: string;
  notes: string;
  posts: string;
  siteLogs: string;
  feedback: string;
  mobileCodes: string;
  mobileTokens: string;
  mobileImports: string;
  mobileRateLimits: string;
  performanceProfiles: string;
  performancePlays: string;
  performanceChartStats: string;
  performanceMetricSnapshots: string;
}

export type AccountDeletionOperation =
  | {
      kind: "deleteMany";
      stage: "data" | "identity" | "credentials";
      database: AccountDeletionDatabase;
      collection: string;
      filter: Record<string, unknown>;
    }
  | {
      kind: "updateMany";
      stage: "data";
      database: AccountDeletionDatabase;
      collection: string;
      filter: Record<string, unknown>;
      update: Record<string, unknown>;
    };

export function accountDeletionPlan(args: {
  userId: ObjectId;
  discordUserIds: string[];
  collections: AccountDeletionCollectionNames;
}): AccountDeletionOperation[] {
  const { userId, discordUserIds, collections } = args;
  const userOwnedCollections = [
    collections.savedSongs,
    collections.tagContributions,
    collections.tagVotes,
    collections.notes,
    collections.posts,
    collections.mobileImports,
    collections.mobileRateLimits,
    collections.performanceProfiles,
    collections.performancePlays,
    collections.performanceChartStats,
    collections.performanceMetricSnapshots,
  ];

  const operations: AccountDeletionOperation[] = userOwnedCollections.map((collection) => ({
    kind: "deleteMany",
    stage: "data",
    database: "community",
    collection,
    filter: { userId },
  }));

  operations.push(
    {
      kind: "deleteMany",
      stage: "data",
      database: "community",
      collection: collections.feedback,
      filter: { "user.id": userId.toHexString() },
    },
    {
      kind: "deleteMany",
      stage: "data",
      database: "community",
      collection: collections.siteLogs,
      filter: { $or: [{ actorId: userId }, { targetUserId: userId }] },
    },
    {
      kind: "updateMany",
      stage: "data",
      database: "community",
      collection: collections.posts,
      filter: { removedBy: userId },
      update: { $unset: { removedBy: "" } },
    },
    {
      kind: "updateMany",
      stage: "data",
      database: "community",
      collection: collections.users,
      filter: { _id: { $ne: userId }, mutedBy: userId },
      update: { $unset: { mutedBy: "" } },
    },
  );

  if (discordUserIds.length > 0) {
    for (const collection of DISCORD_BOT_USER_COLLECTIONS) {
      operations.push({
        kind: "deleteMany",
        stage: "data",
        database: "discordBot",
        collection,
        filter: { discordUserId: { $in: discordUserIds } },
      });
    }
  }

  // The identity is removed only after all personal data. Credentials follow so
  // the requesting bearer token remains usable if an earlier deletion must retry.
  operations.push({
    kind: "deleteMany",
    stage: "identity",
    database: "community",
    collection: collections.users,
    filter: { _id: userId },
  });

  for (const collection of [collections.sessions, collections.mobileCodes, collections.mobileTokens]) {
    operations.push({
      kind: "deleteMany",
      stage: "credentials",
      database: "community",
      collection,
      filter: { userId },
    });
  }

  return operations;
}
