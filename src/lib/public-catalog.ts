import "server-only";

import { getMongoClient, hasMongoConfig } from "@/lib/mongodb";
import { createPublicCatalogStore, PublicCatalogUnavailableError } from "./public-catalog-cache.ts";

export { PublicCatalogUnavailableError } from "./public-catalog-cache.ts";
export type { PublicCatalogSong, PublicCatalogSnapshot } from "./public-catalog-types.ts";

// Next can load SSR and route modules separately. Share one process-local store
// so both entry points see the same generation after an administrator's write.
const processState = globalThis as typeof globalThis & {
  __piugamePublicCatalogV1?: ReturnType<typeof createPublicCatalogStore>;
};
const store = processState.__piugamePublicCatalogV1 ??= createPublicCatalogStore(async () => {
  if (!hasMongoConfig()) throw new PublicCatalogUnavailableError();
  const client = await getMongoClient();
  return client.db(process.env.SONG_CATALOG_DB ?? "piugame_sdk").collection(process.env.CATALOG_COLLECTION ?? "catalog");
});

export const getPublicCatalogSnapshot = store.getSnapshot;
export const getPublicCatalogResponse = store.getResponse;
export const invalidatePublicCatalog = store.invalidate;
