import { AccountBar } from "@/components/account-bar";
import { HomeHero } from "@/components/home-hero";
import { SongExplorer } from "@/components/song-explorer";
import { getCurrentUser, getFavoriteSongSlugSet } from "@/lib/auth";
import { getCatalogFilterOptions, getLandingSongs } from "@/lib/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Home() {
  const [songs, filterOptions, user] = await Promise.all([getLandingSongs(), getCatalogFilterOptions("phoenix2"), getCurrentUser()]);
  const favoriteSlugs = await getFavoriteSongSlugSet(user, songs.map((song) => song.slug));
  const songsWithFavorites = songs.map((song) => ({ ...song, isFavorite: favoriteSlugs.has(song.slug) }));

  return (
    <main className="min-h-screen bg-[#f7f8f2] text-[#171916]">
      <HomeHero accountSlot={<AccountBar />} />
      <SongExplorer canFavorite={Boolean(user)} filterOptions={filterOptions} initialSongs={songsWithFavorites} />
    </main>
  );
}
