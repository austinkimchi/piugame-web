import { notFound } from "next/navigation";

import { AccountBar } from "@/components/account-bar";
import { HomeHero } from "@/components/home-hero";
import { SongExplorer } from "@/components/song-explorer";
import { getCurrentUser, getAllFavoriteSongSlugs, isAdmin } from "@/lib/auth";
import { getCatalogPage } from "@/lib/catalog-page";
import { queryCatalog } from "@/lib/catalog-client-query";
import { catalogFavoriteSlugs } from "@/lib/catalog-private-overlay";
import { DEFAULT_CATALOG_SERIES, piuSeriesFromSlug, REMOVED_FROM_PHOENIX2_SLUG } from "@/lib/catalog-version";
import { getCatalogChartRecommendations } from "@/lib/performance";
import { performanceVersionForCatalog } from "@/lib/piu-version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CatalogSeriesPageProps {
  params: Promise<{ series: string }>;
}

export default async function CatalogSeriesPage({ params }: CatalogSeriesPageProps) {
  const { series: seriesSlug } = await params;
  const removedFromPhoenix2 = seriesSlug === REMOVED_FROM_PHOENIX2_SLUG;
  const series = removedFromPhoenix2 ? null : piuSeriesFromSlug(seriesSlug);
  if (!series && !removedFromPhoenix2) {
    notFound();
  }

  const supportedVersion = series?.id ?? DEFAULT_CATALOG_SERIES;
  const removedFromVersion = removedFromPhoenix2 ? DEFAULT_CATALOG_SERIES : undefined;
  const [catalogPage, user] = await Promise.all([
    getCatalogPage(supportedVersion, { removed: removedFromPhoenix2 }),
    getCurrentUser(),
  ]);
  const performanceVersion = performanceVersionForCatalog(supportedVersion, removedFromVersion);
  const songs = catalogPage.songs;
  const [chartRecommendations, storedFavoriteSlugs] = await Promise.all([
    getCatalogChartRecommendations(user?.id ?? null, performanceVersion, songs),
    getAllFavoriteSongSlugs(user),
  ]);
  const favoriteSlugs = catalogFavoriteSlugs(songs, storedFavoriteSlugs);
  const initialSortBy = user?.preferences.songExplorerSortBy ?? "series";
  const initialSortDirection = user?.preferences.songExplorerSortDirection ?? "desc";
  const sortedSongs = queryCatalog(songs, { query: "", charts: ["singles"], sortBy: initialSortBy, sortDirection: initialSortDirection });
  return (
    <main className="min-h-screen bg-[#f7f8f2] text-[#171916]">
      <HomeHero accountSlot={<AccountBar />} />
      <SongExplorer
        canFavorite={Boolean(user)}
        communityUser={user}
        catalogVersion={supportedVersion}
        featureSong={sortedSongs.songs[0] ?? null}
        filterOptions={catalogPage.filterOptions}
        localCatalogPreview={catalogPage.localPreview}
        initialFavoriteSlugs={[...favoriteSlugs]}
        chartRecommendations={chartRecommendations}
        initialFavoritesFirst={user?.preferences.songExplorerFavoritesFirst ?? false}
        initialPreviewMuted={user?.preferences.songPreviewMuted ?? true}
        initialPreviewVolume={user?.preferences.songPreviewVolume ?? 0.5}
        initialSortBy={initialSortBy}
        initialSortDirection={initialSortDirection}
        initialSongs={songs}
        removedFromVersion={removedFromVersion}
        showLanding={false}
        userIsAdmin={isAdmin(user)}
      />
    </main>
  );
}
