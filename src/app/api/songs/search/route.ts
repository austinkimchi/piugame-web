import { type NextRequest, NextResponse } from "next/server";

import { checkRateLimit } from "@/lib/rate-limit";
import { getSongsByTitles, searchSongs } from "@/lib/catalog";
import { getAllFavoriteSongSlugs, getCurrentUser, getFavoriteSongSlugSet } from "@/lib/auth";
import { isPiuSeriesId } from "@/lib/catalog-version";
import { chartModesFromFilters } from "@/lib/chart-recommendation";
import { addChartRecommendationsToSongs, getPerformanceRecentPlays } from "@/lib/performance";
import { catalogChartTokenFromPlay } from "@/lib/performance-chart-key";
import { normalizePiuGameVersion, performanceVersionForCatalog } from "@/lib/piu-version";
import type { LevelFilterMode, PiuSeriesId, SongSortOption, SortDirection } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clientKey(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const userAgent = request.headers.get("user-agent") ?? "unknown";
  return `${forwardedFor ?? "local"}:${userAgent}`;
}

function parseList(searchParams: URLSearchParams, key: string): string[] {
  return searchParams
    .getAll(key)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseLevelMode(value: string | null): LevelFilterMode {
  return value === "or" ? "or" : "and";
}

function parseSortOption(value: string | null): SongSortOption {
  return value === "title" || value === "artist" || value === "folder" ? value : "series";
}

function parseSortDirection(value: string | null): SortDirection {
  return value === "asc" ? "asc" : "desc";
}

function parseBoolean(value: string | null): boolean {
  return value === "true" || value === "1";
}

function parseSeriesId(value: string | null): PiuSeriesId | undefined {
  return isPiuSeriesId(value) ? value : undefined;
}

export async function GET(request: NextRequest) {
  if (!checkRateLimit(clientKey(request))) {
    return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 });
  }

  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const limit = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "24", 10);
  const user = await getCurrentUser();
  const favoritesFirst = parseBoolean(request.nextUrl.searchParams.get("favoritesFirst"));
  const favoriteSlugsForSort = favoritesFirst ? await getAllFavoriteSongSlugs(user) : undefined;
  if (query.toLowerCase() === "recent") {
    if (!user) {
      return NextResponse.json({ error: "Sign in required to view recent songs." }, { status: 401 });
    }

    const offset = Math.max(0, Number.parseInt(request.nextUrl.searchParams.get("cursor") ?? "0", 10) || 0);
    const direction = parseSortDirection(request.nextUrl.searchParams.get("sortDirection"));
    const recentLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 35) : 24;
    const recent = await getPerformanceRecentPlays(user.id, { offset, limit: recentLimit, sortDirection: direction });
    const songsByTitle = await getSongsByTitles(normalizePiuGameVersion(user.preferences.piuGameVersion), recent.recentPlays.map((play) => play.songName));
    const filters = {
      folders: parseList(request.nextUrl.searchParams, "folder"),
      series: parseList(request.nextUrl.searchParams, "series"),
      levels: parseList(request.nextUrl.searchParams, "level"),
      charts: parseList(request.nextUrl.searchParams, "chart"),
      levelMode: parseLevelMode(request.nextUrl.searchParams.get("levelMode")),
    };
    const songs = recent.recentPlays
      .flatMap((play) => {
        const song = songsByTitle.get(songLookupKey(play.songName));
        const chartToken = song ? chartTokenForRecentPlay(song.chartSummary, play) : null;
        if (!song || !chartToken || !matchesRecentFilters(song, chartToken, filters)) return [];
        return [{ ...song, chartSummary: [chartToken], recommendedChartToken: chartToken }];
      });
    const recentFavoriteSlugs = favoriteSlugsForSort ?? await getFavoriteSongSlugSet(user, songs.map((song) => song.slug));
    const orderedSongs = favoriteSlugsForSort?.size ? [...songs].sort((left, right) => Number(recentFavoriteSlugs.has(right.slug)) - Number(recentFavoriteSlugs.has(left.slug))) : songs;
    return NextResponse.json({
      songs: orderedSongs.map((song) => ({ ...song, isFavorite: recentFavoriteSlugs.has(song.slug) })),
      nextCursor: recent.nextOffset === null ? null : String(recent.nextOffset),
      total: recent.total,
      // The explorer retains its catalog filter choices for this special feed.
      filterOptions: { folders: [], series: [], levels: [], charts: [] },
    }, { headers: { "Cache-Control": "private, no-store" } });
  }
  const chartFilters = parseList(request.nextUrl.searchParams, "chart");
  const supportedVersion = parseSeriesId(request.nextUrl.searchParams.get("supportedVersion"));
  const removedFromVersion = parseSeriesId(request.nextUrl.searchParams.get("removedFromVersion"));
  const result = await searchSongs({
    query,
    cursor: request.nextUrl.searchParams.get("cursor"),
    limit: Number.isFinite(limit) ? limit : 24,
    folders: parseList(request.nextUrl.searchParams, "folder"),
    series: parseList(request.nextUrl.searchParams, "series"),
    levels: parseList(request.nextUrl.searchParams, "level"),
    charts: chartFilters,
    levelMode: parseLevelMode(request.nextUrl.searchParams.get("levelMode")),
    sortBy: parseSortOption(request.nextUrl.searchParams.get("sortBy")),
    sortDirection: parseSortDirection(request.nextUrl.searchParams.get("sortDirection")),
    favoriteSlugs: favoriteSlugsForSort,
    supportedVersion,
    removedFromVersion,
  });
  const favoriteSlugs = favoriteSlugsForSort ?? (await getFavoriteSongSlugSet(user, result.songs.map((song) => song.slug)));
  const performanceVersion = performanceVersionForCatalog(supportedVersion ?? "phoenix2", removedFromVersion);
  const recommendedSongs = await addChartRecommendationsToSongs(
    user?.id ?? null,
    performanceVersion,
    result.songs,
    chartModesFromFilters(chartFilters),
  );
  const resultWithFavorites = {
    ...result,
    songs: recommendedSongs.map((song) => ({ ...song, isFavorite: favoriteSlugs.has(song.slug) })),
  };

  return NextResponse.json(resultWithFavorites, {
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}

function chartTokenForRecentPlay(
  chartSummary: string[],
  play: { mode: string | null; level: string | null },
): string | null {
  const token = catalogChartTokenFromPlay(play);
  if (!token) return null;

  return chartSummary.find((chart) => chart.toUpperCase() === token) ?? null;
}

function matchesRecentFilters(
  song: { folder: string | null; series: string | null },
  chartToken: string,
  filters: { folders: string[]; series: string[]; levels: string[]; charts: string[]; levelMode: LevelFilterMode },
): boolean {
  const sameText = (values: string[], candidate: string | null) => values.length === 0 || values.some((value) => value.localeCompare(candidate ?? "", undefined, { sensitivity: "accent" }) === 0);
  if (!sameText(filters.folders, song.folder) || !sameText(filters.series, song.series)) return false;
  const token = chartToken.trim().toUpperCase();
  const chart = token.startsWith("S") ? "singles" : token.startsWith("D") ? "doubles" : token.startsWith("C") ? "co-op" : "";
  const level = token.match(/\d+$/)?.[0] ?? "";
  const matchesChart = filters.charts.length === 0 || filters.charts.includes(chart);
  const matchesLevel = filters.levels.length === 0 || (filters.levelMode === "and" ? filters.levels.every((value) => value === level) : filters.levels.some((value) => value === level));
  return matchesChart && matchesLevel;
}

function songLookupKey(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}
