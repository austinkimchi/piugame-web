export type PiuCatalogVersion = "phoenix" | "phoenix2";
export type LevelFilterMode = "or" | "and";
export type SongSortOption = "series" | "title" | "artist" | "folder";
export type SortDirection = "asc" | "desc";

export interface PublicChart {
  mode: string;
  level: string;
  token: string;
}

export interface PublicSong {
  slug: string;
  title: string;
  artist: string;
  version: PiuCatalogVersion;
  imageUrl: string | null;
  previewUrl: string | null;
  previewAvailable: boolean;
  bpm: string | null;
  chartSummary: string[];
  folder: string | null;
  folderPosition: number | null;
  folderSongCount: number | null;
  series: string | null;
  seriesSongCount: number | null;
  tags: string[];
  isFavorite?: boolean;
}

export interface CatalogEditorPayload {
  title: string;
  artist: string;
  folder: string;
  folderPosition: number | null;
  series: string;
  tags: string[];
  chartTokens: string[];
}

export interface CatalogFilterOptions {
  folders: string[];
  series: string[];
  levels: string[];
  charts: string[];
}

export interface SongSearchResult {
  songs: PublicSong[];
  nextCursor: string | null;
  total: number;
  filterOptions: CatalogFilterOptions;
}
