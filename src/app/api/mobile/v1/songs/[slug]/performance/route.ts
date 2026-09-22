import { type NextRequest, NextResponse } from "next/server";

import { getSongBySlug } from "@/lib/catalog";
import { authenticateMobileAccessToken } from "@/lib/mobile-auth";
import { bearerTokenFromAuthorization } from "@/lib/mobile-auth-core";
import { getSongChartPerformance } from "@/lib/performance";
import { isPiuGameVersion } from "@/lib/piu-version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const accessToken = bearerTokenFromAuthorization(request.headers.get("authorization"));
  const identity = await authenticateMobileAccessToken(accessToken);
  if (!identity) {
    return errorResponse("invalid_token", 401);
  }

  const version = request.nextUrl.searchParams.get("version");
  if (!isPiuGameVersion(version)) {
    return errorResponse("invalid_version", 400);
  }

  const chartToken = normalizeChartToken(request.nextUrl.searchParams.get("chart"));
  if (!chartToken) {
    return errorResponse("invalid_chart", 400);
  }

  const { slug } = await params;
  const song = await getSongBySlug(slug, version);
  if (!song || !song.supportedVersions.includes(version)) {
    return errorResponse("song_not_found", 404);
  }
  if (!song.chartSummary.some((token) => token.toUpperCase() === chartToken)) {
    return errorResponse("chart_not_found", 404);
  }

  const performance = await getSongChartPerformance(identity.userId, {
    songName: song.title,
    chartToken,
    piuVersion: version,
  });

  return NextResponse.json({ performance }, { headers: noStoreHeaders() });
}

function normalizeChartToken(value: string | null): string | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  const match = /^(S|D|C(?:X)?)(\d{1,2}[+-]?)$/.exec(normalized);
  if (!match) {
    return null;
  }
  return `${match[1].startsWith("C") ? "C" : match[1]}${match[2]}`;
}

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStoreHeaders() });
}

function noStoreHeaders() {
  return { "Cache-Control": "private, no-store", Pragma: "no-cache" };
}
