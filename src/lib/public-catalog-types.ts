import type { CatalogFilterOptions, PiuSeriesId, PublicSong } from "./types.ts";

// An explicit allowlist: additions to PublicSong must not silently become public.
export type PublicCatalogSong = Pick<PublicSong,
  | "slug" | "title" | "artist" | "version" | "supportedVersions" | "removedFromVersions"
  | "history" | "chartHistory" | "chartLinks" | "imageUrl" | "previewUrl" | "previewAvailable"
  | "bpm" | "chartSummary" | "chartTokensByVersion" | "folder" | "folderPosition"
  | "folderSongCount" | "series" | "seriesSongCount" | "tags" | "isPremium"
> & { songKey: string };

export interface PublicCatalogSnapshot {
  schemaVersion: 1;
  selectedVersion: PiuSeriesId;
  view: "supported" | "removed";
  total: number;
  filterOptions: CatalogFilterOptions;
  songs: PublicCatalogSong[];
}

export interface PublicCatalogOptions {
  removed?: boolean;
}
