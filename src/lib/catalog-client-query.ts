import { normalizePiuSeriesLabel, piuSeriesLabelPattern } from "./catalog-version.ts";
import { catalogTitleAliasTargets } from "./catalog-search-aliases.ts";
import type { CatalogFilterOptions, LevelFilterMode, PublicSong, SongSortOption, SortDirection } from "./types.ts";

export type CatalogQuerySong = Pick<PublicSong, "slug" | "title" | "artist" | "folder" | "folderPosition" | "series" | "tags" | "chartSummary"> & { songKey?: string };
export interface CatalogQuery {
  query: string;
  folders?: string[];
  series?: string[];
  levels?: string[];
  charts?: string[];
  levelMode?: LevelFilterMode;
  sortBy?: SongSortOption;
  sortDirection?: SortDirection;
  favoriteSlugs?: ReadonlySet<string>;
}

const SERIES_ORDER = ["1st", "nx", "fiesta", "prime", "prime2", "xx", "phoenix", "phoenix2"];
const CHART_ORDER = ["singles", "doubles", "co-op"];
const clean = (value: string) => value.replace(/\s+/g, " ").trim();
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const unique = (values: string[]) => [...new Set(values.map(clean).filter(Boolean))];
const chartRegex = (chart: string) => chart === "singles" ? /^S/i : chart === "doubles" ? /^D/i : chart === "co-op" ? /^C/i : null;

// These expressions deliberately match the legacy Mongo search predicates,
// including co-op player counts and the nonstandard-level (+) bucket.
function levelRegexes(level: string, chart?: string): RegExp[] {
  if (chart === "co-op") return /^[2-5]$/.test(level) ? [new RegExp(`^C(?:X)?${level}$`, "i")] : [];
  const prefix = chart === "singles" ? "S" : chart === "doubles" ? "D" : null;
  if (prefix) return [new RegExp(level === "+" ? `^${prefix}(?!(?:[1-9]|1\\d|2[0-7])$).+$` : `^${prefix}${escapeRegex(level)}$`, "i")];
  return [
    ...(/^[2-5]$/.test(level) ? [new RegExp(`^C${level}$`, "i")] : []),
    new RegExp(level === "+" ? "^(?!C(?:O-?OP|[2-5])?$)\\D+(?!(?:[1-9]|1\\d|2[0-7])$).+$" : `\\D${escapeRegex(level)}$`, "i"),
  ];
}

export function queryCatalog<T extends CatalogQuerySong>(catalog: readonly T[], options: CatalogQuery): { songs: T[]; filterOptions: CatalogFilterOptions } {
  const query = clean(options.query);
  const text = query ? new RegExp(escapeRegex(query), "i") : null;
  const titleAliases = catalogTitleAliasTargets(query);
  const coOp = query.toUpperCase().replace(/\s+/g, "").match(/^C(?:X)?([2-5])$/);
  const tokenQuery = coOp ? new RegExp(`^C(?:X)?${coOp[1]}$`, "i") : text;
  const folders = unique(options.folders ?? []);
  const series = unique(options.series ?? []).map(piuSeriesLabelPattern);
  const levels = unique(options.levels ?? []);
  const charts = unique(options.charts ?? []);
  const predicates = levels.length
    ? levels.flatMap((level) => charts.length ? charts.map((chart) => levelRegexes(level, chart)) : [levelRegexes(level)])
    : charts.flatMap((chart) => { const regex = chartRegex(chart); return regex ? [[regex]] : []; });
  const songs = catalog.filter((song) => {
    if (text && ![song.title, song.songKey ?? "", song.artist, song.folder ?? "", song.series ?? "", ...song.tags].some((value) => text.test(value)) && !song.chartSummary.some((token) => tokenQuery!.test(token)) && !titleAliases.some((alias) => alias.title.test(song.title) && alias.artist.test(song.artist))) return false;
    if (folders.length && (!song.folder || !folders.includes(song.folder))) return false;
    if (series.length && (!song.series || !series.some((pattern) => pattern.test(song.series!)))) return false;
    if (predicates.length && !predicates[options.levelMode === "and" ? "every" : "some"]((patterns) => song.chartSummary.some((token) => patterns.some((pattern) => pattern.test(token))))) return false;
    return true;
  });
  songs.sort(catalogComparator(options.sortBy ?? "series", options.sortDirection ?? "desc", options.favoriteSlugs));
  return { songs, filterOptions: catalogQueryFilterOptions(songs, charts) };
}

// Mongo's default simple collation compares UTF-8 strings, not locale/numeric
// order. Unicode scalar order is equivalent for valid JavaScript strings.
function compareValue(left: string | number | null, right: string | number | null): number {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  const a = Array.from(String(left)), b = Array.from(String(right));
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const difference = a[index].codePointAt(0)! - b[index].codePointAt(0)!;
    if (difference) return difference;
  }
  return a.length - b.length;
}

// The existing private favorites-first path uses locale/numeric ordering rather
// than Mongo's simple collation. Retain that behavior when favorites are present.
function compareFavoriteCandidates(left: CatalogQuerySong, right: CatalogQuerySong, sort: SongSortOption, direction: SortDirection): number {
  const sign = direction === "asc" ? 1 : -1;
  const text = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
  const nullable = (a: string | null, b: string | null) => !a && !b ? 0 : !a ? 1 : !b ? -1 : text(a, b);
  if (sort === "title") return (text(left.title, right.title) || text(left.artist, right.artist)) * sign;
  if (sort === "artist") return (text(left.artist, right.artist) || text(left.title, right.title)) * sign;
  if (sort === "folder") return (nullable(left.folder, right.folder) || text(left.title, right.title)) * sign;
  const rank = (value: string | null) => {
    const index = SERIES_ORDER.indexOf((value ?? "").toLowerCase().replace(/[^a-z0-9]/g, ""));
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  const a = rank(left.series), b = rank(right.series);
  if (a === Number.MAX_SAFE_INTEGER && b !== a) return 1;
  if (b === Number.MAX_SAFE_INTEGER && a !== b) return -1;
  return (a - b) * sign || nullable(left.series, right.series) || nullable(left.folder, right.folder) || text(left.title, right.title);
}

export function catalogComparator(sort: SongSortOption, direction: SortDirection, favorites?: ReadonlySet<string>) {
  const sign = direction === "asc" ? 1 : -1;
  const rank = (series: string | null) => {
    const index = SERIES_ORDER.indexOf((series ?? "").toLowerCase().replaceAll(" ", ""));
    return index < 0 ? (sign === 1 ? Number.MAX_SAFE_INTEGER : -1) : index;
  };
  const keys = (song: CatalogQuerySong): Array<string | number | null> => {
    const series = [rank(song.series), song.series];
    if (sort === "title") return [song.title, song.artist, ...series, song.folderPosition];
    if (sort === "artist") return [song.artist, song.title, ...series, song.folderPosition];
    if (sort === "folder") return [song.folderPosition, song.folder, ...series, song.title, song.artist];
    return [...series, song.folderPosition, song.title, song.artist];
  };
  return (left: CatalogQuerySong, right: CatalogQuerySong) => {
    const favoriteOrder = Number(favorites?.has(right.slug) ?? false) - Number(favorites?.has(left.slug) ?? false);
    if (favoriteOrder) return favoriteOrder;
    if (favorites?.size) return compareFavoriteCandidates(left, right, sort, direction);
    const a = keys(left), b = keys(right);
    for (let index = 0; index < a.length; index += 1) {
      const order = compareValue(a[index], b[index]);
      if (order) return order * sign;
    }
    // Mongo has no defined order for equal keys. Use identity for stable UI focus.
    return compareValue(left.slug, right.slug);
  };
}

export function catalogQueryFilterOptions(songs: readonly CatalogQuerySong[], charts: string[] = []): CatalogFilterOptions {
  const tokens = unique(songs.flatMap((song) => song.chartSummary));
  const chartType = (token: string) => CHART_ORDER.find((chart) => chartRegex(chart)!.test(token)) ?? "";
  const levels = unique(tokens.map((token) => {
    if (charts.length === 1 && charts[0] === "co-op") return token.match(/^C([2-5])$/i)?.[1] ?? "";
    if (/^C(?:O-?OP|[2-5])?$/i.test(token)) return "";
    const level = Number(token.match(/(\d{1,2})$/)?.[1]);
    return level >= 1 && level <= 27 ? String(level) : "+";
  })).sort((a, b) => (a === "+" ? Infinity : Number(a)) - (b === "+" ? Infinity : Number(b)));
  const seriesRank = (value: string) => { const rank = SERIES_ORDER.indexOf(value.toLowerCase().replace(/[^a-z0-9]/g, "")); return rank < 0 ? Number.MAX_SAFE_INTEGER : rank; };
  return {
    folders: unique(songs.flatMap((song) => song.folder ? [song.folder] : [])).sort(),
    series: unique(songs.flatMap((song) => song.series ? [normalizePiuSeriesLabel(song.series)] : [])).sort((a, b) => seriesRank(a) - seriesRank(b) || a.localeCompare(b, undefined, { sensitivity: "base", numeric: true })),
    levels,
    charts: unique(tokens.map(chartType)).sort((a, b) => CHART_ORDER.indexOf(a) - CHART_ORDER.indexOf(b)),
  };
}
