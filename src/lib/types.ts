export type PiuCatalogVersion = "phoenix" | "phoenix2";

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
  chartSummary: string[];
  folder: string | null;
  series: string | null;
  tags: string[];
}

export interface SongSearchResult {
  songs: PublicSong[];
  nextCursor: string | null;
}
