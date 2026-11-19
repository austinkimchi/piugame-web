import { normalizePiuSeriesLabel, sortPiuSeries } from "./catalog-version.ts";
import type { PiuSeriesId, SongCatalogHistoryEvent } from "@/lib/types";

export interface MergeCatalogDocument {
  songKey?: string;
  songName?: string;
  artist?: string;
  supportedVersions?: PiuSeriesId[];
  removedFromVersions?: PiuSeriesId[];
  chartTokens?: string[];
  chartTokensByVersion?: Partial<Record<PiuSeriesId, string[]>>;
  history?: SongCatalogHistoryEvent[];
  [key: string]: unknown;
}

export interface CatalogMergeResult {
  documents: MergeCatalogDocument[];
  sharedSongs: number;
  phoenixOnlySongs: number;
  phoenix2OnlySongs: number;
}

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function mergeKey(document: MergeCatalogDocument): string {
  return `${cleanText(document.songKey ?? document.songName).toLowerCase()}\u0000${cleanText(document.artist).toLowerCase()}`;
}

function historyEvent(date: string, type: SongCatalogHistoryEvent["type"], version: PiuSeriesId, note: string): SongCatalogHistoryEvent {
  return { date, type, version, note };
}

function uniqueHistory(events: SongCatalogHistoryEvent[]): SongCatalogHistoryEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = `${event.date}\u0000${event.type}\u0000${event.version}\u0000${event.note}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function chartTokensFor(song: MergeCatalogDocument): string[] {
  return Array.isArray(song.chartTokens) ? song.chartTokens : [];
}

export function mergePhoenixCatalogs(args: {
  phoenixSongs: MergeCatalogDocument[];
  phoenix2Songs: MergeCatalogDocument[];
  importedAt: string;
}): CatalogMergeResult {
  const phoenixByKey = new Map(args.phoenixSongs.map((song) => [mergeKey(song), song]));
  const mergedByKey = new Map<string, MergeCatalogDocument>();
  let sharedSongs = 0;

  for (const phoenix2Song of args.phoenix2Songs) {
    const key = mergeKey(phoenix2Song);
    const phoenixSong = phoenixByKey.get(key);
    const supportedVersions = sortPiuSeries([
      "phoenix2",
      ...(phoenixSong ? ["phoenix" as const] : []),
      ...((phoenix2Song.supportedVersions ?? []).filter((version) => version !== "phoenix2" && version !== "phoenix")),
    ]);

    if (phoenixSong) {
      sharedSongs += 1;
    }

    mergedByKey.set(key, {
      ...phoenix2Song,
      ...(typeof phoenix2Song.series === "string" ? { series: normalizePiuSeriesLabel(phoenix2Song.series) } : {}),
      catalogVersion: "catalog",
      piuVersion: "phoenix2",
      supportedVersions,
      removedFromVersions: (phoenix2Song.removedFromVersions ?? []).filter((version) => version !== "phoenix2"),
      chartTokensByVersion: {
        ...(phoenix2Song.chartTokensByVersion ?? {}),
        phoenix2: chartTokensFor(phoenix2Song),
        ...(phoenixSong ? { phoenix: chartTokensFor(phoenixSong) } : {}),
      },
      history: uniqueHistory([
        historyEvent(args.importedAt, "added", "phoenix2", "Imported from PHOENIX 2 catalog."),
        ...(phoenixSong ? [historyEvent(args.importedAt, "added", "phoenix", "Matched in Phoenix catalog.")] : []),
        ...(phoenix2Song.history ?? []),
      ]),
    });
  }

  for (const phoenixSong of args.phoenixSongs) {
    const key = mergeKey(phoenixSong);
    if (mergedByKey.has(key)) {
      continue;
    }

    mergedByKey.set(key, {
      ...phoenixSong,
      ...(typeof phoenixSong.series === "string" ? { series: normalizePiuSeriesLabel(phoenixSong.series) } : {}),
      catalogVersion: "catalog",
      piuVersion: "phoenix",
      supportedVersions: sortPiuSeries(["phoenix", ...(phoenixSong.supportedVersions ?? []).filter((version) => version !== "phoenix")]),
      removedFromVersions: sortPiuSeries(["phoenix2", ...(phoenixSong.removedFromVersions ?? []).filter((version) => version !== "phoenix2")]),
      chartTokensByVersion: {
        ...(phoenixSong.chartTokensByVersion ?? {}),
        phoenix: chartTokensFor(phoenixSong),
      },
      history: uniqueHistory([
        historyEvent(args.importedAt, "added", "phoenix", "Imported from Phoenix catalog."),
        historyEvent(args.importedAt, "removed", "phoenix2", "Present in PHOENIX catalog but absent from PHOENIX 2 catalog."),
        ...(phoenixSong.history ?? []),
      ]),
    });
  }

  return {
    documents: Array.from(mergedByKey.values()),
    sharedSongs,
    phoenixOnlySongs: args.phoenixSongs.length - sharedSongs,
    phoenix2OnlySongs: args.phoenix2Songs.length - sharedSongs,
  };
}
