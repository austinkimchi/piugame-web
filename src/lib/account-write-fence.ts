import "server-only";

import { ObjectId } from "mongodb";

import { getMongoClient, hasMongoConfig } from "@/lib/mongodb";
import { withPerformanceUserLease } from "@/lib/performance-user-lock";

const COMMUNITY_DB_NAME = process.env.COMMUNITY_DB_NAME ?? "piugame_web";
const USERS_COLLECTION = process.env.COMMUNITY_USERS_COLLECTION ?? "users";

export class AccountWriteUnavailableError extends Error {}

export async function withActiveAccountWrite<T>(
  userIdInputs: Array<string | ObjectId>,
  operation: (assertLeasesOwned: () => Promise<void>) => Promise<T>,
): Promise<T> {
  if (!hasMongoConfig()) {
    throw new AccountWriteUnavailableError("The account is unavailable.");
  }

  const userIds = uniqueSortedObjectIds(userIdInputs);
  if (userIds.length === 0) {
    throw new AccountWriteUnavailableError("The account is unavailable.");
  }

  const assertions: Array<() => Promise<void>> = [];
  const acquireAt = async (index: number): Promise<T> => {
    if (index < userIds.length) {
      return withPerformanceUserLease(userIds[index], async (assertOwned) => {
        assertions.push(assertOwned);
        try {
          return await acquireAt(index + 1);
        } finally {
          assertions.pop();
        }
      });
    }

    await assertAllOwned(assertions);
    const client = await getMongoClient();
    const users = client.db(COMMUNITY_DB_NAME).collection(USERS_COLLECTION);
    const activeUsers = await users.countDocuments({ _id: { $in: userIds } });
    if (activeUsers !== userIds.length) {
      throw new AccountWriteUnavailableError("The account is unavailable.");
    }
    await assertAllOwned(assertions);
    return operation(() => assertAllOwned(assertions));
  };

  return acquireAt(0);
}

async function assertAllOwned(assertions: Array<() => Promise<void>>): Promise<void> {
  for (const assertOwned of assertions) {
    await assertOwned();
  }
}

function uniqueSortedObjectIds(values: Array<string | ObjectId>): ObjectId[] {
  const ids = new Map<string, ObjectId>();
  for (const value of values) {
    const id = value instanceof ObjectId
      ? value
      : ObjectId.isValid(value)
        ? new ObjectId(value)
        : null;
    if (id) {
      ids.set(id.toHexString(), id);
    }
  }
  return [...ids.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, id]) => id);
}
