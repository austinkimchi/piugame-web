import "server-only";

import { randomUUID } from "node:crypto";
import { clearInterval, setInterval } from "node:timers";
import { MongoServerError, ObjectId, type Collection } from "mongodb";

import { getMongoClient, hasMongoConfig } from "@/lib/mongodb";

const COMMUNITY_DB_NAME = process.env.COMMUNITY_DB_NAME ?? "piugame_web";
const PERFORMANCE_USER_LOCKS_COLLECTION = process.env.MOBILE_SYNC_LOCKS_COLLECTION ?? "mobile_sync_locks";
export const PERFORMANCE_USER_LOCK_LEASE_MS = 5 * 60 * 1000;
export const PERFORMANCE_USER_LOCK_HEARTBEAT_MS = 60 * 1000;

declare global {
  var piuPerformanceUserLockIndexesPromise: Promise<void> | undefined;
}

interface PerformanceUserLockDocument {
  _id: ObjectId;
  processingToken: string;
  expiresAt: Date;
}

export interface PerformanceUserLease {
  userId: ObjectId;
  processingToken: string;
}

export class PerformanceUserBusyError extends Error {}

export async function acquirePerformanceUserLease(
  userIdInput: string | ObjectId,
  processingToken = randomUUID(),
): Promise<PerformanceUserLease | null> {
  const userId = objectId(userIdInput);
  const locks = await lockCollection();
  const now = new Date();
  try {
    const lock = await locks.findOneAndUpdate(
      {
        _id: userId,
        $or: [
          { expiresAt: { $lte: now } },
          { processingToken },
        ],
      },
      {
        $set: {
          processingToken,
          expiresAt: new Date(now.getTime() + PERFORMANCE_USER_LOCK_LEASE_MS),
        },
      },
      { upsert: true, returnDocument: "after" },
    );
    return lock?.processingToken === processingToken ? { userId, processingToken } : null;
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      return null;
    }
    throw error;
  }
}

export async function renewPerformanceUserLease(
  lease: PerformanceUserLease,
  expiresAt = new Date(Date.now() + PERFORMANCE_USER_LOCK_LEASE_MS),
): Promise<boolean> {
  const locks = await lockCollection();
  const result = await locks.updateOne(
    { _id: lease.userId, processingToken: lease.processingToken },
    { $set: { expiresAt } },
  );
  return result.matchedCount === 1;
}

export async function releasePerformanceUserLease(lease: PerformanceUserLease): Promise<void> {
  const locks = await lockCollection();
  await locks.deleteOne({ _id: lease.userId, processingToken: lease.processingToken });
}

export async function withPerformanceUserLease<T>(userIdInput: string | ObjectId, operation: () => Promise<T>): Promise<T> {
  const lease = await acquirePerformanceUserLease(userIdInput);
  if (!lease) {
    throw new PerformanceUserBusyError("Performance data for this user is currently changing.");
  }

  const heartbeat = setInterval(() => {
    void renewPerformanceUserLease(lease).catch(() => undefined);
  }, PERFORMANCE_USER_LOCK_HEARTBEAT_MS);
  heartbeat.unref();

  try {
    return await operation();
  } finally {
    clearInterval(heartbeat);
    await releasePerformanceUserLease(lease).catch(() => undefined);
  }
}

async function lockCollection(): Promise<Collection<PerformanceUserLockDocument>> {
  if (!hasMongoConfig()) {
    throw new Error("MongoDB is required for performance locking.");
  }
  const client = await getMongoClient();
  const locks = client.db(COMMUNITY_DB_NAME).collection<PerformanceUserLockDocument>(PERFORMANCE_USER_LOCKS_COLLECTION);
  if (!globalThis.piuPerformanceUserLockIndexesPromise) {
    globalThis.piuPerformanceUserLockIndexesPromise = locks.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).then(() => undefined);
  }
  await globalThis.piuPerformanceUserLockIndexesPromise;
  return locks;
}

function objectId(value: string | ObjectId): ObjectId {
  if (value instanceof ObjectId) {
    return value;
  }
  if (!ObjectId.isValid(value)) {
    throw new Error("Invalid user identifier.");
  }
  return new ObjectId(value);
}
