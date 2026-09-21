import type { PiuCatalogVersion, PiuSeriesId } from "@/lib/types";

export const PREMIUM_SONG_TITLES_BY_VERSION = {
  phoenix: [
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
  ],
  phoenix2: ["Legendary Dominion", "QUATTUORUX", "L (PIU EDIT)"],
} as const satisfies Record<PiuCatalogVersion, readonly string[]>;

const PREMIUM_SONG_TITLE_INDEXES: Record<PiuCatalogVersion, Set<string>> = {
  phoenix: new Set(PREMIUM_SONG_TITLES_BY_VERSION.phoenix.map(normalizeSongTitle)),
  phoenix2: new Set(PREMIUM_SONG_TITLES_BY_VERSION.phoenix2.map(normalizeSongTitle)),
};

export function isPremiumSong(title: string, version: PiuSeriesId): boolean {
  if (version !== "phoenix" && version !== "phoenix2") {
    return false;
  }

  return PREMIUM_SONG_TITLE_INDEXES[version].has(normalizeSongTitle(title));
}

function normalizeSongTitle(title: string): string {
  return title.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
}
