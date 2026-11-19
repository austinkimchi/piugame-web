import path from "node:path";
import { audioFileUrlForPath } from "./audio-preview.ts";
import { isPiuSeriesId, normalizePiuSeriesLabel, sortPiuSeries } from "./catalog-version.ts";
import { isPremiumSong } from "./premium-songs.ts";
import type { PublicCatalogOptions, PublicCatalogSnapshot, PublicCatalogSong } from "./public-catalog-types.ts";
import type { ChartCatalogHistoryEvent, ChartVersionLink, PiuCatalogVersion, PiuSeriesId, SongCatalogHistoryEvent } from "./types.ts";

export type PublicCatalogDocument = Record<string, unknown>;

// Read only fields needed to construct the public DTO. Local audio paths are
// used to resolve public URLs here, never copied into the response.
export const PUBLIC_CATALOG_PROJECTION = {
  _id: 0, songName: 1, songKey: 1, artist: 1, piuVersion: 1, catalogVersion: 1,
  supportedVersions: 1, removedFromVersions: 1,
  "history.date": 1, "history.type": 1, "history.version": 1, "history.note": 1,
  "chartHistory.id": 1, "chartHistory.date": 1, "chartHistory.type": 1,
  "chartHistory.version": 1, "chartHistory.chartId": 1, "chartHistory.chartToken": 1,
  "chartHistory.previousChartToken": 1, "chartHistory.note": 1,
  "chartLinks.id": 1, "chartLinks.tokens": 1,
  images: 1, previewUrl: 1, audioPreviewUrl: 1, audioPath: 1,
  "audioPreview.url": 1, "audioPreview.localPath": 1,
  bpm: 1, bpmRaw: 1, chartTokens: 1, chartTokensByVersion: 1,
  "chartsFull.token": 1, "chartsFull.mode": 1, "chartsFull.level": 1,
  folder: 1, series: 1, folderPosition: 1, tags: 1,
} as const;

const text = (value: unknown): string => typeof value === "string" || typeof value === "number"
  ? String(value).replace(/\s+/g, " ").trim() : "";
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const unique = (values: string[]): string[] => [...new Set(values.filter(Boolean))];
const token = (value: unknown): string => text(value).toUpperCase().replace(/\s+/g, "").replace(/^CX([2-5])$/, "C$1");
const tokens = (value: unknown): string[] => unique(array(value).map(token));
const versions = (value: unknown): PiuSeriesId[] => sortPiuSeries([...new Set(array(value).filter(isPiuSeriesId))]);
const slugify = (value: string): string => value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const eventType = (value: unknown): value is SongCatalogHistoryEvent["type"] => value === "added" || value === "removed" || value === "changed";

function history(value: unknown): SongCatalogHistoryEvent[] {
  return array(value).flatMap((item) => {
    const event = record(item);
    if (typeof event.date !== "string" || typeof event.note !== "string" || !isPiuSeriesId(event.version) || !eventType(event.type)) return [];
    return [{ date: event.date, type: event.type, version: event.version, note: event.note }];
  });
}

function chartHistory(value: unknown): ChartCatalogHistoryEvent[] {
  return array(value).flatMap((item) => {
    const event = record(item);
    const base = history([event])[0];
    if (!base || typeof event.id !== "string" || typeof event.chartId !== "string" || typeof event.chartToken !== "string") return [];
    return [{ id: event.id, ...base, chartId: event.chartId, chartToken: token(event.chartToken),
      ...(typeof event.previousChartToken === "string" ? { previousChartToken: token(event.previousChartToken) } : {}) }];
  });
}

function chartLinks(value: unknown): ChartVersionLink[] {
  return array(value).flatMap((item) => {
    const link = record(item);
    const id = text(link.id).slice(0, 80);
    const source = record(link.tokens);
    const entries = Object.keys(source).filter(isPiuSeriesId).sort().flatMap((version) => {
      const normalized = token(source[version]);
      return normalized ? [[version, normalized]] : [];
    });
    return id && entries.length ? [{ id, tokens: Object.fromEntries(entries) }] : [];
  });
}

function publicSong(document: PublicCatalogDocument, selectedVersion: PiuSeriesId): PublicCatalogSong {
  const title = text(document.songName ?? document.songKey ?? "Untitled Song");
  const artist = text(document.artist ?? "Unknown Artist");
  const rawVersion = text(document.piuVersion ?? document.catalogVersion);
  const fallbackVersion: PiuCatalogVersion = selectedVersion === "phoenix" ? "phoenix" : "phoenix2";
  const version = rawVersion === "phoenix" || rawVersion === "phoenix2" ? rawVersion : fallbackVersion;
  const supportedVersions = versions(document.supportedVersions);
  const byVersion = record(document.chartTokensByVersion);
  const chartTokensByVersion = Object.fromEntries(Object.keys(byVersion).filter(isPiuSeriesId).sort()
    .filter((key) => Array.isArray(byVersion[key])).map((key) => [key, tokens(byVersion[key])]));
  // An explicitly empty selected-version array means no charts in this version.
  const chartSummary = Array.isArray(byVersion[selectedVersion]) ? tokens(byVersion[selectedVersion])
    : array(document.chartTokens).length ? tokens(document.chartTokens)
    : tokens(array(document.chartsFull).map((chart) => {
      const entry = record(chart);
      return entry.token || `${text(entry.mode)}${text(entry.level)}`;
    }));
  const audio = record(document.audioPreview);
  const localUrl = audioFileUrlForPath(text(document.audioPath ?? audio.localPath), version);
  const remoteUrl = text(audio.url ?? document.previewUrl ?? document.audioPreviewUrl);
  const previewUrl = localUrl || (/^(?:\/(?!\/)|https?:\/\/)/.test(remoteUrl) ? remoteUrl : null);
  const image = text(array(document.images)[0]);
  const position = Number(document.folderPosition);
  return {
    slug: `${slugify(title)}-${slugify(artist) || "unknown"}-${version}`,
    songKey: text(document.songKey) || title,
    title, artist, version,
    supportedVersions: supportedVersions.length ? supportedVersions : [version],
    removedFromVersions: versions(document.removedFromVersions),
    history: history(document.history), chartHistory: chartHistory(document.chartHistory), chartLinks: chartLinks(document.chartLinks),
    imageUrl: image ? `/assets/piu/${version}/${version === "phoenix2" ? "song_img2" : "song_img"}/${path.basename(image)}` : null,
    previewUrl, previewAvailable: Boolean(previewUrl), bpm: text(document.bpm ?? document.bpmRaw) || null,
    chartSummary, chartTokensByVersion,
    folder: text(document.folder) || null,
    folderPosition: Number.isInteger(position) && position > 0 ? position : null,
    folderSongCount: null,
    series: normalizePiuSeriesLabel(text(document.series)) || null,
    seriesSongCount: null,
    tags: unique(array(document.tags).map(text)),
    isPremium: isPremiumSong(title, selectedVersion),
  };
}

function counts(values: Array<string | null>): Map<string, number> {
  const result = new Map<string, number>();
  for (const value of values) {
    if (value) result.set(value.toLowerCase(), (result.get(value.toLowerCase()) ?? 0) + 1);
  }
  return result;
}

export function buildPublicCatalogSnapshot(documents: PublicCatalogDocument[], selectedVersion: PiuSeriesId, options: PublicCatalogOptions = {}): PublicCatalogSnapshot {
  const songs = documents.map((document) => publicSong(document, selectedVersion));
  const folders = counts(songs.map((song) => song.folder));
  const series = counts(songs.map((song) => song.series));
  for (const song of songs) {
    song.folderSongCount = song.folder ? folders.get(song.folder.toLowerCase()) ?? null : null;
    song.seriesSongCount = song.series ? series.get(song.series.toLowerCase()) ?? null : null;
  }
  // Mongo's natural order is not stable. A complete tie-breaker makes response
  // bytes independent of cursor order, including duplicate slugs.
  songs.sort((a, b) => compare(a.slug, b.slug) || compare(JSON.stringify(a), JSON.stringify(b)));
  const allTokens = unique(songs.flatMap((song) => song.chartSummary));
  const levels = unique(allTokens.map((value) => {
    if (/^C(?:O-?OP|[2-5])?$/.test(value)) return "";
    const match = value.match(/(\d{1,2})$/);
    const level = match ? Number(match[1]) : NaN;
    return level >= 1 && level <= 27 ? String(level) : "+";
  })).sort((a, b) => (a === "+" ? Infinity : Number(a)) - (b === "+" ? Infinity : Number(b)));
  const seriesOrder = ["1st", "nx", "fiesta", "prime", "prime2", "xx", "phoenix", "phoenix2"];
  const rank = (value: string): number => {
    const index = seriesOrder.indexOf(value.toLowerCase().replace(/[^a-z0-9]/g, ""));
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  const chartTypes = new Set<string>(allTokens.map((value) => value.startsWith("C") ? "co-op" : value.startsWith("D") ? "doubles" : value.startsWith("S") ? "singles" : ""));
  return {
    schemaVersion: 1, selectedVersion, view: options.removed ? "removed" : "supported", total: songs.length,
    filterOptions: {
      folders: unique(songs.map((song) => song.folder ?? "")).sort(),
      series: unique(songs.map((song) => song.series ?? "")).sort((a, b) => rank(a) - rank(b) || compare(a, b)),
      levels,
      charts: ["singles", "doubles", "co-op"].filter((type) => chartTypes.has(type)),
    },
    songs,
  };
}
