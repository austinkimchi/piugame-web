import { AccountBar } from "@/components/account-bar";
import { HomeHero } from "@/components/home-hero";
import { HomePerformanceSummary } from "@/components/home-performance-summary";
import { SongExplorer } from "@/components/song-explorer";
import { getAllFavoriteSongSlugs, getCurrentUser, getFavoriteSongSlugSet, isAdmin } from "@/lib/auth";
import { getSongBySlug, searchSongs } from "@/lib/catalog";
import { piuSeriesMetadata } from "@/lib/catalog-version";
import { getPerformanceDashboard } from "@/lib/performance";
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
  const songs = catalogSearch.songs;
  const filterOptions = catalogSearch.filterOptions;
  const favoriteSlugs = await getFavoriteSongSlugSet(user, songs.map((song) => song.slug));
  const songsWithFavorites = songs.map((song) => ({ ...song, isFavorite: favoriteSlugs.has(song.slug) }));
  const catalog = piuSeriesMetadata(catalogVersion);
  const catalogFeatureSong = featuredSong?.supportedVersions.includes(catalogVersion) ? featuredSong : songsWithFavorites[0] ?? null;

  return (
    <main className="min-h-screen bg-[#f7f8f2] text-[#171916]">
      <HomeHero accountSlot={<AccountBar />} canChangeVersion={Boolean(user)} catalogLabel={catalog.label} catalogVersion={catalogVersion} />
      {user ? (
        <HomePerformanceSummary
          averageBestScore={performance.totals.averageBestScore}
          averageBestScoreChangeThisWeek={performance.totals.averageBestScoreChangeThisWeek}
          canSync={Boolean(user.piuProfile && performance.mongoReady)}
          pumbility={performance.profile?.pumbilityScore ?? null}
          pumbilityChangeThisWeek={performance.totals.pumbilityChangeThisWeek}
          synced={Boolean(performance.profile?.lastSyncedAt)}
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
                averageBestScoreChangeThisWeek: performance.totals.averageBestScoreChangeThisWeek,
                canSync: false,
                pumbility: performance.profile?.pumbilityScore ?? null,
                pumbilityChangeThisWeek: performance.totals.pumbilityChangeThisWeek,
                synced: false,
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
