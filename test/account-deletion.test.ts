import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId } from "mongodb";

import {
  accountDeletionPlan,
  type AccountDeletionCollectionNames,
} from "../src/lib/account-deletion-core.ts";

const collections: AccountDeletionCollectionNames = {
  users: "users",
  sessions: "auth_sessions",
  savedSongs: "saved_songs",
  tagContributions: "song_tag_contributions",
  tagVotes: "song_tag_votes",
  notes: "song_notes",
  posts: "song_community_posts",
  siteLogs: "site_logs",
  feedback: "site_feedback",
  mobileCodes: "mobile_oauth_codes",
  mobileTokens: "mobile_access_tokens",
  mobileImports: "mobile_sync_imports",
  mobileRateLimits: "mobile_sync_rate_limits",
  performanceProfiles: "performance_profiles",
  performancePlays: "performance_play_events",
  performanceChartStats: "performance_chart_stats",
  performanceMetricSnapshots: "performance_metric_snapshots",
};

test("account deletion removes every MyPIU user-owned collection and deletes the identity last", () => {
  const userId = new ObjectId("507f1f77bcf86cd799439011");
  const plan = accountDeletionPlan({ userId, discordUserIds: [], collections });
  const deletedCollections = plan
    .filter((operation) => operation.kind === "deleteMany")
    .map((operation) => operation.collection);

  for (const collection of [
    "auth_sessions",
    "saved_songs",
    "song_tag_contributions",
    "song_tag_votes",
    "song_notes",
    "song_community_posts",
    "site_logs",
    "site_feedback",
    "mobile_oauth_codes",
    "mobile_access_tokens",
    "mobile_sync_imports",
    "mobile_sync_rate_limits",
    "performance_profiles",
    "performance_play_events",
    "performance_chart_stats",
    "performance_metric_snapshots",
    "users",
  ]) {
    assert.ok(deletedCollections.includes(collection), `missing ${collection}`);
  }
  assert.deepEqual(plan.at(-1), {
    kind: "deleteMany",
    stage: "credentials",
    database: "community",
    collection: "mobile_access_tokens",
    filter: { userId },
  });
  const identityIndex = plan.findIndex((operation) => operation.stage === "identity");
  const firstCredentialIndex = plan.findIndex((operation) => operation.stage === "credentials");
  assert.ok(identityIndex > 0);
  assert.ok(firstCredentialIndex > identityIndex);
});

test("account deletion clears moderator references and all linked Discord bot caches", () => {
  const userId = new ObjectId("507f1f77bcf86cd799439011");
  const plan = accountDeletionPlan({ userId, discordUserIds: ["discord-42", "discord-84"], collections });
  const botCollections = plan
    .filter((operation) => operation.database === "discordBot")
    .map((operation) => operation.collection);

  assert.deepEqual(botCollections, [
    "account_links",
    "play_snapshots",
    "recent_pagers",
    "song_pagers",
    "player_profiles",
    "title_caches",
  ]);
  assert.deepEqual(
    plan.find((operation) => operation.database === "discordBot")?.filter,
    { discordUserId: { $in: ["discord-42", "discord-84"] } },
  );
  assert.ok(
    plan.some((operation) => operation.kind === "updateMany"
      && operation.database === "community"
      && operation.collection === "song_community_posts"
      && operation.filter.removedBy === userId),
  );
  assert.deepEqual(
    plan.find((operation) => operation.kind === "updateMany" && operation.collection === "song_community_posts"),
    {
      kind: "updateMany",
      stage: "data",
      database: "community",
      collection: "song_community_posts",
      filter: { removedBy: userId },
      update: { $unset: { removedBy: "" } },
    },
  );
});
