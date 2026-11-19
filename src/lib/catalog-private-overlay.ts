import type { PublicSong } from "./types.ts";

type CatalogIdentity = Pick<PublicSong, "slug" | "version">;

/** getSongBySlug/POST community retain this pre-snapshot storage identity. */
export function catalogCommunitySlug(song: CatalogIdentity): string {
  return song.version === "phoenix" ? song.slug.replace(/-phoenix$/, "-phoenix2") : song.slug;
}

/** Keep private stored keys as well as public aliases; never mutate the snapshot. */
export function catalogFavoriteSlugs(catalog: readonly CatalogIdentity[], stored: ReadonlySet<string>): Set<string> {
  const favorites = new Set(stored);
  for (const song of catalog) {
    const storageSlug = catalogCommunitySlug(song);
    if (stored.has(storageSlug) || stored.has(song.slug)) {
      favorites.add(storageSlug);
      favorites.add(song.slug);
    }
  }
  return favorites;
}

/** Reconcile responses/toggles from either public catalog or legacy private feed. */
export function updateCatalogFavoriteSlugs(current: ReadonlySet<string>, catalog: readonly CatalogIdentity[], slug: string, saved: boolean): Set<string> {
  const source = catalog.find((song) => song.slug === slug);
  const storageSlug = source ? catalogCommunitySlug(source) : slug;
  const aliases = new Set([slug, storageSlug]);
  for (const song of catalog) {
    if (catalogCommunitySlug(song) === storageSlug) aliases.add(song.slug);
  }
  const next = new Set(current);
  for (const alias of aliases) {
    if (saved) next.add(alias);
    else next.delete(alias);
  }
  return next;
}
