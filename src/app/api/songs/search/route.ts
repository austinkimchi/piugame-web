import { type NextRequest, NextResponse } from "next/server";

import { checkRateLimit } from "@/lib/rate-limit";
import { getRecommendationCandidateSongs, getSongsByTitles, searchSongs } from "@/lib/catalog";
import { getAllFavoriteSongSlugs, getCurrentUser, getFavoriteSongSlugSet, getUserById, type PublicUser } from "@/lib/auth";
import { isPiuSeriesId } from "@/lib/catalog-version";
import { chartModesFromFilters } from "@/lib/chart-recommendation";
import { authenticateMobileAccessToken } from "@/lib/mobile-auth";
import { bearerTokenFromAuthorization } from "@/lib/mobile-auth-core";
import { addChartRecommendationsToSongs, getPerformanceChartRecommendations, getPerformanceRecentPlays } from "@/lib/performance";
import { catalogChartTokenFromPlay } from "@/lib/performance-chart-key";
import { normalizePiuGameVersion, performanceVersionForCatalog } from "@/lib/piu-version";
import { songMatchesChartFilters } from "@/lib/song-chart-filters";
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
  const requestUser = await userForRequest(request);
  if (requestUser.invalidToken) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  }
  const user = requestUser.user;
  const favoritesFirst = parseBoolean(request.nextUrl.searchParams.get("favoritesFirst"));
  const favoriteSlugsForSort = favoritesFirst ? await getAllFavoriteSongSlugs(user) : undefined;
  const chartFilters = parseList(request.nextUrl.searchParams, "chart");
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
        if (!song || !chartToken || !matchesSpecialFeedFilters(song, chartToken, filters)) return [];
        return [{
          ...song,
          recommendedChartToken: chartToken,
          recentPlay: {
            chartToken,
            score: play.score,
            grade: play.grade,
          },
        }];
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
  if (query.toLowerCase() === "recommendation") {
    if (!user) {
      return NextResponse.json({ error: "Sign in required to view recommendations." }, { status: 401 });
    }

    const offset = Math.max(0, Number.parseInt(request.nextUrl.searchParams.get("cursor") ?? "0", 10) || 0);
    const recommendationLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 35) : 24;
    const version = normalizePiuGameVersion(user.preferences.piuGameVersion);
    const preferredModes = chartModesFromFilters(chartFilters);
    const candidateSongs = await getRecommendationCandidateSongs(version);
    const filters = {
      folders: parseList(request.nextUrl.searchParams, "folder"),
      series: parseList(request.nextUrl.searchParams, "series"),
      levels: parseList(request.nextUrl.searchParams, "level"),
      charts: chartFilters,
      levelMode: parseLevelMode(request.nextUrl.searchParams.get("levelMode")),
    };
    const ranked = await getPerformanceChartRecommendations(
      user.id,
      version,
      candidateSongs,
      preferredModes.length > 0 ? preferredModes : ["S"],
      filters.levels,
    );
    const candidatesByTitle = new Map(candidateSongs.map((song) => [songLookupKey(song.title), song]));
    const recommendations = ranked.flatMap((recommendation) => {
      const song = candidatesByTitle.get(songLookupKey(recommendation.songName));
      const chartToken = song?.chartSummary.find((chart) => chart.toUpperCase() === recommendation.chartToken.toUpperCase()) ?? null;
      if (!song || !chartToken || !matchesSpecialFeedFilters(song, chartToken, filters)) return [];
      return [{ title: song.title, chartToken }];
    });
    const pageRecommendations = recommendations.slice(offset, offset + recommendationLimit);
    const songsByTitle = await getSongsByTitles(version, pageRecommendations.map((recommendation) => recommendation.title));
    const page = pageRecommendations.flatMap((recommendation) => {
      const song = songsByTitle.get(songLookupKey(recommendation.title));
      if (!song) return [];
      return [{ ...song, recommendedChartToken: recommendation.chartToken, recommendation: { chartToken: recommendation.chartToken } }];
    });
    const favoriteSlugs = await getFavoriteSongSlugSet(user, page.map((song) => song.slug));

    return NextResponse.json({
      songs: page.map((song) => ({ ...song, isFavorite: favoriteSlugs.has(song.slug) })),
      nextCursor: offset + pageRecommendations.length < recommendations.length ? String(offset + pageRecommendations.length) : null,
      total: recommendations.length,
      filterOptions: { folders: [], series: [], levels: [], charts: [] },
    }, { headers: { "Cache-Control": "private, no-store" } });
  }
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

async function userForRequest(request: NextRequest): Promise<{ user: PublicUser | null; invalidToken: boolean }> {
  const authorization = request.headers.get("authorization");
  if (authorization === null) {
    return { user: await getCurrentUser(), invalidToken: false };
  }

  const accessToken = bearerTokenFromAuthorization(authorization);
  const identity = await authenticateMobileAccessToken(accessToken);
  const user = identity ? await getUserById(identity.userId) : null;
  return user ? { user, invalidToken: false } : { user: null, invalidToken: true };
}

function chartTokenForRecentPlay(
  chartSummary: string[],
  play: { mode: string | null; level: string | null },
): string | null {
  const token = catalogChartTokenFromPlay(play);
  if (!token) return null;

  return chartSummary.find((chart) => chart.toUpperCase() === token) ?? null;
}

function matchesSpecialFeedFilters(
  song: { chartSummary: string[]; folder: string | null; series: string | null },
  chartToken: string,
  filters: { folders: string[]; series: string[]; levels: string[]; charts: string[]; levelMode: LevelFilterMode },
): boolean {
  const sameText = (values: string[], candidate: string | null) => values.length === 0 || values.some((value) => value.localeCompare(candidate ?? "", undefined, { sensitivity: "accent" }) === 0);
  if (!sameText(filters.folders, song.folder) || !sameText(filters.series, song.series)) return false;
  const songMatches = songMatchesChartFilters(song, filters.levels, filters.charts, filters.levelMode);
  const selectedTokenMatches = songMatchesChartFilters({ chartSummary: [chartToken] }, filters.levels, filters.charts, "or");
  return songMatches && selectedTokenMatches;
}

function songLookupKey(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}
