export type PiuCatalogVersion = "phoenix" | "phoenix2";
export type PiuSeriesId = "phoenix2" | "phoenix" | "xx" | "prime2" | "prime" | "fiesta" | "nx" | "zero-1st";
export type LevelFilterMode = "or" | "and";
export type SongSortOption = "series" | "title" | "artist" | "folder";
export type SortDirection = "asc" | "desc";

export interface PublicChart {
  mode: string;
  level: string;
  token: string;
}

export interface SongCatalogHistoryEvent {
  date: string;
  type: "added" | "removed" | "changed";
  version: PiuSeriesId;
  note: string;
}

export interface ChartVersionLink {
  id: string;
  tokens: Partial<Record<PiuSeriesId, string>>;
}

export interface ChartCatalogHistoryEvent {
  id: string;
  date: string;
  type: "added" | "removed" | "changed";
  version: PiuSeriesId;
  chartId: string;
  chartToken: string;
  previousChartToken?: string;
  note: string;
}

export interface PublicSong {
  slug: string;
  title: string;
  artist: string;
  version: PiuCatalogVersion;
  supportedVersions: PiuSeriesId[];
  removedFromVersions: PiuSeriesId[];
  history: SongCatalogHistoryEvent[];
  chartHistory: ChartCatalogHistoryEvent[];
  chartLinks: ChartVersionLink[];
  imageUrl: string | null;
  previewUrl: string | null;
  previewAvailable: boolean;
  audioPath: string | null;
  bpm: string | null;
  chartSummary: string[];
  chartTokensByVersion?: Partial<Record<PiuSeriesId, string[]>>;
  folder: string | null;
  folderPosition: number | null;
  folderSongCount: number | null;
  series: string | null;
  seriesSongCount: number | null;
  tags: string[];
  isPremium: boolean;
  isFavorite?: boolean;
  recommendedChartToken?: string | null;
  recentPlay?: {
    chartToken: string;
    score: number | null;
    grade: string | null;
  };
  recommendation?: {
    chartToken: string;
  };
}

export interface CatalogEditorPayload {
  title: string;
  artist: string;
  folder: string;
  folderPosition: number | null;
  series: string;
  tags: string[];
  chartTokens: string[];
  history: SongCatalogHistoryEvent[];
  chartHistory: ChartCatalogHistoryEvent[];
  chartLinks: ChartVersionLink[];
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
