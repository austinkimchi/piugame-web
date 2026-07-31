import { AccountBar } from "@/components/account-bar";
import { HomeHero } from "@/components/home-hero";
import { SongExplorer } from "@/components/song-explorer";
import { getCurrentUser, getFavoriteSongSlugSet, isAdmin } from "@/lib/auth";
import { getCatalogFilterOptions, getLandingSongs, getSongBySlug } from "@/lib/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FEATURED_SHOWCASE_SONG_SLUG = process.env.FEATURED_SHOWCASE_SONG_SLUG ?? "freedom-dive-xi-phoenix2";

export default async function Home() {
  const [songs, filterOptions, user, featuredSong] = await Promise.all([
    getLandingSongs(),
    getCatalogFilterOptions("phoenix2"),
    getCurrentUser(),
    getSongBySlug(FEATURED_SHOWCASE_SONG_SLUG),
  ]);
  const favoriteSlugs = await getFavoriteSongSlugSet(user, songs.map((song) => song.slug));
  const songsWithFavorites = songs.map((song) => ({ ...song, isFavorite: favoriteSlugs.has(song.slug) }));

  return (
    <main className="min-h-screen bg-[#f7f8f2] text-[#171916]">
      <HomeHero accountSlot={<AccountBar />} />
      <SongExplorer
        canFavorite={Boolean(user)}
        featureSong={featuredSong}
        filterOptions={filterOptions}
        initialPreviewMuted={user?.preferences.songPreviewMuted ?? true}
        initialPreviewVolume={user?.preferences.songPreviewVolume ?? 0.5}
        initialSortBy={user?.preferences.songExplorerSortBy ?? "series"}
        initialSortDirection={user?.preferences.songExplorerSortDirection ?? "desc"}
        initialFavoritesFirst={user?.preferences.songExplorerFavoritesFirst ?? false}
        initialSongs={songsWithFavorites}
        userIsAdmin={isAdmin(user)}
      />
    </main>
  );
}
