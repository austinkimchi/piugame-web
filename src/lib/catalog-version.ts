import type { PiuSeriesId } from "@/lib/types";

export interface PiuSeriesMetadata {
  id: PiuSeriesId;
  slug: string;
  label: string;
  shortLabel: string;
  rank: number;
}

export const DEFAULT_CATALOG_SERIES: PiuSeriesId = "phoenix2";
export const REMOVED_FROM_PHOENIX2_SLUG = "removed-from-phoenix2";

export const SUPPORTED_PIU_SERIES: PiuSeriesMetadata[] = [
  { id: "phoenix2", slug: "phoenix-2", label: "Phoenix 2", shortLabel: "PHX2", rank: 0 },
  { id: "phoenix", slug: "phoenix", label: "Phoenix", shortLabel: "PHX", rank: 1 },
  { id: "xx", slug: "xx", label: "XX", shortLabel: "XX", rank: 2 },
  { id: "prime2", slug: "prime-2", label: "Prime 2", shortLabel: "PR2", rank: 3 },
  { id: "prime", slug: "prime", label: "Prime", shortLabel: "PR", rank: 4 },
  { id: "fiesta", slug: "fiesta", label: "Fiesta/Fiesta 2", shortLabel: "FIESTA", rank: 5 },
  { id: "nx", slug: "nx", label: "NX/NX2", shortLabel: "NX", rank: 6 },
  { id: "zero-1st", slug: "zero-to-1st", label: "Zero to 1st", shortLabel: "0-1ST", rank: 7 },
];

const SERIES_BY_ID = new Map(SUPPORTED_PIU_SERIES.map((series) => [series.id, series]));
const SERIES_BY_SLUG = new Map(SUPPORTED_PIU_SERIES.map((series) => [series.slug, series]));

export function isPiuSeriesId(value: unknown): value is PiuSeriesId {
  return typeof value === "string" && SERIES_BY_ID.has(value as PiuSeriesId);
}

export function normalizePiuSeriesId(value: unknown, fallback: PiuSeriesId = DEFAULT_CATALOG_SERIES): PiuSeriesId {
  return isPiuSeriesId(value) ? value : fallback;
}

export function piuSeriesFromSlug(slug: string): PiuSeriesMetadata | null {
  return SERIES_BY_SLUG.get(slug) ?? null;
}

export function piuSeriesMetadata(id: PiuSeriesId): PiuSeriesMetadata {
  return SERIES_BY_ID.get(id) ?? SERIES_BY_ID.get(DEFAULT_CATALOG_SERIES)!;
}

export function piuSeriesRank(id: PiuSeriesId | null | undefined): number {
  return id ? piuSeriesMetadata(id).rank : Number.MAX_SAFE_INTEGER;
}

export function sortPiuSeries(values: PiuSeriesId[]): PiuSeriesId[] {
  return [...values].sort((left, right) => piuSeriesRank(left) - piuSeriesRank(right));
}
