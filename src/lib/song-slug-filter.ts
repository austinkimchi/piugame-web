export function songsMatchingSlugs<T extends { slug: string }>(songs: T[], includedSlugs: ReadonlySet<string>): T[] {
  return songs.filter((song) => includedSlugs.has(song.slug));
}
