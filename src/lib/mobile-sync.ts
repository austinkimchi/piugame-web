import "server-only";

import { createHash } from "node:crypto";
import { ObjectId, MongoServerError, type Collection } from "mongodb";

import { getMongoClient, hasMongoConfig } from "@/lib/mongodb";
import { importMobilePerformanceSnapshot } from "@/lib/performance";
import type { MobilePerformanceImport } from "@/lib/mobile-sync-schema";

const COMMUNITY_DB_NAME = process.env.COMMUNITY_DB_NAME ?? "piugame_web";
const MOBILE_IMPORTS_COLLECTION = process.env.MOBILE_IMPORTS_COLLECTION ?? "mobile_sync_imports";
const MOBILE_RATE_LIMITS_COLLECTION = process.env.MOBILE_RATE_LIMITS_COLLECTION ?? "mobile_sync_rate_limits";
const IDEMPOTENCY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const PROCESSING_LEASE_MS = 2 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_REQUESTS_PER_WINDOW = 30;

declare global {
  var piuMobileSyncIndexesPromise: Promise<void> | undefined;
}

export interface MobileSyncResult {
  accepted: true;
  importedRecentPlays: number;
  duplicateRecentPlays: number;
  syncCursor: string;
  duplicateRequest: boolean;
}

interface MobileSyncReceiptDocument {
  userId: ObjectId;
  idempotencyKey: string;
  installationId: string;
  payloadHash: string;
  source: MobilePerformanceImport["source"];
  appVersion: string | null;
  piuVersion: MobilePerformanceImport["piuVersion"];
  generatedAt: Date;
  status: "processing" | "completed";
  result: Omit<MobileSyncResult, "duplicateRequest"> | null;
  createdAt: Date;
  processingExpiresAt: Date;
  completedAt: Date | null;
  expiresAt: Date;
}

export class MobileSyncInProgressError extends Error {}
export class MobileSyncIdempotencyConflictError extends Error {}

interface MobileSyncRateLimitDocument {
  _id: string;
  count: number;
  createdAt: Date;
  expiresAt: Date;
}

export async function claimMobileSyncRateLimit(userId: string, installationId: string, now = new Date()): Promise<boolean> {
  const { rateLimits } = await mobileSyncCollections();
  const window = Math.floor(now.getTime() / RATE_LIMIT_WINDOW_MS);
  const key = createHash("sha256").update(`${userId}:${installationId}:${window}`).digest("hex");
  try {
    const result = await rateLimits.findOneAndUpdate(
      { _id: key, count: { $lt: RATE_LIMIT_REQUESTS_PER_WINDOW } },
      {
        $inc: { count: 1 },
        $setOnInsert: {
          createdAt: now,
          expiresAt: new Date(now.getTime() + 2 * RATE_LIMIT_WINDOW_MS),
        },
      },
      { upsert: true, returnDocument: "after" },
    );
    return result !== null;
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      return false;
    }
    throw error;
  }
}

export async function importIdempotentMobilePerformance(
  userIdInput: string,
  input: MobilePerformanceImport,
): Promise<MobileSyncResult> {
  const userId = objectId(userIdInput);
  const { receipts } = await mobileSyncCollections();
  const now = new Date();
  const payloadHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const receipt: MobileSyncReceiptDocument = {
    userId,
    idempotencyKey: input.idempotencyKey,
    installationId: input.installationId,
    payloadHash,
    source: input.source,
    appVersion: input.appVersion,
    piuVersion: input.piuVersion,
    generatedAt: new Date(input.generatedAt),
    status: "processing",
    result: null,
    createdAt: now,
    processingExpiresAt: new Date(now.getTime() + PROCESSING_LEASE_MS),
    completedAt: null,
    expiresAt: new Date(now.getTime() + IDEMPOTENCY_RETENTION_MS),
  };

  let receiptId: ObjectId;
  try {
    receiptId = (await receipts.insertOne(receipt)).insertedId;
  } catch (error) {
    if (!(error instanceof MongoServerError) || error.code !== 11000) {
      throw error;
    }
    const existing = await receipts.findOne({ userId, idempotencyKey: input.idempotencyKey });
    if (existing && existing.payloadHash !== payloadHash) {
      throw new MobileSyncIdempotencyConflictError("The idempotency key was already used for another payload.");
    }
    if (existing?.status === "completed" && existing.result) {
      return { ...existing.result, duplicateRequest: true };
    }
    if (existing?.status === "processing" && existing.processingExpiresAt <= now) {
      const reclaimed = await receipts.findOneAndUpdate(
        { _id: existing._id, status: "processing", processingExpiresAt: { $lte: now } },
        {
          $set: {
            installationId: input.installationId,
            source: input.source,
            appVersion: input.appVersion,
            piuVersion: input.piuVersion,
            generatedAt: new Date(input.generatedAt),
            createdAt: now,
            processingExpiresAt: new Date(now.getTime() + PROCESSING_LEASE_MS),
            expiresAt: new Date(now.getTime() + IDEMPOTENCY_RETENTION_MS),
          },
        },
        { returnDocument: "after" },
      );
      if (reclaimed) {
        receiptId = reclaimed._id;
      } else {
        throw new MobileSyncInProgressError("A matching import is still processing.");
      }
    } else {
      throw new MobileSyncInProgressError("A matching import is still processing.");
    }
  }

  try {
    const imported = await importMobilePerformanceSnapshot(userIdInput, input);
    const result: Omit<MobileSyncResult, "duplicateRequest"> = {
      accepted: true,
      ...imported,
      syncCursor: receiptId.toHexString(),
    };
    await receipts.updateOne(
      { _id: receiptId, status: "processing" },
      { $set: { status: "completed", result, completedAt: new Date() } },
    );
    return { ...result, duplicateRequest: false };
  } catch (error) {
    await receipts.deleteOne({ _id: receiptId, status: "processing" }).catch(() => undefined);
    throw error;
  }
}

async function mobileSyncCollections(): Promise<{
  receipts: Collection<MobileSyncReceiptDocument>;
  rateLimits: Collection<MobileSyncRateLimitDocument>;
}> {
  if (!hasMongoConfig()) {
    throw new Error("MongoDB is required for mobile sync.");
  }
  const client = await getMongoClient();
  const db = client.db(COMMUNITY_DB_NAME);
  const receipts = db.collection<MobileSyncReceiptDocument>(MOBILE_IMPORTS_COLLECTION);
  const rateLimits = db.collection<MobileSyncRateLimitDocument>(MOBILE_RATE_LIMITS_COLLECTION);
  if (!globalThis.piuMobileSyncIndexesPromise) {
    globalThis.piuMobileSyncIndexesPromise = Promise.all([
      receipts.createIndex({ userId: 1, idempotencyKey: 1 }, { unique: true }),
      receipts.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      receipts.createIndex({ userId: 1, createdAt: -1 }),
      rateLimits.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ]).then(() => undefined);
  }
  await globalThis.piuMobileSyncIndexesPromise;
  return { receipts, rateLimits };
}

function objectId(value: string): ObjectId {
  if (!ObjectId.isValid(value)) {
    throw new Error("Invalid user identifier.");
  }
  return new ObjectId(value);
}
