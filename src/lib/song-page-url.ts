import { DEFAULT_CATALOG_SERIES, isPiuSeriesId, SUPPORTED_PIU_SERIES } from "./catalog-version.ts";
import { catalogCommunitySlug } from "./catalog-private-overlay.ts";
import type { PiuSeriesId, PublicSong } from "./types.ts";

type QueryValue = string | string[] | undefined;

export function requestedSongVersion(value: QueryValue): PiuSeriesId {
  const version = Array.isArray(value) ? value[0] : value;
  return isPiuSeriesId(version) ? version : DEFAULT_CATALOG_SERIES;
}

/** Public page identity must not depend on the reader's account preference. */
export function songPageVersion(song: Pick<PublicSong, "supportedVersions">, requested: PiuSeriesId): PiuSeriesId {
  if (song.supportedVersions.includes(requested)) return requested;
  return SUPPORTED_PIU_SERIES.find((series) => song.supportedVersions.includes(series.id))?.id ?? DEFAULT_CATALOG_SERIES;
}

export function selectedSongChart(value: QueryValue, charts: readonly string[]): string | null {
  const chart = Array.isArray(value) ? value[0] : value;
  return chart && charts.includes(chart) ? chart : null;
}

/** Reuse the existing resolved storage alias; this does not rename catalog data. */
export function songPagePath(song: Pick<PublicSong, "slug" | "version">, version: PiuSeriesId, chart?: string | null): string {
  const query = new URLSearchParams({ version });
  if (chart) query.set("chart", chart);
  return `/songs/${encodeURIComponent(catalogCommunitySlug(song))}?${query.toString()}`;
}
