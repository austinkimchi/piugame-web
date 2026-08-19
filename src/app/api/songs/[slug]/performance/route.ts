import { type NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { getSongChartPerformance } from "@/lib/performance";
import { normalizePiuGameVersion } from "@/lib/piu-version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  await params;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ performance: null }, { headers: { "Cache-Control": "private, no-store" } });
  }

  const songName = request.nextUrl.searchParams.get("songName")?.trim();
  if (!songName) {
    return NextResponse.json({ error: "Song name is required." }, { status: 400 });
  }

  const chartToken = normalizeChartToken(request.nextUrl.searchParams.get("chart") ?? undefined);
  const piuVersion = normalizePiuGameVersion(request.nextUrl.searchParams.get("version"));
  const performance = await getSongChartPerformance(user.id, { songName, chartToken, piuVersion });

  return NextResponse.json(
    { performance },
    {
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}

function normalizeChartToken(value: string | undefined): string | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  return /^(?:S|D|C(?:X)?)\d{1,2}[+-]?$/.test(normalized) ? normalized : null;
}
