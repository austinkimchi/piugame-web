import "server-only";

import { MongoClient } from "mongodb";

declare global {
  var piuMongoClientPromise: Promise<MongoClient> | undefined;
}

const uri = process.env.MONGODB_URI;

export function hasMongoConfig(): boolean {
  return Boolean(uri);
}

export async function getMongoClient(): Promise<MongoClient> {
  if (!uri) {
    throw new Error("Missing MONGODB_URI");
  }

  if (!globalThis.piuMongoClientPromise) {
    globalThis.piuMongoClientPromise = new MongoClient(uri).connect();
  }

  return globalThis.piuMongoClientPromise;
}
