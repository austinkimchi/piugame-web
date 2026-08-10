import { NextResponse } from "next/server";

import { getCurrentUser, updateUserPreferences } from "@/lib/auth";
import { isPiuGameVersion } from "@/lib/piu-version";
import type { SongSortOption, SortDirection } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    performanceAutoRefresh?: boolean;
    piuGameVersion?: unknown;
    songDetailCompactView?: boolean;
    songPreviewMuted?: boolean;
    songPreviewVolume?: number;
    songExplorerSortBy?: SongSortOption;
    songExplorerSortDirection?: SortDirection;
    songExplorerFavoritesFirst?: boolean;
  } | null;
  const preferences = {
    ...(typeof body?.performanceAutoRefresh === "boolean" ? { performanceAutoRefresh: body.performanceAutoRefresh } : {}),
    ...(isPiuGameVersion(body?.piuGameVersion) ? { piuGameVersion: body.piuGameVersion } : {}),
    ...(typeof body?.songDetailCompactView === "boolean" ? { songDetailCompactView: body.songDetailCompactView } : {}),
    ...(typeof body?.songPreviewMuted === "boolean" ? { songPreviewMuted: body.songPreviewMuted } : {}),
    ...(typeof body?.songPreviewVolume === "number" && Number.isFinite(body.songPreviewVolume) ? { songPreviewVolume: body.songPreviewVolume } : {}),
    ...(isSongExplorerSortBy(body?.songExplorerSortBy) ? { songExplorerSortBy: body.songExplorerSortBy } : {}),
    ...(isSongExplorerSortDirection(body?.songExplorerSortDirection) ? { songExplorerSortDirection: body.songExplorerSortDirection } : {}),
    ...(typeof body?.songExplorerFavoritesFirst === "boolean" ? { songExplorerFavoritesFirst: body.songExplorerFavoritesFirst } : {}),
  };

  if (Object.keys(preferences).length === 0) {
    return NextResponse.json({ error: "Missing preference." }, { status: 400 });
  }

  try {
    const updatedUser = await updateUserPreferences(user, preferences);
    return NextResponse.json(
      { preferences: updatedUser.preferences },
      {
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save preference." }, { status: 400 });
  }
}

function isSongExplorerSortBy(value: unknown): value is SongSortOption {
  return value === "series" || value === "title" || value === "artist" || value === "folder";
}

function isSongExplorerSortDirection(value: unknown): value is SortDirection {
  return value === "asc" || value === "desc";
}
