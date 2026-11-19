import { createHash } from "node:crypto";
import { isPiuSeriesId } from "./catalog-version.ts";
import { buildPublicCatalogSnapshot, PUBLIC_CATALOG_PROJECTION } from "./public-catalog-core.ts";
import type { PublicCatalogDocument } from "./public-catalog-core.ts";
import type { PublicCatalogOptions, PublicCatalogSnapshot } from "./public-catalog-types.ts";
import type { PiuSeriesId } from "./types.ts";

export const PUBLIC_CATALOG_TTL_MS = 30_000;

export class PublicCatalogUnavailableError extends Error {
  readonly code = "PUBLIC_CATALOG_UNAVAILABLE";
  constructor() { super("The public catalog is temporarily unavailable."); this.name = "PublicCatalogUnavailableError"; }
}

export interface PublicCatalogResponse {
  snapshot: PublicCatalogSnapshot;
  body: string;
  etag: string;
}

export interface PublicCatalogCollection {
  find(filter: Record<string, string>, options: { projection: typeof PUBLIC_CATALOG_PROJECTION }): {
    toArray(): Promise<PublicCatalogDocument[]>;
  };
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Dependency injection keeps database, clock and concurrency tests offline. */
export function createPublicCatalogStore(getCollection: () => Promise<PublicCatalogCollection>, now: () => number = Date.now) {
  let generation = 0;
  const entries = new Map<string, { generation: number; expires: number; result?: PublicCatalogResponse; pending: Promise<PublicCatalogResponse> }>();

  async function getResponse(version: PiuSeriesId, options: PublicCatalogOptions = {}): Promise<PublicCatalogResponse> {
    if (!isPiuSeriesId(version)) throw new RangeError("Unsupported public catalog version.");
    const removed = options.removed === true;
    const key = `${version}:${removed ? "removed" : "supported"}`;
    for (;;) {
      const currentGeneration = generation;
      let entry = entries.get(key);
      if (!entry || (entry.result && entry.expires <= now())) {
        const started = now();
        const pending = (async () => {
          try {
            const collection = await getCollection();
            const documents = await collection.find({ [removed ? "removedFromVersions" : "supportedVersions"]: version }, { projection: PUBLIC_CATALOG_PROJECTION }).toArray();
            const snapshot = freeze(buildPublicCatalogSnapshot(documents, version, { removed }));
            const body = JSON.stringify(snapshot);
            return freeze({ snapshot, body, etag: `"${createHash("sha256").update(body).digest("hex")}"` });
          } catch {
            throw new PublicCatalogUnavailableError();
          }
        })();
        entry = { generation: currentGeneration, expires: started + PUBLIC_CATALOG_TTL_MS, pending };
        entries.set(key, entry);
      }
      try {
        const result = entry.result ?? await entry.pending;
        // A write may finish while an old Mongo read is pending. Neither the
        // shared cache nor that read's callers may observe the old generation.
        if (generation !== entry.generation) continue;
        entry.result = result;
        return result;
      } catch (error) {
        if (entries.get(key) === entry) entries.delete(key);
        if (generation !== entry.generation) continue;
        throw error;
      }
    }
  }

  return {
    getResponse,
    async getSnapshot(version: PiuSeriesId, options: PublicCatalogOptions = {}): Promise<PublicCatalogSnapshot> {
      return (await getResponse(version, options)).snapshot;
    },
    invalidate() { generation += 1; entries.clear(); },
  };
}
