import type { PublicSong } from "./types.ts";

// Advance this only after an official release and its catalog additions have
// been verified. A future teaser or a chart-only update does not make a song new.
export const LATEST_CATALOG_RELEASE = {
  version: "phoenix2",
  patch: "v1.02.0",
  date: "2026-10-15",
  label: "PHOENIX 2 v1.02.0",
} as const;

export function isLatestReleaseSong(song: Pick<PublicSong, "history" | "supportedVersions" | "removedFromVersions">): boolean {
  const release = LATEST_CATALOG_RELEASE;
  return song.supportedVersions.includes(release.version)
    && !song.removedFromVersions.includes(release.version)
    && song.history.some((event) => event.type === "added"
      && event.version === release.version && event.date === release.date);
}
