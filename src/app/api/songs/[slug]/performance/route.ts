import { type NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { getSongBySlug } from "@/lib/catalog";
import { getSongChartPerformance } from "@/lib/performance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const song = await getSongBySlug(slug);
  if (!song) {
    return NextResponse.json({ error: "Song not found." }, { status: 404 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ performance: null }, { headers: { "Cache-Control": "private, no-store" } });
  }

  const chartToken = normalizeChartToken(request.nextUrl.searchParams.get("chart") ?? undefined, song.chartSummary);
  const performance = await getSongChartPerformance(user.id, { songName: song.title, chartToken });

  return NextResponse.json(
    { performance },
    {
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}

function normalizeChartToken(value: string | undefined, availableTokens: string[]): string | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  return availableTokens.find((token) => token.toUpperCase() === normalized) ?? null;
}
