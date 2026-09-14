export const PREMIUM_SONG_TITLES = [
  "1948",
  "Altale",
  "Appassionata",
  "CHAOS AGAIN",
  "Crimson hood",
  "Dead End",
  "E.O.N",
  "Etude Op 10-4",
  "Extreme Music School 2nd period feat. Nanahira",
  "Giselle",
  "Hymn of Golden Glory",
  "Imperium",
  "KUGUTSU",
  "Neo Catharsis",
  "PRiMA MATERiA",
  "PUPA",
  "Super Akuma Emperor",
  "TRICKL4SH 220",
  "Legendary Dominion",
  "QUATTUORUX",
  "L (PIU EDIT)",
] as const;

const PREMIUM_SONG_TITLE_INDEX = new Set(PREMIUM_SONG_TITLES.map(normalizeSongTitle));

export function isPremiumSong(title: string): boolean {
  return PREMIUM_SONG_TITLE_INDEX.has(normalizeSongTitle(title));
}

function normalizeSongTitle(title: string): string {
  return title.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
}
