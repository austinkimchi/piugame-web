import "server-only";

import { getMongoClient, hasMongoConfig } from "@/lib/mongodb";
import { withActiveAccountWrite } from "@/lib/account-write-fence";
import type { PublicUser } from "@/lib/auth";

const FEEDBACK_DB_NAME = process.env.COMMUNITY_DB_NAME ?? "piugame_web";
const FEEDBACK_COLLECTION = process.env.FEEDBACK_COLLECTION ?? "site_feedback";

export type FeedbackKind = "catalog-error" | "catalog-contribution" | "owner-message";

export interface FeedbackInput {
  kind: FeedbackKind;
  scenario: string;
  subject: string;
  message: string;
  pageUrl: string;
  contact: string;
}

interface FeedbackDocument extends FeedbackInput {
  user: PublicUser | null;
  userAgent: string;
  ipAddress: string;
  status: "new";
  createdAt: Date;
  updatedAt: Date;
}

export function hasFeedbackStorage(): boolean {
  return hasMongoConfig();
}

export async function createFeedback(input: FeedbackInput, context: { user: PublicUser | null; userAgent: string; ipAddress: string }) {
  if (!hasMongoConfig()) {
    throw new Error("Feedback storage is not configured.");
  }

  const store = async (assertLeaseOwned: () => Promise<void>) => {
    const now = new Date();
    const client = await getMongoClient();
    const collection = client.db(FEEDBACK_DB_NAME).collection<FeedbackDocument>(FEEDBACK_COLLECTION);
    await collection.createIndex({ createdAt: -1 });
    await collection.createIndex({ kind: 1, scenario: 1, createdAt: -1 });
    await assertLeaseOwned();
    await collection.insertOne({
      ...input,
      user: context.user,
      userAgent: context.userAgent,
      ipAddress: context.ipAddress,
      status: "new",
      createdAt: now,
      updatedAt: now,
    });
  };

  if (context.user) {
    await withActiveAccountWrite([context.user.id], store);
  } else {
    await store(async () => undefined);
  }
}
