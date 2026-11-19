import "server-only";

import { searchSongs } from "@/lib/catalog";
import { hasMongoConfig } from "@/lib/mongodb";
import { getPublicCatalogSnapshot } from "@/lib/public-catalog";
import type { CatalogFilterOptions, PiuSeriesId, PublicSong } from "@/lib/types";

interface CatalogPageData {
  songs: Array<PublicSong & { songKey?: string }>;
  filterOptions: CatalogFilterOptions;
  localPreview: boolean;
}

/** The filesystem demo is page-only and is never a complete public snapshot. */
export async function getCatalogPage(version: PiuSeriesId, options: { removed?: boolean } = {}): Promise<CatalogPageData> {
  if (!hasMongoConfig()) {
    const fallback = await searchSongs({ query: "", limit: 48, supportedVersion: version, removedFromVersion: options.removed ? version : undefined });
    return { songs: fallback.songs, filterOptions: fallback.filterOptions, localPreview: true };
  }
  const snapshot = await getPublicCatalogSnapshot(version, options);
  return { songs: snapshot.songs.map((song) => ({ ...song, audioPath: null })), filterOptions: snapshot.filterOptions, localPreview: false };
}
