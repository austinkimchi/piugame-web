import { AccountBar } from "@/components/account-bar";
import { HomeHero } from "@/components/home-hero";
import { HomePerformanceRefresh } from "@/components/home-performance-refresh";
import { HomePerformanceSummary } from "@/components/home-performance-summary";
import { SongExplorer } from "@/components/song-explorer";
import { getAllFavoriteSongSlugs, getCurrentUser, getFavoriteSongSlugSet, isAdmin } from "@/lib/auth";
import { getSongBySlug, searchSongs } from "@/lib/catalog";
import { piuSeriesMetadata } from "@/lib/catalog-version";
import { addChartRecommendationsToSongs, getPerformanceDashboard } from "@/lib/performance";
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
  const favoriteSlugsForSort = initialFavoritesFirst ? await getAllFavoriteSongSlugs(user) : undefined;
  const [catalogSearch, featuredSong, performance] = await Promise.all([
    searchSongs({
      query: "",
      charts: ["singles"],
      sortBy: initialSortBy,
      sortDirection: initialSortDirection,
      favoriteSlugs: favoriteSlugsForSort,
      supportedVersion: catalogVersion,
    }),
    getSongBySlug(FEATURED_SHOWCASE_SONG_SLUG),
    getPerformanceDashboard(user?.id ?? null),
  ]);
  const songs = await addChartRecommendationsToSongs(user?.id ?? null, catalogVersion, catalogSearch.songs, ["S"]);
  const filterOptions = catalogSearch.filterOptions;
  const favoriteSlugs = await getFavoriteSongSlugSet(user, songs.map((song) => song.slug));
  const songsWithFavorites = songs.map((song) => ({ ...song, isFavorite: favoriteSlugs.has(song.slug) }));
  const catalog = piuSeriesMetadata(catalogVersion);
  const catalogFeatureSong = featuredSong?.supportedVersions.includes(catalogVersion) ? featuredSong : songsWithFavorites[0] ?? null;

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
        filterOptions={filterOptions}
        initialPreviewMuted={user?.preferences.songPreviewMuted ?? true}
        initialPreviewVolume={user?.preferences.songPreviewVolume ?? 0.5}
        initialFavoritesFirst={initialFavoritesFirst}
        initialNextCursor={catalogSearch.nextCursor}
        initialSortBy={initialSortBy}
        initialSortDirection={initialSortDirection}
        initialSongs={songsWithFavorites}
        initialTotalResults={catalogSearch.total}
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
