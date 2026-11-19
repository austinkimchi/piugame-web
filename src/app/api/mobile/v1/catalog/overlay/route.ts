import { NextResponse } from "next/server";

import { getAllFavoriteSongSlugs, getUserById } from "@/lib/auth";
import { catalogFavoriteSlugs } from "@/lib/catalog-private-overlay";
import type { CatalogChartRecommendations } from "@/lib/chart-recommendation";
import { authenticateMobileAccessToken } from "@/lib/mobile-auth";
import { bearerTokenFromAuthorization } from "@/lib/mobile-auth-core";
import type { MobileCatalogOverlay } from "@/lib/mobile-catalog-overlay-types";
import { getCatalogChartRecommendations } from "@/lib/performance";
import { isPiuGameVersion } from "@/lib/piu-version";
import { getPublicCatalogSnapshot } from "@/lib/public-catalog";
import type { PublicCatalogSong } from "@/lib/public-catalog-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const accessToken = bearerTokenFromAuthorization(request.headers.get("authorization"));
    const identity = await authenticateMobileAccessToken(accessToken);
    if (!identity) return errorResponse("invalid_token", 401);

    const user = await getUserById(identity.userId);
    if (!user) return errorResponse("invalid_token", 401);

    const query = new URL(request.url).searchParams;
    const versions = query.getAll("version");
    const version = versions[0];
    if (versions.length !== 1 || !isPiuGameVersion(version)) return errorResponse("invalid_version", 400);
    if (query.has("removed")) return errorResponse("invalid_view", 400);

    const [snapshot, storedFavorites] = await Promise.all([
      getPublicCatalogSnapshot(version),
      getAllFavoriteSongSlugs(user),
    ]);
    const favorites = catalogFavoriteSlugs(snapshot.songs, storedFavorites);
    const recommendations = await getCatalogChartRecommendations(identity.userId, version, snapshot.songs);
    const overlay: MobileCatalogOverlay = {
      schemaVersion: 1,
      version,
      favoriteSlugs: [...new Set(snapshot.songs.filter((song) => favorites.has(song.slug)).map((song) => song.slug))].sort(),
      recommendations: recommendationTokens(snapshot.songs, recommendations),
    };
    return NextResponse.json(overlay, { headers: noStoreHeaders() });
  } catch {
    return errorResponse("catalog_overlay_unavailable", 503);
  }
}

// Serialize only the selected catalog's chart tokens. Recommendation selection
// stays in the shared helper; future internal evidence fields cannot leak here.
function recommendationTokens(songs: readonly PublicCatalogSong[], recommendations: CatalogChartRecommendations): CatalogChartRecommendations {
  return Object.fromEntries(songs.flatMap((song) => {
    const tokens = Object.entries(recommendations[song.slug] ?? {}).filter(([mode, token]) =>
      (mode === "all" || (/^[SDC]{1,3}$/.test(mode) && new Set(mode).size === mode.length)) &&
      (token === null || (typeof token === "string" && song.chartSummary.includes(token))),
    );
    return tokens.length ? [[song.slug, Object.fromEntries(tokens)]] : [];
  }));
}

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStoreHeaders() });
}

function noStoreHeaders() {
  return { "Cache-Control": "private, no-store", Pragma: "no-cache", Vary: "Authorization" };
}
