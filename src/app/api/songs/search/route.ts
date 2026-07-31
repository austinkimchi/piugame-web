import { type NextRequest, NextResponse } from "next/server";

import { checkRateLimit } from "@/lib/rate-limit";
import { searchSongs } from "@/lib/catalog";
import { getAllFavoriteSongSlugs, getCurrentUser, getFavoriteSongSlugSet } from "@/lib/auth";
import type { LevelFilterMode, SongSortOption, SortDirection } from "@/lib/types";

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

export async function GET(request: NextRequest) {
  if (!checkRateLimit(clientKey(request))) {
    return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 });
  }

  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const limit = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "24", 10);
  const user = await getCurrentUser();
  const favoritesFirst = parseBoolean(request.nextUrl.searchParams.get("favoritesFirst"));
  const favoriteSlugsForSort = favoritesFirst ? await getAllFavoriteSongSlugs(user) : undefined;
  const result = await searchSongs({
    query,
    cursor: request.nextUrl.searchParams.get("cursor"),
    limit: Number.isFinite(limit) ? limit : 24,
    folders: parseList(request.nextUrl.searchParams, "folder"),
    series: parseList(request.nextUrl.searchParams, "series"),
    levels: parseList(request.nextUrl.searchParams, "level"),
    charts: parseList(request.nextUrl.searchParams, "chart"),
    levelMode: parseLevelMode(request.nextUrl.searchParams.get("levelMode")),
    sortBy: parseSortOption(request.nextUrl.searchParams.get("sortBy")),
    sortDirection: parseSortDirection(request.nextUrl.searchParams.get("sortDirection")),
    favoriteSlugs: favoriteSlugsForSort,
  });
  const favoriteSlugs = favoriteSlugsForSort ?? (await getFavoriteSongSlugSet(user, result.songs.map((song) => song.slug)));
  const resultWithFavorites = {
    ...result,
    songs: result.songs.map((song) => ({ ...song, isFavorite: favoriteSlugs.has(song.slug) })),
  };

  return NextResponse.json(resultWithFavorites, {
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}
