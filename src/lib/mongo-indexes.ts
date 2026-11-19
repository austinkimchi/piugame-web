import { MongoServerError, type Collection, type Document } from "mongodb";

export async function existingMongoIndexes<T extends Document>(collection: Collection<T>) {
  try {
    return await collection.indexes();
  } catch (error) {
    // MongoDB does not create a collection until its first write or index.
    if (error instanceof MongoServerError && error.code === 26) {
      return [];
    }
    throw error;
  }
}
