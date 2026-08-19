import type { PiuSeriesId, PublicSong } from "@/lib/types";

export function chartCommunityKey(song: Pick<PublicSong, "chartLinks">, version: PiuSeriesId, chartToken: string | null | undefined): string | null {
  const token = String(chartToken ?? "").trim().toUpperCase();
  if (!token) return null;
  return song.chartLinks.find((link) => link.tokens[version]?.toUpperCase() === token)?.id ?? `${version}:${token}`;
}
