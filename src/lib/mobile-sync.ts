import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { clearInterval, setInterval } from "node:timers";
import { ObjectId, MongoServerError, type Collection } from "mongodb";

import { AccountWriteUnavailableError, withActiveAccountWrite } from "@/lib/account-write-fence";
import { getMongoClient, hasMongoConfig } from "@/lib/mongodb";
import { importMobilePerformanceSnapshot, MobilePerformanceImportError } from "@/lib/performance";
import {
  acquirePerformanceUserLease,
  PerformanceUserBusyError,
  PERFORMANCE_USER_LOCK_HEARTBEAT_MS,
  PERFORMANCE_USER_LOCK_LEASE_MS,
  releasePerformanceUserLease,
  renewPerformanceUserLease,
  type PerformanceUserLease,
} from "@/lib/performance-user-lock";
import type { MobilePerformanceImport } from "@/lib/mobile-sync-schema";

const COMMUNITY_DB_NAME = process.env.COMMUNITY_DB_NAME ?? "piugame_web";
const MOBILE_IMPORTS_COLLECTION = process.env.MOBILE_IMPORTS_COLLECTION ?? "mobile_sync_imports";
const MOBILE_RATE_LIMITS_COLLECTION = process.env.MOBILE_RATE_LIMITS_COLLECTION ?? "mobile_sync_rate_limits";
const IDEMPOTENCY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const PROCESSING_LEASE_MS = PERFORMANCE_USER_LOCK_LEASE_MS;
const LEASE_HEARTBEAT_MS = PERFORMANCE_USER_LOCK_HEARTBEAT_MS;
const LEASE_OWNERSHIP_RECHECK_MS = LEASE_HEARTBEAT_MS;
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
  processingToken: string;
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
  userId: ObjectId;
  count: number;
  createdAt: Date;
  expiresAt: Date;
}

interface MobileSyncLeaseGuard {
  assertOwned(): Promise<void>;
  stop(): void;
}

export async function claimMobileSyncRateLimit(userId: string, installationId: string, now = new Date()): Promise<boolean> {
  const accountId = objectId(userId);
  try {
    return await withActiveAccountWrite([accountId], async (assertLeaseOwned) => {
      const { rateLimits } = await mobileSyncCollections();
      const window = Math.floor(now.getTime() / RATE_LIMIT_WINDOW_MS);
      const userKey = createHash("sha256").update(`${userId}:user:${window}`).digest("hex");
      const installationKey = createHash("sha256").update(`${userId}:installation:${installationId}:${window}`).digest("hex");
      await assertLeaseOwned();
      if (!(await claimRateLimitBucket(rateLimits, userKey, accountId, now))) {
        return false;
      }
      await assertLeaseOwned();
      return claimRateLimitBucket(rateLimits, installationKey, accountId, now);
    });
  } catch (error) {
    if (error instanceof AccountWriteUnavailableError) {
      throw new MobilePerformanceImportError("account_not_found");
    }
    if (error instanceof PerformanceUserBusyError) {
      throw new MobileSyncInProgressError("Another account operation is still processing.");
    }
    throw error;
  }
}

async function claimRateLimitBucket(
  rateLimits: Collection<MobileSyncRateLimitDocument>,
  key: string,
  userId: ObjectId,
  now: Date,
): Promise<boolean> {
  try {
    const result = await rateLimits.findOneAndUpdate(
      { _id: key, count: { $lt: RATE_LIMIT_REQUESTS_PER_WINDOW } },
      {
        $inc: { count: 1 },
        $setOnInsert: {
          userId,
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
  const processingToken = randomUUID();
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
    processingToken,
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
            processingToken,
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

  let lease: PerformanceUserLease | null = null;
  let leaseGuard: MobileSyncLeaseGuard | null = null;
  try {
    lease = await acquirePerformanceUserLease(userId, processingToken);
    if (!lease) {
      throw new MobileSyncInProgressError("Another import for this user is still processing.");
    }
    leaseGuard = startMobileSyncLeaseGuard(receipts, receiptId, lease);
    const imported = await importMobilePerformanceSnapshot(userIdInput, input, leaseGuard.assertOwned);
    await leaseGuard.assertOwned();
    const result: Omit<MobileSyncResult, "duplicateRequest"> = {
      accepted: true,
      ...imported,
      syncCursor: receiptId.toHexString(),
    };
    const completed = await receipts.updateOne(
      { _id: receiptId, status: "processing", processingToken },
      { $set: { status: "completed", result, completedAt: new Date() } },
    );
    if (completed.modifiedCount !== 1) {
      throw new MobileSyncInProgressError("The import lease was reclaimed before completion.");
    }
    return { ...result, duplicateRequest: false };
  } catch (error) {
    await receipts.deleteOne({ _id: receiptId, status: "processing", processingToken }).catch(() => undefined);
    throw error;
  } finally {
    leaseGuard?.stop();
    if (lease) {
      await releasePerformanceUserLease(lease).catch(() => undefined);
    }
  }
}

function startMobileSyncLeaseGuard(
  receipts: Collection<MobileSyncReceiptDocument>,
  receiptId: ObjectId,
  lease: PerformanceUserLease,
): MobileSyncLeaseGuard {
  let ownershipError: MobileSyncInProgressError | null = null;
  let lastConfirmedAt = Date.now();
  let renewalPromise: Promise<void> | null = null;

  const renew = (): Promise<void> => {
    if (ownershipError) {
      return Promise.reject(ownershipError);
    }
    if (renewalPromise) {
      return renewalPromise;
    }

    const expiresAt = new Date(Date.now() + PROCESSING_LEASE_MS);
    renewalPromise = Promise.all([
      receipts.updateOne(
        { _id: receiptId, status: "processing", processingToken: lease.processingToken },
        { $set: { processingExpiresAt: expiresAt } },
      ),
      renewPerformanceUserLease(lease, expiresAt),
    ])
      .then(([receiptResult, lockRenewed]) => {
        if (receiptResult.matchedCount !== 1 || !lockRenewed) {
          throw new MobileSyncInProgressError("The import lease was reclaimed before completion.");
        }
        lastConfirmedAt = Date.now();
      })
      .catch((error: unknown) => {
        ownershipError = error instanceof MobileSyncInProgressError
          ? error
          : new MobileSyncInProgressError("The import lease could not be renewed.");
        throw ownershipError;
      })
      .finally(() => {
        renewalPromise = null;
      });
    return renewalPromise;
  };

  const heartbeat = setInterval(() => {
    void renew().catch(() => undefined);
  }, LEASE_HEARTBEAT_MS);
  heartbeat.unref();

  return {
    async assertOwned() {
      if (ownershipError) {
        throw ownershipError;
      }
      if (Date.now() - lastConfirmedAt >= LEASE_OWNERSHIP_RECHECK_MS) {
        await renew();
      }
      if (ownershipError) {
        throw ownershipError;
      }
    },
    stop() {
      clearInterval(heartbeat);
    },
  };
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
      rateLimits.createIndex({ userId: 1 }),
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
