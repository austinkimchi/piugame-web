import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { getSongsByTitles } from "@/lib/catalog";
import { getPerformanceRecentPlays } from "@/lib/performance";
import { normalizePiuGameVersion } from "@/lib/piu-version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const offset = Number.parseInt(request.nextUrl.searchParams.get("offset") ?? "0", 10);
  const limit = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "35", 10);
  const page = await getPerformanceRecentPlays(user.id, {
    offset: Number.isFinite(offset) ? offset : 0,
    limit: Number.isFinite(limit) ? limit : 35,
    sortDirection: request.nextUrl.searchParams.get("sortDirection") === "asc" ? "asc" : "desc",
  });
  const songsByTitle = await getSongsByTitles(
    normalizePiuGameVersion(user.preferences.piuGameVersion),
    page.recentPlays.map((play) => play.songName),
  );

  return NextResponse.json(
    {
      ...page,
      recentPlays: page.recentPlays.map((play) => ({
        ...play,
        song: songsByTitle.get(songLookupKey(play.songName)) ?? null,
      })),
    },
    {
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}

function songLookupKey(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}
