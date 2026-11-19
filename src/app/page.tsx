import { AccountBar } from "@/components/account-bar";
import { HomeHero } from "@/components/home-hero";
import { HomePerformanceRefresh } from "@/components/home-performance-refresh";
import { HomePerformanceSummary } from "@/components/home-performance-summary";
import { SongExplorer } from "@/components/song-explorer";
import { getAllFavoriteSongSlugs, getCurrentUser, isAdmin } from "@/lib/auth";
import { getCatalogPage } from "@/lib/catalog-page";
import { queryCatalog } from "@/lib/catalog-client-query";
import { catalogFavoriteSlugs } from "@/lib/catalog-private-overlay";
import { piuSeriesMetadata } from "@/lib/catalog-version";
import { getCatalogChartRecommendations, getPerformanceDashboard } from "@/lib/performance";
import { normalizePiuGameVersion } from "@/lib/piu-version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FEATURED_SHOWCASE_SONG_SLUG = process.env.FEATURED_SHOWCASE_SONG_SLUG ?? "freedom-dive-xi-phoenix2";

export default async function Home() {
  const user = await getCurrentUser();
  const catalogVersion = user ? normalizePiuGameVersion(user.preferences.piuGameVersion) : "phoenix2";
  const initialSortBy = user?.preferences.songExplorerSortBy ?? "series";
  const initialSortDirection = user?.preferences.songExplorerSortDirection ?? "desc";
  const initialFavoritesFirst = user?.preferences.songExplorerFavoritesFirst ?? false;
  const [catalogPage, performance, storedFavoriteSlugs] = await Promise.all([
    getCatalogPage(catalogVersion),
    getPerformanceDashboard(user?.id ?? null),
    getAllFavoriteSongSlugs(user),
  ]);
  const songs = catalogPage.songs;
  const favoriteSlugs = catalogFavoriteSlugs(songs, storedFavoriteSlugs);
  const featuredSong = songs.find((song) => song.slug === FEATURED_SHOWCASE_SONG_SLUG);
  const chartRecommendations = await getCatalogChartRecommendations(user?.id ?? null, catalogVersion, songs);
  const sortedSongs = queryCatalog(songs, { query: "", charts: ["singles"], sortBy: initialSortBy, sortDirection: initialSortDirection });
  const catalog = piuSeriesMetadata(catalogVersion);
  const catalogFeatureSong = featuredSong?.supportedVersions.includes(catalogVersion) ? featuredSong : sortedSongs.songs[0] ?? null;

  return (
    <main className="min-h-screen bg-[#f7f8f2] text-[#171916]">
      <HomeHero accountSlot={<AccountBar />} canChangeVersion={Boolean(user)} catalogLabel={catalog.label} catalogVersion={catalogVersion} />
      <HomePerformanceRefresh enabled={Boolean(user?.piuProfile && performance.mongoReady)} />
      {user ? (
        <HomePerformanceSummary
          averageBestScore={performance.totals.averageBestScore}
          averageBestScoreChange24Hours={performance.totals.averageBestScoreChange24Hours}
          canSync={Boolean(user.piuProfile && performance.mongoReady)}
          passedMaps={performance.profile?.clearCount ?? null}
          pumbility={performance.profile?.pumbilityScore ?? null}
          pumbilityChange24Hours={performance.totals.pumbilityChange24Hours}
          recentlyPlayed={performance.totals.recentlyPlayed}
          synced={Boolean(performance.profile?.lastSyncedAt)}
          upscoresThisMonth={performance.totals.upscoresThisMonth}
          upscoresThisWeek={performance.totals.upscoresThisWeek}
          upscoresToday={performance.totals.upscoresToday}
        />
      ) : null}
      <SongExplorer
        canFavorite={Boolean(user)}
        communityUser={user}
        catalogVersion={catalogVersion}
        featureSong={catalogFeatureSong}
        filterOptions={catalogPage.filterOptions}
        localCatalogPreview={catalogPage.localPreview}
        initialFavoriteSlugs={[...favoriteSlugs]}
        chartRecommendations={chartRecommendations}
        initialPreviewMuted={user?.preferences.songPreviewMuted ?? true}
        initialPreviewVolume={user?.preferences.songPreviewVolume ?? 0.5}
        initialFavoritesFirst={initialFavoritesFirst}
        initialSortBy={initialSortBy}
        initialSortDirection={initialSortDirection}
        initialSongs={songs}
        key={catalogVersion}
        guestPerformanceSummary={
          !user
            ? {
                averageBestScore: performance.totals.averageBestScore,
                averageBestScoreChange24Hours: performance.totals.averageBestScoreChange24Hours,
                canSync: false,
                passedMaps: performance.profile?.clearCount ?? null,
                pumbility: performance.profile?.pumbilityScore ?? null,
                pumbilityChange24Hours: performance.totals.pumbilityChange24Hours,
                recentlyPlayed: performance.totals.recentlyPlayed,
                synced: false,
                upscoresThisMonth: performance.totals.upscoresThisMonth,
                upscoresThisWeek: performance.totals.upscoresThisWeek,
                upscoresToday: performance.totals.upscoresToday,
              }
            : undefined
        }
        userIsAdmin={isAdmin(user)}
      />
    </main>
  );
}
