import assert from "node:assert/strict";
import test from "node:test";
import { MongoServerError, type Collection, type Document, type IndexDescriptionInfo } from "mongodb";

import { existingMongoIndexes } from "../src/lib/mongo-indexes.ts";

function collectionWithIndexes(indexes: () => Promise<IndexDescriptionInfo[]>): Collection<Document> {
  return { indexes } as Collection<Document>;
}

test("existing indexes are preserved for legacy index cleanup", async () => {
  const existing = [{ name: "legacy_user_1", key: { userId: 1 } }];
  assert.deepEqual(await existingMongoIndexes(collectionWithIndexes(async () => existing)), existing);
});

test("a fresh MongoDB collection has no legacy indexes", async () => {
  const missing = new MongoServerError({ ok: 0, code: 26, errmsg: "ns not found" });
  assert.deepEqual(await existingMongoIndexes(collectionWithIndexes(async () => { throw missing; })), []);
});

test("other MongoDB failures remain visible", async () => {
  const unavailable = new MongoServerError({ ok: 0, code: 13, errmsg: "unauthorized" });
  await assert.rejects(existingMongoIndexes(collectionWithIndexes(async () => { throw unavailable; })), unavailable);
  const lookalike = Object.assign(new Error("not a MongoDB server response"), { code: 26 });
  await assert.rejects(existingMongoIndexes(collectionWithIndexes(async () => { throw lookalike; })), lookalike);
});
