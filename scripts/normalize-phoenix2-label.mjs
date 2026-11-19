import nextEnv from "@next/env";
import { MongoClient } from "mongodb";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const write = process.argv.includes("--write");
const uri = process.env.MONGODB_URI;
if (!uri) {
  throw new Error("Missing MONGODB_URI");
}

const databaseName = process.env.SONG_CATALOG_DB ?? "piugame_sdk";
const collectionName = process.env.CATALOG_COLLECTION ?? "catalog";
const legacyLabel = /^\s*phoenix\s*2\s*$/i;
const client = new MongoClient(uri);

try {
  await client.connect();
  const collection = client.db(databaseName).collection(collectionName);
  const candidates = await collection.countDocuments({
    series: { $regex: legacyLabel },
    $expr: { $ne: ["$series", "PHOENIX 2"] },
  });

  if (!write) {
    console.log(`Dry run: ${candidates} catalog document(s) would be updated to PHOENIX 2.`);
    console.log("Run npm run migrate:catalog:phoenix2-label:write to apply the change.");
  } else {
    const result = await collection.updateMany(
      { series: { $regex: legacyLabel } },
      { $set: { series: "PHOENIX 2" } },
    );
    console.log(`Updated ${result.modifiedCount} of ${result.matchedCount} matching catalog document(s).`);
  }
} finally {
  await client.close();
}
