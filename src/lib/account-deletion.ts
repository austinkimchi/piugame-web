import "server-only";

import { ObjectId, type Document } from "mongodb";

import {
  accountDeletionPlan,
  type AccountDeletionCollectionNames,
  type AccountDeletionOperation,
} from "@/lib/account-deletion-core";
import { getMongoClient, hasMongoConfig } from "@/lib/mongodb";
import { withPerformanceUserLease } from "@/lib/performance-user-lock";

const COMMUNITY_DB_NAME = process.env.COMMUNITY_DB_NAME ?? "piugame_web";
const DISCORD_BOT_DB_NAME = process.env.DISCORD_BOT_DB_NAME ?? "piugame_discord";

const COLLECTIONS: AccountDeletionCollectionNames = {
  users: process.env.COMMUNITY_USERS_COLLECTION ?? "users",
  sessions: process.env.COMMUNITY_SESSIONS_COLLECTION ?? "auth_sessions",
  savedSongs: process.env.COMMUNITY_SAVED_SONGS_COLLECTION ?? "saved_songs",
  tagContributions: process.env.COMMUNITY_TAG_CONTRIBUTIONS_COLLECTION ?? "song_tag_contributions",
  tagVotes: process.env.COMMUNITY_TAG_VOTES_COLLECTION ?? "song_tag_votes",
  notes: process.env.COMMUNITY_NOTES_COLLECTION ?? "song_notes",
  posts: process.env.COMMUNITY_POSTS_COLLECTION ?? "song_community_posts",
  siteLogs: process.env.SITE_LOGS_COLLECTION ?? "site_logs",
  feedback: process.env.FEEDBACK_COLLECTION ?? "site_feedback",
  mobileCodes: process.env.MOBILE_OAUTH_CODES_COLLECTION ?? "mobile_oauth_codes",
  mobileTokens: process.env.MOBILE_ACCESS_TOKENS_COLLECTION ?? "mobile_access_tokens",
  mobileImports: process.env.MOBILE_IMPORTS_COLLECTION ?? "mobile_sync_imports",
  mobileRateLimits: process.env.MOBILE_RATE_LIMITS_COLLECTION ?? "mobile_sync_rate_limits",
  performanceProfiles: process.env.PERFORMANCE_PROFILES_COLLECTION ?? "performance_profiles",
  performancePlays: process.env.PERFORMANCE_PLAYS_COLLECTION ?? "performance_play_events",
  performanceChartStats: process.env.PERFORMANCE_CHART_STATS_COLLECTION ?? "performance_chart_stats",
  performanceMetricSnapshots: process.env.PERFORMANCE_METRIC_SNAPSHOTS_COLLECTION ?? "performance_metric_snapshots",
};

interface DeletableUserDocument {
  providers?: Array<{ provider?: string; providerAccountId?: string }>;
  piuLink?: { discordUserId?: string };
}

export class AccountDeletionNotFoundError extends Error {}

export async function deleteUserAccount(userIdInput: string): Promise<void> {
  if (!hasMongoConfig() || !ObjectId.isValid(userIdInput)) {
    throw new AccountDeletionNotFoundError("The account no longer exists.");
  }

  const userId = new ObjectId(userIdInput);
  await withPerformanceUserLease(userId, async (assertLeaseOwned) => {
    await assertLeaseOwned();
    const client = await getMongoClient();
    const communityDb = client.db(COMMUNITY_DB_NAME);
    const users = communityDb.collection<DeletableUserDocument>(COLLECTIONS.users);
    const user = await users.findOne(
      { _id: userId },
      { projection: { providers: 1, "piuLink.discordUserId": 1 } },
    );
    if (!user) {
      throw new AccountDeletionNotFoundError("The account no longer exists.");
    }

    const discordUserIds = cleanDiscordUserIds([
      ...(user.providers ?? [])
        .filter((provider) => provider.provider === "discord")
        .map((provider) => provider.providerAccountId),
      user.piuLink?.discordUserId,
    ]);
    const plan = accountDeletionPlan({ userId, discordUserIds, collections: COLLECTIONS });
    for (const operation of plan.filter((item) => item.stage === "data")) {
      await assertLeaseOwned();
      await applyOperation(client, operation);
    }

    await assertLeaseOwned();
    const identityOperation = plan.find((operation) => operation.stage === "identity");
    if (!identityOperation) {
      throw new Error("The account deletion plan has no identity operation.");
    }
    await applyOperation(client, identityOperation);
    const accountStillExists = await users.findOne({ _id: userId }, { projection: { _id: 1 } });
    if (accountStillExists) {
      throw new Error("The account identity could not be deleted.");
    }

    for (const operation of plan.filter((item) => item.stage === "credentials")) {
      await applyOperation(client, operation).catch((error: unknown) => {
        console.error("Post-identity credential deletion failed.", error);
      });
    }
  });
}

async function applyOperation(
  client: Awaited<ReturnType<typeof getMongoClient>>,
  operation: AccountDeletionOperation,
): Promise<void> {
  const database = operation.database === "community" ? COMMUNITY_DB_NAME : DISCORD_BOT_DB_NAME;
  const collection = client.db(database).collection<Document>(operation.collection);
  if (operation.kind === "deleteMany") {
    await collection.deleteMany(operation.filter);
    return;
  }
  await collection.updateMany(operation.filter, operation.update);
}

function cleanDiscordUserIds(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}
