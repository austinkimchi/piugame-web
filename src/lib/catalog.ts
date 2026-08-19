import "server-only";

import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Collection, Document, Filter, WithId } from "mongodb";
import { cache } from "react";

import { getMongoClient, hasMongoConfig } from "@/lib/mongodb";
import { DEFAULT_CATALOG_SERIES, isPiuSeriesId, normalizePiuSeriesId, sortPiuSeries } from "@/lib/catalog-version";
import type {
  CatalogFilterOptions,
  CatalogEditorPayload,
  ChartCatalogHistoryEvent,
  ChartVersionLink,
  LevelFilterMode,
  PiuCatalogVersion,
  PiuSeriesId,
  PublicChart,
  PublicSong,
  SongCatalogHistoryEvent,
  SongSearchResult,
  SongSortOption,
  SortDirection,
} from "@/lib/types";

const PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 48;
const LANDING_NEW_SONG_LIMIT = 12;
const DB_NAME = process.env.SONG_CATALOG_DB ?? "piugame_sdk";
const CATALOG_COLLECTION = process.env.CATALOG_COLLECTION ?? "catalog";
const MAIN_CATALOG_VERSION: PiuSeriesId = DEFAULT_CATALOG_SERIES;
const SERIES_ORDER = ["1st", "nx", "fiesta", "prime", "prime2", "xx", "phoenix", "phoenix2"];
const AUDIO_UPLOAD_MAX_BYTES = 16 * 1024 * 1024;
const AUDIO_UPLOAD_CONTENT_TYPES = new Map([
  ["audio/mpeg", ".mp3"],
  ["audio/mp3", ".mp3"],
  ["audio/ogg", ".ogg"],
  ["audio/wav", ".wav"],
  ["audio/x-wav", ".wav"],
  ["audio/mp4", ".m4a"],
  ["audio/x-m4a", ".m4a"],
]);

interface CatalogStats {
  folderCounts: Map<string, number>;
  seriesCounts: Map<string, number>;
  totalSongs: number;
}

interface CountGroup {
  _id: string | null;
  count: number;
}

interface CatalogDocument extends Document {
  songName?: string;
  songKey?: string;
  artist?: string;
  piuVersion?: string;
  catalogVersion?: string;
  supportedVersions?: string[];
  removedFromVersions?: string[];
  history?: SongCatalogHistoryEvent[];
  chartHistory?: ChartCatalogHistoryEvent[];
  chartLinks?: ChartVersionLink[];
  images?: string[];
  previewUrl?: string | null;
  audioPreviewUrl?: string | null;
  audioPath?: string | null;
  audioPreview?: {
    url?: string | null;
    localPath?: string | null;
    source?: string | null;
    confidence?: number | null;
    reviewRequired?: boolean | null;
    matchedAt?: string | Date | null;
  } | null;
  bpm?: string | number | null;
  bpmRaw?: string | number | null;
  chartsFull?: PublicChart[];
  chartTokens?: string[];
  chartTokensByVersion?: Partial<Record<PiuSeriesId, string[]>>;
  folder?: string;
  series?: string;
  tags?: string[];
  folderPosition?: number | null;
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | null): number {
  if (!cursor) {
    return 0;
  }

  const decoded = Number.parseInt(Buffer.from(cursor, "base64url").toString("utf8"), 10);
  return Number.isFinite(decoded) && decoded >= 0 ? decoded : 0;
}

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cleanList(values?: string[]): string[] {
  return Array.from(new Set((values ?? []).map(cleanText).filter(Boolean)));
}

function statsKey(value: string | null): string {
  return cleanText(value).toLowerCase();
}

function titleLookupKey(value: string): string {
  return cleanText(value).toLowerCase();
}

function normalizedSeries(value: string | null): string {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function seriesSortValue(value: string | null): number {
  const index = SERIES_ORDER.indexOf(normalizedSeries(value));
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function compareSeries(left: string | null, right: string | null): number {
  return seriesSortValue(left) - seriesSortValue(right) || compareNullableText(left, right);
}

function compareSeriesForDirection(left: string | null, right: string | null, sortDirection: SortDirection): number {
  const leftRank = seriesSortValue(left);
  const rightRank = seriesSortValue(right);
  const leftKnown = leftRank !== Number.MAX_SAFE_INTEGER;
  const rightKnown = rightRank !== Number.MAX_SAFE_INTEGER;

  if (leftKnown && !rightKnown) {
    return -1;
  }
  if (!leftKnown && rightKnown) {
    return 1;
  }

  return (leftRank - rightRank) * (sortDirection === "asc" ? 1 : -1) || compareNullableText(left, right);
}

function normalizeSortOption(value?: string | null): SongSortOption {
  return value === "title" || value === "artist" || value === "folder" ? value : "series";
}

function normalizeSortDirection(value?: string | null): SortDirection {
  return value === "asc" ? "asc" : "desc";
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function levelSortValue(value: string): number {
  const level = Number.parseInt(value.replace(/\D/g, ""), 10);
  return Number.isFinite(level) ? level : Number.MAX_SAFE_INTEGER;
}

function isCoOpToken(token: string): boolean {
  return /^C(?:O-?OP|[2-5])?$/i.test(cleanText(token));
}

function coOpPlayerCountFromToken(token: string): string | null {
  const match = cleanText(token).match(/^C([2-5])$/i);
  return match ? match[1] : null;
}

function normalizeChartToken(token: unknown): string {
  const normalized = cleanText(token).toUpperCase().replace(/\s+/g, "");
  return normalized.replace(/^CX([2-5])$/, "C$1");
}

function chartTokenSearchRegex(query: string): RegExp {
  const normalized = normalizeChartToken(query);
  const coOpMatch = normalized.match(/^C([2-5])$/);
  if (coOpMatch) {
    return new RegExp(`^C(?:X)?${coOpMatch[1]}$`, "i");
  }

  return new RegExp(escapeRegex(query), "i");
}

function levelFromChartToken(token: string): string | null {
  if (isCoOpToken(token)) {
    return null;
  }

  const match = token.match(/(\d{1,2})$/);
  if (!match) {
    return token ? "+" : null;
  }

  const level = Number.parseInt(match[1], 10);
  return Number.isFinite(level) && level >= 1 && level <= 27 ? String(level) : "+";
}

function chartTypeFromToken(token: string): string | null {
  const normalized = token.toUpperCase();
  if (normalized.startsWith("CO") || normalized.startsWith("C")) {
    return "co-op";
  }
  if (normalized.startsWith("D")) {
    return "doubles";
  }
  if (normalized.startsWith("S")) {
    return "singles";
  }
  return null;
}

function chartModeFromToken(token: string): string {
  return chartTypeFromToken(token) ?? "unknown";
}

function chartRegexFor(chart: string): RegExp | null {
  if (chart === "singles") {
    return /^S/i;
  }
  if (chart === "doubles") {
    return /^D/i;
  }
  if (chart === "co-op") {
    return /^C/i;
  }
  return null;
}

function chartPrefixFor(chart: string): string | null {
  if (chart === "singles") {
    return "S";
  }
  if (chart === "doubles") {
    return "D";
  }
  if (chart === "co-op") {
    return "C";
  }
  return null;
}

function compatibleLevelsFromTokens(tokens: string[], charts?: string[]): string[] {
  const selectedCharts = cleanList(charts);
  if (selectedCharts.length === 1 && selectedCharts.includes("co-op")) {
    return sortLevels(cleanList(tokens.map((token) => coOpPlayerCountFromToken(token) ?? "")));
  }

  return sortLevels(cleanList(tokens.map((token) => levelFromChartToken(token) ?? "")));
}

function filterOptionsFromValues(values: {
  folders: string[];
  series: string[];
  chartTokens: string[];
  charts?: string[];
}): CatalogFilterOptions {
  const tokens = cleanList(values.chartTokens.map(cleanText));

  return {
    folders: cleanList(values.folders.map(cleanText)).sort(),
    series: sortSeries(cleanList(values.series.map(cleanText))),
    levels: compatibleLevelsFromTokens(tokens, values.charts),
    charts: sortCharts(cleanList(tokens.map((token) => chartTypeFromToken(token) ?? ""))),
  };
}

function levelRegexesFor(level: string, charts: string[]): RegExp[] {
  const selectedCharts = cleanList(charts);
  if (selectedCharts.length > 0) {
    return selectedCharts.flatMap((chart) => levelRegexesForChart(level, chart));
  }

  return levelRegexesForChart(level, null);
}

function levelRegexesForChart(level: string, chart: string | null): RegExp[] {
  const regexes: RegExp[] = [];

  if (chart === "co-op") {
    if (/^[2-5]$/.test(level)) {
      regexes.push(new RegExp(`^C(?:X)?${escapeRegex(level)}$`, "i"));
    }
    return regexes;
  }

  const prefix = chartPrefixFor(chart ?? "");
  if (prefix) {
    if (level === "+") {
      regexes.push(new RegExp(`^${prefix}(?!(?:[1-9]|1\\d|2[0-7])$).+$`, "i"));
    } else {
      regexes.push(new RegExp(`^${prefix}${escapeRegex(level)}$`, "i"));
    }
    return regexes;
  }

  if (/^[2-5]$/.test(level)) {
    regexes.push(new RegExp(`^C${escapeRegex(level)}$`, "i"));
  }

  if (level === "+") {
    regexes.push(new RegExp("^(?!C(?:O-?OP|[2-5])?$)\\D+(?!(?:[1-9]|1\\d|2[0-7])$).+$", "i"));
  } else {
    regexes.push(new RegExp(`\\D${escapeRegex(level)}$`, "i"));
  }

  return regexes;
}

function levelChartClausesForAnd(levels: string[], charts: string[], chartTokenField = "chartTokens"): Filter<CatalogDocument>[] {
  if (charts.length === 0) {
    return levels.map((level) => ({ [chartTokenField]: { $in: levelRegexesFor(level, []) } }));
  }

  return charts.flatMap((chart) =>
    levels.map((level) => ({ [chartTokenField]: { $in: levelRegexesForChart(level, chart) } })),
  );
}

function tokenMatchesLevelAndChart(token: string, level: string, charts: string[]): boolean {
  if (charts.length > 0) {
    return charts.some((chart) => tokenMatchesLevelForChart(token, level, chart));
  }

  return tokenMatchesLevelForChart(token, level, null);
}

function tokenMatchesLevelForChart(token: string, level: string, chart: string | null): boolean {
  if (chart === "co-op") {
    return level === coOpPlayerCountFromToken(token);
  }

  if (chart && chart !== chartTypeFromToken(token)) {
    return false;
  }

  return level === levelFromChartToken(token);
}

function songMatchesLevelFilters(song: PublicSong, levels: string[], charts: string[], levelMode: LevelFilterMode | undefined): boolean {
  if (levels.length === 0) {
    return true;
  }

  if (levelMode === "and") {
    if (charts.length > 0) {
      return charts.every((chart) =>
        levels.every((level) => song.chartSummary.some((token) => tokenMatchesLevelForChart(token, level, chart))),
      );
    }

    return levels.every((level) => song.chartSummary.some((token) => tokenMatchesLevelAndChart(token, level, charts)));
  }

  return levels.some((level) => song.chartSummary.some((token) => tokenMatchesLevelAndChart(token, level, charts)));
}

function sortLevels(levels: string[]): string[] {
  return levels.sort((left, right) => {
    if (left === "+") {
      return 1;
    }
    if (right === "+") {
      return -1;
    }
    return levelSortValue(left) - levelSortValue(right);
  });
}

function sortCharts(charts: string[]): string[] {
  const order = ["singles", "doubles", "co-op"];
  return charts.sort((left, right) => order.indexOf(left) - order.indexOf(right));
}

function sortSeries(series: string[]): string[] {
  return series.sort(compareSeries);
}

function versionFromDocument(document: CatalogDocument, fallback: PiuCatalogVersion): PiuCatalogVersion {
  const raw = cleanText(document.piuVersion ?? document.catalogVersion);
  return raw === "phoenix2" ? "phoenix2" : fallback;
}

function piuCatalogVersionFromSeries(version: PiuSeriesId): PiuCatalogVersion {
  return version === "phoenix" ? "phoenix" : "phoenix2";
}

function catalogVersionsFromDocument(document: CatalogDocument, fallback: PiuSeriesId = MAIN_CATALOG_VERSION): PiuSeriesId[] {
  const values = Array.isArray(document.supportedVersions) ? document.supportedVersions : [];
  const normalized = values.map((value) => normalizePiuSeriesId(value, fallback)).filter(isPiuSeriesId);
  if (normalized.length > 0) {
    return sortPiuSeries(Array.from(new Set(normalized)));
  }

  const rawVersion = cleanText(document.piuVersion ?? document.catalogVersion);
  return [rawVersion === "phoenix" ? "phoenix" : fallback];
}

function removedVersionsFromDocument(document: CatalogDocument): PiuSeriesId[] {
  const values = Array.isArray(document.removedFromVersions) ? document.removedFromVersions : [];
  return sortPiuSeries(Array.from(new Set(values.filter(isPiuSeriesId))));
}

function historyFromDocument(document: CatalogDocument): SongCatalogHistoryEvent[] {
  if (!Array.isArray(document.history)) {
    return [];
  }

  return document.history
    .filter((event): event is SongCatalogHistoryEvent =>
      Boolean(event && typeof event.date === "string" && typeof event.note === "string" && isPiuSeriesId(event.version)),
    )
    .slice(0, 40);
}

function chartLinksFromDocument(document: CatalogDocument): ChartVersionLink[] {
  if (!Array.isArray(document.chartLinks)) {
    return [];
  }

  return document.chartLinks
    .filter((link): link is ChartVersionLink => Boolean(link && typeof link.id === "string" && link.tokens && typeof link.tokens === "object"))
    .map((link) => ({
      id: cleanText(link.id).slice(0, 80),
      tokens: Object.fromEntries(
        Object.entries(link.tokens)
          .filter(([version, token]) => isPiuSeriesId(version) && Boolean(normalizeChartToken(token)))
          .map(([version, token]) => [version, normalizeChartToken(token)]),
      ) as Partial<Record<PiuSeriesId, string>>,
    }))
    .filter((link) => link.id && Object.keys(link.tokens).length > 0);
}

function chartHistoryFromDocument(document: CatalogDocument): ChartCatalogHistoryEvent[] {
  if (!Array.isArray(document.chartHistory)) {
    return [];
  }

  return document.chartHistory
    .filter((event): event is ChartCatalogHistoryEvent =>
      Boolean(event && typeof event.id === "string" && typeof event.date === "string" && typeof event.note === "string" && typeof event.chartId === "string" && typeof event.chartToken === "string" && isPiuSeriesId(event.version)),
    )
    .slice(0, 160);
}

function imageVersionFor(document: CatalogDocument, fallback: PiuCatalogVersion): PiuCatalogVersion {
  const raw = cleanText(document.piuVersion ?? document.catalogVersion);
  if (raw === "phoenix" || raw === "phoenix2") {
    return raw;
  }

  const supportedVersions = catalogVersionsFromDocument(document);
  return supportedVersions.includes("phoenix2") ? "phoenix2" : fallback;
}

function imageUrlFor(version: PiuCatalogVersion, filename: string | null): string | null {
  if (!filename) {
    return null;
  }

  const safeFilename = path.basename(filename);
  const imageDir = version === "phoenix2" ? "song_img2" : "song_img";
  return `/assets/piu/${version}/${imageDir}/${safeFilename}`;
}

function chartSummary(document: CatalogDocument, version?: PiuSeriesId): string[] {
  const versionedTokens = version ? document.chartTokensByVersion?.[version] : undefined;
  if (Array.isArray(versionedTokens) && versionedTokens.length > 0) {
    return versionedTokens.map(normalizeChartToken).filter(Boolean);
  }

  if (Array.isArray(document.chartTokens) && document.chartTokens.length > 0) {
    return document.chartTokens.map(normalizeChartToken).filter(Boolean);
  }

  if (Array.isArray(document.chartsFull)) {
    return document.chartsFull
      .map((chart) => normalizeChartToken(chart.token || `${chart.mode}${chart.level}`))
      .filter(Boolean);
  }

  return [];
}

function chartLevelForEditor(token: string): string {
  return levelFromChartToken(token) ?? coOpPlayerCountFromToken(token) ?? "";
}

function numericPosition(value: unknown): number | null {
  const position = Number(value);
  return Number.isInteger(position) && position > 0 ? position : null;
}

function editableFolderPosition(value: unknown): number | null {
  if (value === null || value === undefined || cleanText(value) === "") {
    return null;
  }

  const position = Number(value);
  if (!Number.isInteger(position) || position < 1) {
    throw new Error("Folder position must be a positive whole number.");
  }

  return position;
}

function bpmFromDocument(document: CatalogDocument): string | null {
  return cleanText(document.bpm ?? document.bpmRaw) || null;
}

function audioFileUrlForPath(localPath: string): string | null {
  const cleanPath = cleanText(localPath).replaceAll("\\", "/");
  if (!cleanPath) {
    return null;
  }

  const params = new URLSearchParams({ path: cleanPath });
  return `/api/audio-file?${params.toString()}`;
}

function audioUploadExtension(file: File): string {
  const extension = path.extname(file.name).toLowerCase();
  if (Array.from(AUDIO_UPLOAD_CONTENT_TYPES.values()).includes(extension)) {
    return extension;
  }

  const contentTypeExtension = AUDIO_UPLOAD_CONTENT_TYPES.get(file.type.toLowerCase());
  if (contentTypeExtension) {
    return contentTypeExtension;
  }

  throw new Error("Audio upload must be an MP3, OGG, WAV, or M4A file.");
}

function audioFilenameForSong(title: string, artist: string, extension: string): string {
  return `${slugify(title) || "untitled"}-${slugify(artist) || "unknown"}${extension}`;
}

async function saveCatalogAudioUpload(version: PiuCatalogVersion, title: string, artist: string, file: File): Promise<{ audioPath: string; publicUrl: string }> {
  if (file.size < 1) {
    throw new Error("Audio upload is empty.");
  }
  if (file.size > AUDIO_UPLOAD_MAX_BYTES) {
    throw new Error("Audio upload must be 16 MB or smaller.");
  }

  const extension = audioUploadExtension(file);
  const filename = audioFilenameForSong(title, artist, extension);
  const uploadDir = path.join(process.cwd(), "public", "assets", "piu", version, "audio_previews", "manual");
  await mkdir(uploadDir, { recursive: true });
  await writeFile(path.join(uploadDir, filename), Buffer.from(await file.arrayBuffer()));

  const audioPath = `manual/${filename}`;
  return {
    audioPath,
    publicUrl: `/api/audio-file?${new URLSearchParams({ path: audioPath }).toString()}`,
  };
}

function previewUrlFromDocument(document: CatalogDocument): string | null {
  const localUrl = audioFileUrlForPath(document.audioPath ?? document.audioPreview?.localPath ?? "");
  if (localUrl) {
    return localUrl;
  }

  const url = cleanText(document.audioPreview?.url ?? document.previewUrl ?? document.audioPreviewUrl);
  if (!url) {
    return null;
  }

  if (url.startsWith("/") || url.startsWith("https://") || url.startsWith("http://")) {
    return url;
  }

  return null;
}

function publicSongFromDocument(document: WithId<CatalogDocument>, fallbackVersion: PiuCatalogVersion, stats?: CatalogStats, chartVersion?: PiuSeriesId): PublicSong {
  const title = cleanText(document.songName ?? document.songKey ?? "Untitled Song");
  const artist = cleanText(document.artist ?? "Unknown Artist");
  const version = versionFromDocument(document, fallbackVersion);
  const imageVersion = imageVersionFor(document, version);
  const supportedVersions = catalogVersionsFromDocument(document, MAIN_CATALOG_VERSION);
  const image = Array.isArray(document.images) ? cleanText(document.images[0]) : "";
  const previewUrl = previewUrlFromDocument(document);
  const audioPath = cleanText(document.audioPath ?? document.audioPreview?.localPath) || null;
  const folder = cleanText(document.folder) || null;
  const series = cleanText(document.series) || null;

  return {
    slug: `${slugify(title)}-${slugify(artist) || "unknown"}-${version}`,
    title,
    artist,
    version,
    supportedVersions,
    removedFromVersions: removedVersionsFromDocument(document),
    history: historyFromDocument(document),
    chartHistory: chartHistoryFromDocument(document),
    chartLinks: chartLinksFromDocument(document),
    imageUrl: imageUrlFor(imageVersion, image || null),
    previewUrl,
    previewAvailable: Boolean(previewUrl),
    audioPath,
    bpm: bpmFromDocument(document),
    chartSummary: chartSummary(document, chartVersion),
    chartTokensByVersion: document.chartTokensByVersion,
    folder,
    folderPosition: numericPosition(document.folderPosition),
    folderSongCount: folder && stats ? stats.folderCounts.get(statsKey(folder)) ?? null : null,
    series,
    seriesSongCount: series && stats ? stats.seriesCounts.get(statsKey(series)) ?? null : null,
    tags: Array.isArray(document.tags) ? document.tags.map(cleanText).filter(Boolean).slice(0, 12) : [],
  };
}

function catalogEditorPayloadFromSong(song: PublicSong): CatalogEditorPayload {
  return {
    title: song.title,
    artist: song.artist,
    folder: song.folder ?? "",
    folderPosition: song.folderPosition,
    series: song.series ?? "",
    tags: song.tags,
    chartTokens: song.chartSummary,
    history: song.history,
    chartHistory: song.chartHistory,
    chartLinks: song.chartLinks,
  };
}

function projection() {
  return {
    songName: 1,
    songKey: 1,
    artist: 1,
    piuVersion: 1,
    catalogVersion: 1,
    supportedVersions: 1,
    removedFromVersions: 1,
    history: { $slice: 40 },
    chartHistory: { $slice: 160 },
    chartLinks: 1,
    images: { $slice: 1 },
    previewUrl: 1,
    audioPreviewUrl: 1,
    audioPath: 1,
    audioPreview: 1,
    bpm: 1,
    bpmRaw: 1,
    chartTokens: 1,
    chartTokensByVersion: 1,
    chartsFull: 1,
    folder: 1,
    series: 1,
    tags: { $slice: 12 },
    folderPosition: 1,
  };
}

async function collectionFor(_version?: PiuSeriesId | PiuCatalogVersion): Promise<Collection<CatalogDocument>> {
  void _version;
  const client = await getMongoClient();
  return client.db(DB_NAME).collection<CatalogDocument>(CATALOG_COLLECTION);
}

function countMap(groups: CountGroup[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const group of groups) {
    const key = statsKey(group._id);
    if (key) {
      counts.set(key, group.count);
    }
  }
  return counts;
}

async function fallbackCatalogStats(version: PiuSeriesId): Promise<CatalogStats> {
  const songs = await fallbackSongs(version, 0, Number.MAX_SAFE_INTEGER);

  return {
    folderCounts: countValues(songs.map((song) => song.folder)),
    seriesCounts: countValues(songs.map((song) => song.series)),
    totalSongs: songs.length,
  };
}

function countValues(values: Array<string | null>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = statsKey(value);
    if (key) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

function versionSupportFilter(version: PiuSeriesId, removedFromVersion?: PiuSeriesId): Filter<CatalogDocument> {
  if (removedFromVersion) {
    return { removedFromVersions: removedFromVersion };
  }

  return { supportedVersions: version };
}

export const getCatalogStats = cache(async (version: PiuSeriesId = MAIN_CATALOG_VERSION, removedFromVersion?: PiuSeriesId): Promise<CatalogStats> => {
  if (!hasMongoConfig()) {
    return fallbackCatalogStats(version);
  }

  const collection = await collectionFor(version);
  const [result] = await collection
    .aggregate<{
      folders: CountGroup[];
      series: CountGroup[];
      total: Array<{ count: number }>;
    }>([
      { $match: versionSupportFilter(version, removedFromVersion) },
      {
        $facet: {
          folders: [
            {
              $group: {
                _id: {
                  $trim: {
                    input: { $ifNull: ["$folder", ""] },
                  },
                },
                count: { $sum: 1 },
              },
            },
          ],
          series: [
            {
              $group: {
                _id: {
                  $trim: {
                    input: { $ifNull: ["$series", ""] },
                  },
                },
                count: { $sum: 1 },
              },
            },
          ],
          total: [{ $count: "count" }],
        },
      },
    ])
    .toArray();

  return {
    folderCounts: countMap(result?.folders ?? []),
    seriesCounts: countMap(result?.series ?? []),
    totalSongs: result?.total[0]?.count ?? 0,
  };
});

function seriesOrderExpression(sortDirection: SortDirection) {
  return {
    $switch: {
      branches: SERIES_ORDER.map((series, index) => ({
        case: {
          $eq: [
            {
              $replaceAll: {
                input: { $toLower: { $ifNull: ["$series", ""] } },
                find: " ",
                replacement: "",
              },
            },
            series,
          ],
        },
        then: index,
      })),
      default: sortDirection === "asc" ? Number.MAX_SAFE_INTEGER : -1,
    },
  };
}

function aggregateProjection() {
  return {
    songName: 1,
    songKey: 1,
    artist: 1,
    piuVersion: 1,
    catalogVersion: 1,
    supportedVersions: 1,
    removedFromVersions: 1,
    history: { $slice: ["$history", 40] },
    chartHistory: { $slice: ["$chartHistory", 160] },
    chartLinks: 1,
    images: { $slice: ["$images", 1] },
    previewUrl: 1,
    audioPreviewUrl: 1,
    audioPath: 1,
    audioPreview: 1,
    bpm: 1,
    bpmRaw: 1,
    chartTokens: 1,
    chartTokensByVersion: 1,
    chartsFull: 1,
    folder: 1,
    series: 1,
    tags: { $slice: ["$tags", 12] },
    folderPosition: 1,
  };
}

function mongoSortFor(sortBy: SongSortOption, sortDirection: SortDirection): Record<string, 1 | -1> {
  const direction = sortDirection === "asc" ? 1 : -1;

  if (sortBy === "title") {
    return { songName: direction, artist: direction, __seriesOrder: direction, series: direction, folderPosition: direction };
  }
  if (sortBy === "artist") {
    return { artist: direction, songName: direction, __seriesOrder: direction, series: direction, folderPosition: direction };
  }
  if (sortBy === "folder") {
    return { folderPosition: direction, folder: direction, __seriesOrder: direction, series: direction, songName: direction, artist: direction };
  }

  return { __seriesOrder: direction, series: direction, folderPosition: direction, songName: direction, artist: direction };
}

function compareNullableText(left: string | null, right: string | null): number {
  if (!left && !right) {
    return 0;
  }
  if (!left) {
    return 1;
  }
  if (!right) {
    return -1;
  }

  return left.localeCompare(right, undefined, { sensitivity: "base", numeric: true });
}

function compareSongText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base", numeric: true });
}

type FavoriteSortCandidate = Pick<PublicSong, "slug" | "title" | "artist" | "folder" | "series">;

function sortFavoriteCandidates<T extends FavoriteSortCandidate>(songs: T[], sortBy: SongSortOption, sortDirection: SortDirection, favoriteSlugs?: Set<string>): T[] {
  const direction = sortDirection === "asc" ? 1 : -1;

  return [...songs].sort((left, right) => {
    if (favoriteSlugs && favoriteSlugs.size > 0) {
      const favoriteComparison = Number(favoriteSlugs.has(right.slug)) - Number(favoriteSlugs.has(left.slug));
      if (favoriteComparison !== 0) {
        return favoriteComparison;
      }
    }

    let comparison: number;
    if (sortBy === "title") {
      comparison = compareSongText(left.title, right.title) || compareSongText(left.artist, right.artist);
    } else if (sortBy === "artist") {
      comparison = compareSongText(left.artist, right.artist) || compareSongText(left.title, right.title);
    } else if (sortBy === "folder") {
      comparison = compareNullableText(left.folder, right.folder) || compareSongText(left.title, right.title);
    } else {
      comparison = compareSeriesForDirection(left.series, right.series, sortDirection) || compareNullableText(left.folder, right.folder) || compareSongText(left.title, right.title);
      return comparison;
    }

    return comparison * direction;
  });
}

function sortFallbackSongs(songs: PublicSong[], sortBy: SongSortOption, sortDirection: SortDirection, favoriteSlugs?: Set<string>): PublicSong[] {
  return sortFavoriteCandidates(songs, sortBy, sortDirection, favoriteSlugs);
}

async function findMongoSongs(
  version: PiuSeriesId,
  filter: Filter<CatalogDocument>,
  offset: number,
  limit: number,
  sortBy: SongSortOption = "series",
  sortDirection: SortDirection = "asc",
): Promise<PublicSong[]> {
  const collection = await collectionFor(version);
  const documents = await collection
    .aggregate<WithId<CatalogDocument>>([
      { $match: filter },
      { $addFields: { __seriesOrder: seriesOrderExpression(sortDirection) } },
      { $sort: mongoSortFor(sortBy, sortDirection) },
      { $skip: offset },
      { $limit: limit },
      { $project: aggregateProjection() },
    ])
    .toArray();

  return documents.map((document) => publicSongFromDocument(document, piuCatalogVersionFromSeries(version), undefined, version));
}

async function findMongoFavoriteSortedSongs(
  version: PiuSeriesId,
  filter: Filter<CatalogDocument>,
  offset: number,
  limit: number,
  sortBy: SongSortOption,
  sortDirection: SortDirection,
  favoriteSlugs: Set<string>,
): Promise<PublicSong[]> {
  const collection = await collectionFor(version);
  const candidates = await collection
    .find(filter)
    .project<WithId<CatalogDocument>>({ songName: 1, songKey: 1, artist: 1, piuVersion: 1, catalogVersion: 1, folder: 1, series: 1 })
    .toArray();
  const fallbackVersion = piuCatalogVersionFromSeries(version);
  const orderedCandidates = sortFavoriteCandidates(
    candidates.map((document) => {
      const title = cleanText(document.songName ?? document.songKey ?? "Untitled Song");
      const artist = cleanText(document.artist ?? "Unknown Artist");
      const songVersion = versionFromDocument(document, fallbackVersion);
      return {
        id: document._id,
        slug: `${slugify(title)}-${slugify(artist) || "unknown"}-${songVersion}`,
        title,
        artist,
        folder: cleanText(document.folder) || null,
        series: cleanText(document.series) || null,
      };
    }),
    sortBy,
    sortDirection,
    favoriteSlugs,
  );
  const page = orderedCandidates.slice(offset, offset + limit);
  if (page.length === 0) {
    return [];
  }

  const documents = await collection.find({ _id: { $in: page.map((candidate) => candidate.id) } }).toArray();
  const songsById = new Map(documents.map((document) => [document._id.toHexString(), publicSongFromDocument(document, fallbackVersion, undefined, version)]));

  return page.flatMap((candidate) => {
    const song = songsById.get(candidate.id.toHexString());
    return song ? [song] : [];
  });
}

async function fallbackSongs(version: PiuSeriesId, offset = 0, limit = PAGE_SIZE): Promise<PublicSong[]> {
  if (version !== "phoenix2" && version !== "phoenix") {
    return [];
  }

  const dir =
    version === "phoenix2"
      ? path.join(process.cwd(), "public", "assets", "piu", "phoenix2", "song_img2")
      : path.join(process.cwd(), "public", "assets", "piu", "phoenix", "song_img");

  try {
    const filenames = (await readdir(dir))
      .filter((filename) => filename.toLowerCase().endsWith(".png"))
      .sort()
      .slice(offset, offset + limit);

    return filenames.map((filename, index) => ({
      slug: `${version}-jacket-${offset + index + 1}`,
      title: `${version === "phoenix2" ? "Phoenix 2" : "Phoenix"} Jacket ${offset + index + 1}`,
      artist: "PIUGAME catalog asset",
      version,
      supportedVersions: [version],
      removedFromVersions: [],
      history: [],
      chartHistory: [],
      chartLinks: [],
      imageUrl: imageUrlFor(version, filename),
      previewUrl: null,
      previewAvailable: false,
      audioPath: null,
      bpm: null,
      chartSummary: [],
      folder: null,
      folderPosition: offset + index + 1,
      folderSongCount: null,
      series: version === "phoenix2" ? "Phoenix 2" : "Phoenix",
      seriesSongCount: null,
      tags: [],
    }));
  } catch {
    return [];
  }
}

export async function getLandingSongs(version: PiuSeriesId = MAIN_CATALOG_VERSION): Promise<PublicSong[]> {
  if (!hasMongoConfig()) {
    return fallbackSongs(version, 0, LANDING_NEW_SONG_LIMIT);
  }

  return findMongoSongs(
    version,
    { supportedVersions: version },
    0,
    LANDING_NEW_SONG_LIMIT,
  );
}

function buildSearchFilter(params: {
  query: string;
  folders?: string[];
  series?: string[];
  levels?: string[];
  charts?: string[];
  levelMode?: LevelFilterMode;
  supportedVersion?: PiuSeriesId;
  removedFromVersion?: PiuSeriesId;
}): Filter<CatalogDocument> {
  const clauses: Filter<CatalogDocument>[] = [];
  const query = cleanText(params.query);
  const chartTokenField = params.supportedVersion ? `chartTokensByVersion.${params.supportedVersion}` : "chartTokens";

  if (query.length > 0) {
    const escaped = escapeRegex(query);
    const chartTokenQuery = chartTokenSearchRegex(query);
    clauses.push({
      $or: [
        { songName: { $regex: escaped, $options: "i" } },
        { songKey: { $regex: escaped, $options: "i" } },
        { artist: { $regex: escaped, $options: "i" } },
        { folder: { $regex: escaped, $options: "i" } },
        { series: { $regex: escaped, $options: "i" } },
        { tags: { $regex: escaped, $options: "i" } },
        { [chartTokenField]: { $regex: chartTokenQuery } },
      ],
    });
  }

  if (params.removedFromVersion) {
    clauses.push({ removedFromVersions: params.removedFromVersion });
  } else {
    clauses.push({ supportedVersions: params.supportedVersion ?? MAIN_CATALOG_VERSION });
  }

  const folders = cleanList(params.folders);
  if (folders.length > 0) {
    clauses.push({ folder: { $in: folders } });
  }

  const series = cleanList(params.series);
  if (series.length > 0) {
    clauses.push({ series: { $in: series } });
  }

  const levels = cleanList(params.levels);
  const charts = cleanList(params.charts);
  if (levels.length > 0) {
    const levelClauses = levelChartClausesForAnd(levels, charts, chartTokenField);
    clauses.push(params.levelMode === "and" ? { $and: levelClauses } : { [chartTokenField]: { $in: levels.flatMap((level) => levelRegexesFor(level, charts)) } });
  }

  if (charts.length > 0 && levels.length === 0) {
    const chartRegexes = charts.map(chartRegexFor).filter((regex): regex is RegExp => Boolean(regex));

    if (chartRegexes.length > 0) {
      clauses.push(params.levelMode === "and" ? { $and: chartRegexes.map((regex) => ({ [chartTokenField]: { $in: [regex] } })) } : { [chartTokenField]: { $in: chartRegexes } });
    }
  }

  return clauses.length > 0 ? { $and: clauses } : {};
}

function fallbackMatchesFilters(
  song: PublicSong,
  filters: {
    query: string;
    folders?: string[];
    series?: string[];
    levels?: string[];
    charts?: string[];
    levelMode?: LevelFilterMode;
    supportedVersion?: PiuSeriesId;
    removedFromVersion?: PiuSeriesId;
  },
): boolean {
  const query = cleanText(filters.query).toLowerCase();
  const folders = cleanList(filters.folders);
  const series = cleanList(filters.series);
  const levels = cleanList(filters.levels);
  const charts = cleanList(filters.charts);
  const supportedVersion = filters.supportedVersion ?? MAIN_CATALOG_VERSION;

  if (filters.removedFromVersion) {
    if (!song.removedFromVersions.includes(filters.removedFromVersion)) {
      return false;
    }
  } else if (!song.supportedVersions.includes(supportedVersion)) {
    return false;
  }

  if (query.length > 0) {
    const haystack = `${song.title} ${song.artist} ${song.version} ${song.folder ?? ""} ${song.series ?? ""} ${song.chartSummary.join(" ")}`.toLowerCase();
    if (!haystack.includes(query)) {
      return false;
    }
  }

  if (folders.length > 0 && (!song.folder || !folders.includes(song.folder))) {
    return false;
  }

  if (series.length > 0 && (!song.series || !series.includes(song.series))) {
    return false;
  }

  if (!songMatchesLevelFilters(song, levels, charts, filters.levelMode)) {
    return false;
  }

  if (
    charts.length > 0 &&
    levels.length === 0 &&
    !charts[filters.levelMode === "and" ? "every" : "some"]((chart) =>
      song.chartSummary.some((token) => chart === chartTypeFromToken(token)),
    )
  ) {
    return false;
  }

  return true;
}

export async function searchSongs(params: {
  query: string;
  cursor?: string | null;
  limit?: number;
  folders?: string[];
  series?: string[];
  levels?: string[];
  charts?: string[];
  levelMode?: LevelFilterMode;
  sortBy?: SongSortOption;
  sortDirection?: SortDirection;
  favoriteSlugs?: Set<string>;
  supportedVersion?: PiuSeriesId;
  removedFromVersion?: PiuSeriesId;
}): Promise<SongSearchResult> {
  const limit = Math.min(Math.max(params.limit ?? PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const offset = decodeCursor(params.cursor ?? null);
  const version = params.supportedVersion ?? MAIN_CATALOG_VERSION;
  const sortBy = normalizeSortOption(params.sortBy);
  const sortDirection = normalizeSortDirection(params.sortDirection);
  const favoriteSlugs = params.favoriteSlugs;
  const favoritesFirst = Boolean(favoriteSlugs && favoriteSlugs.size > 0);

  if (!hasMongoConfig()) {
    const all = sortFallbackSongs(
      (await fallbackSongs(version, 0, 250)).filter((song) => fallbackMatchesFilters(song, params)),
      sortBy,
      sortDirection,
      favoriteSlugs,
    );
    const page = all.slice(offset, offset + limit);
    return {
      songs: page,
      nextCursor: offset + limit < all.length ? encodeCursor(offset + limit) : null,
      total: all.length,
      filterOptions: filterOptionsFromValues({
        folders: all.map((song) => song.folder ?? ""),
        series: all.map((song) => song.series ?? ""),
        chartTokens: all.flatMap((song) => song.chartSummary),
        charts: params.charts,
      }),
    };
  }

  const filter = buildSearchFilter({ ...params, supportedVersion: version });
  const collection = await collectionFor(version);
  const [total, filterOptions] = await Promise.all([collection.countDocuments(filter), getCatalogFilterOptions(version, filter, params.charts, params.removedFromVersion)]);
  const songs = favoritesFirst
    ? await findMongoFavoriteSortedSongs(version, filter, offset, limit + 1, sortBy, sortDirection, favoriteSlugs!)
    : await findMongoSongs(version, filter, offset, limit + 1, sortBy, sortDirection);

  return {
    songs: songs.slice(0, limit),
    nextCursor: songs.length > limit ? encodeCursor(offset + limit) : null,
    total,
    filterOptions,
  };
}

export async function getCatalogFilterOptions(
  version: PiuSeriesId = MAIN_CATALOG_VERSION,
  filter: Filter<CatalogDocument> = {},
  charts?: string[],
  removedFromVersion?: PiuSeriesId,
): Promise<CatalogFilterOptions> {
  if (!hasMongoConfig()) {
    const songs = await fallbackSongs(version, 0, 250);
    return filterOptionsFromValues({
      folders: songs.map((song) => song.folder ?? ""),
      series: songs.map((song) => song.series ?? ""),
      chartTokens: songs.flatMap((song) => song.chartSummary),
      charts,
    });
  }

  const collection = await collectionFor(version);
  const baseFilter = Object.keys(filter).length > 0 ? filter : versionSupportFilter(version, removedFromVersion);
  const chartTokenField = `chartTokensByVersion.${version}`;
  const [folders, series, chartTokens] = await Promise.all([
    collection.distinct("folder", baseFilter),
    collection.distinct("series", baseFilter),
    collection.distinct(chartTokenField, baseFilter),
  ]);

  return filterOptionsFromValues({
    folders: folders.map(cleanText),
    series: series.map(cleanText),
    chartTokens: chartTokens.map(normalizeChartToken),
    charts,
  });
}

export async function getSongBySlug(slug: string, chartVersion?: PiuSeriesId): Promise<PublicSong | null> {
  if (!hasMongoConfig()) {
    const stats = await getCatalogStats(MAIN_CATALOG_VERSION);
    const all = (await fallbackSongs(MAIN_CATALOG_VERSION, 0, 250)).map((song) => ({
      ...song,
      folderSongCount: song.folder ? stats.folderCounts.get(statsKey(song.folder)) ?? null : null,
      seriesSongCount: song.series ? stats.seriesCounts.get(statsKey(song.series)) ?? null : null,
    }));
    const song = all.find((song) => song.slug === slug) ?? null;
    return song && chartVersion ? { ...song, chartSummary: song.chartTokensByVersion?.[chartVersion] ?? song.chartSummary } : song;
  }

  const collection = await collectionFor(MAIN_CATALOG_VERSION);
  const [documents, stats] = await Promise.all([
    collection.find({}, { projection: projection() }).limit(5000).toArray(),
    getCatalogStats(MAIN_CATALOG_VERSION),
  ]);
  const match = documents
    .map((document) => publicSongFromDocument(document, piuCatalogVersionFromSeries(MAIN_CATALOG_VERSION), stats, chartVersion))
    .find((song) => song.slug === slug);

  return match ?? null;
}

export async function getSongsByTitles(
  version: PiuCatalogVersion,
  titles: string[],
): Promise<Map<string, PublicSong>> {
  const uniqueTitles = Array.from(new Set(titles.map(cleanText).filter(Boolean)));
  const result = new Map<string, PublicSong>();
  if (uniqueTitles.length === 0) {
    return result;
  }

  if (!hasMongoConfig()) {
    const fallback = await fallbackSongs(version, 0, 500);
    for (const song of fallback) {
      const key = titleLookupKey(song.title);
      if (uniqueTitles.some((title) => titleLookupKey(title) === key) && !result.has(key)) {
        result.set(key, song);
      }
    }
    return result;
  }

  const collection = await collectionFor(version);
  const documents = await collection
    .find(
      {
        supportedVersions: version,
        $or: uniqueTitles.flatMap((title) => {
          const exactTitle = new RegExp(`^${escapeRegex(title)}$`, "i");
          return [{ songName: exactTitle }, { songKey: exactTitle }];
        }),
      },
      { projection: projection() },
    )
    .limit(Math.max(uniqueTitles.length * 2, uniqueTitles.length))
    .toArray();

  const wantedKeys = new Set(uniqueTitles.map(titleLookupKey));
  for (const document of documents) {
    const song = publicSongFromDocument(document, version, undefined, version);
    const key = titleLookupKey(song.title);
    if (wantedKeys.has(key) && !result.has(key)) {
      result.set(key, song);
    }
  }

  return result;
}

async function getCatalogDocumentBySlug(slug: string): Promise<WithId<CatalogDocument> | null> {
  const collection = await collectionFor(MAIN_CATALOG_VERSION);
  const documents = await collection.find({}, { projection: projection() }).limit(5000).toArray();

  return documents.find((document) => publicSongFromDocument(document, piuCatalogVersionFromSeries(MAIN_CATALOG_VERSION)).slug === slug) ?? null;
}

function cleanEditableList(values: unknown, maxItems: number): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(
    new Set(
      values
        .map((value) => cleanText(value))
        .filter(Boolean)
        .slice(0, maxItems),
    ),
  );
}

function normalizeCatalogEditorPayload(input: Partial<CatalogEditorPayload>): CatalogEditorPayload {
  const title = cleanText(input.title).slice(0, 180);
  const artist = cleanText(input.artist).slice(0, 180);
  const folder = cleanText(input.folder).slice(0, 120);
  const folderPosition = editableFolderPosition(input.folderPosition);
  const series = cleanText(input.series).slice(0, 120);
  const tags = cleanEditableList(input.tags, 24).map((tag) => tag.slice(0, 60));
  const chartTokens = cleanEditableList(input.chartTokens, 80).map(normalizeChartToken);
  const history = Array.isArray(input.history) ? input.history.filter((event): event is SongCatalogHistoryEvent => Boolean(event && typeof event.date === "string" && typeof event.note === "string" && isPiuSeriesId(event.version))).slice(0, 80) : [];
  const chartHistory = Array.isArray(input.chartHistory)
    ? input.chartHistory.filter((event): event is ChartCatalogHistoryEvent => Boolean(event && typeof event.id === "string" && typeof event.date === "string" && typeof event.note === "string" && typeof event.chartId === "string" && typeof event.chartToken === "string" && isPiuSeriesId(event.version))).slice(0, 240)
    : [];
  const chartLinks = Array.isArray(input.chartLinks)
    ? input.chartLinks.filter((link): link is ChartVersionLink => Boolean(link && typeof link.id === "string" && link.tokens && typeof link.tokens === "object")).slice(0, 120)
    : [];
  const invalidChartTokens = chartTokens.filter((token) => !/^[A-Z0-9+-]{1,12}$/.test(token));

  if (title.length < 1) {
    throw new Error("Title is required.");
  }
  if (artist.length < 1) {
    throw new Error("Artist is required.");
  }
  if (invalidChartTokens.length > 0) {
    throw new Error(`Chart tokens can only use letters, numbers, +, or -: ${invalidChartTokens.join(", ")}`);
  }

  return {
    title,
    artist,
    folder,
    folderPosition,
    series,
    tags,
    chartTokens,
    history,
    chartHistory,
    chartLinks,
  };
}

function updatedChartsFull(existingCharts: PublicChart[] | undefined, chartTokens: string[]): PublicChart[] | undefined {
  if (!Array.isArray(existingCharts)) {
    return undefined;
  }

  return chartTokens.map((token, index) => {
    const existing = existingCharts[index];
    return {
      ...existing,
      token,
      mode: chartModeFromToken(token),
      level: chartLevelForEditor(token),
    };
  });
}

export async function getCatalogEditorPayload(slug: string): Promise<CatalogEditorPayload | null> {
  const song = await getSongBySlug(slug);
  return song ? catalogEditorPayloadFromSong(song) : null;
}

export async function updateCatalogSong(slug: string, input: Partial<CatalogEditorPayload>, audioFile?: File | null): Promise<PublicSong> {
  if (!hasMongoConfig()) {
    throw new Error("Catalog database is not configured.");
  }

  const payload = normalizeCatalogEditorPayload(input);
  const document = await getCatalogDocumentBySlug(slug);
  if (!document) {
    throw new Error("Song not found.");
  }

  const collection = await collectionFor(MAIN_CATALOG_VERSION);
  const chartsFull = updatedChartsFull(document.chartsFull, payload.chartTokens);
  const $set: Partial<CatalogDocument> = {
    songName: payload.title,
    artist: payload.artist,
    folder: payload.folder,
    folderPosition: payload.folderPosition,
    series: payload.series,
    tags: payload.tags,
    chartTokens: payload.chartTokens,
    history: payload.history,
    chartHistory: payload.chartHistory,
    chartLinks: payload.chartLinks,
  };

  if (chartsFull) {
    $set.chartsFull = chartsFull;
  }

  if (audioFile) {
    const upload = await saveCatalogAudioUpload(versionFromDocument(document, piuCatalogVersionFromSeries(MAIN_CATALOG_VERSION)), payload.title, payload.artist, audioFile);
    $set.audioPath = upload.audioPath;
    $set.audioPreview = {
      ...(document.audioPreview ?? {}),
      url: upload.publicUrl,
      localPath: upload.audioPath,
      source: "admin-upload",
      confidence: 1,
      reviewRequired: false,
      matchedAt: new Date(),
    };
  }

  await collection.updateOne({ _id: document._id }, { $set });

  const updated = await collection.findOne({ _id: document._id }, { projection: projection() });
  if (!updated) {
    throw new Error("Song not found after update.");
  }

  return publicSongFromDocument(updated, piuCatalogVersionFromSeries(MAIN_CATALOG_VERSION));
}

export async function getSitemapSongs(limit = 5000): Promise<PublicSong[]> {
  if (!hasMongoConfig()) {
    return fallbackSongs(MAIN_CATALOG_VERSION, 0, Math.min(limit, 250));
  }

  try {
    return findMongoSongs(MAIN_CATALOG_VERSION, { supportedVersions: MAIN_CATALOG_VERSION }, 0, limit, "series", "asc");
  } catch {
    return [];
  }
}
