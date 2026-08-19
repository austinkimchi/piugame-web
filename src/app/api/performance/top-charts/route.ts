import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { getSongsByTitles } from "@/lib/catalog";
import { getPerformanceTopCharts, type PerformanceTopChartsSort } from "@/lib/performance";
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
  const requestedSort = request.nextUrl.searchParams.get("sort");
  const page = await getPerformanceTopCharts(user.id, {
    offset: Number.isFinite(offset) ? offset : 0,
    limit: Number.isFinite(limit) ? limit : 35,
    sort: requestedSort === "score" ? "score" : ("pumbility" satisfies PerformanceTopChartsSort),
  });
  const songsByTitle = await getSongsByTitles(
    normalizePiuGameVersion(user.preferences.piuGameVersion),
    page.topCharts.map((chart) => chart.songName),
  );

  return NextResponse.json(
    {
      ...page,
      topCharts: page.topCharts.map((chart) => ({
        ...chart,
        song: songsByTitle.get(songLookupKey(chart.songName)) ?? null,
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
