import { notFound } from "next/navigation";

import { AccountBar } from "@/components/account-bar";
import { HomeHero } from "@/components/home-hero";
import { SongExplorer } from "@/components/song-explorer";
import { getCurrentUser, getFavoriteSongSlugSet, isAdmin } from "@/lib/auth";
import { getCatalogFilterOptions, searchSongs } from "@/lib/catalog";
import { DEFAULT_CATALOG_SERIES, piuSeriesFromSlug, REMOVED_FROM_PHOENIX2_SLUG } from "@/lib/catalog-version";

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
  const [result, filterOptions, user] = await Promise.all([
    searchSongs({
      query: "",
      charts: ["singles"],
      supportedVersion,
      removedFromVersion,
      sortBy: "series",
      sortDirection: "desc",
    }),
    getCatalogFilterOptions(supportedVersion, {}, undefined, removedFromVersion),
    getCurrentUser(),
  ]);
  const favoriteSlugs = await getFavoriteSongSlugSet(user, result.songs.map((song) => song.slug));
  const songsWithFavorites = result.songs.map((song) => ({ ...song, isFavorite: favoriteSlugs.has(song.slug) }));
  return (
    <main className="min-h-screen bg-[#f7f8f2] text-[#171916]">
      <HomeHero accountSlot={<AccountBar />} />
      <SongExplorer
        canFavorite={Boolean(user)}
        communityUser={user}
        catalogVersion={supportedVersion}
        featureSong={songsWithFavorites[0] ?? null}
        filterOptions={filterOptions}
        initialFavoritesFirst={user?.preferences.songExplorerFavoritesFirst ?? false}
        initialNextCursor={result.nextCursor}
        initialPreviewMuted={user?.preferences.songPreviewMuted ?? true}
        initialPreviewVolume={user?.preferences.songPreviewVolume ?? 0.5}
        initialSortBy={user?.preferences.songExplorerSortBy ?? "series"}
        initialSortDirection={user?.preferences.songExplorerSortDirection ?? "desc"}
        initialSongs={songsWithFavorites}
        initialTotalResults={result.total}
        removedFromVersion={removedFromVersion}
        showLanding={false}
        userIsAdmin={isAdmin(user)}
      />
    </main>
  );
}
