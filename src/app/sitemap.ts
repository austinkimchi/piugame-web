import type { MetadataRoute } from "next";

import { getSitemapSongs } from "@/lib/catalog";
import { absoluteSiteUrl } from "@/lib/site";

function chartUrl(slug: string, chart: string): string {
  const params = new URLSearchParams({ chart });
  return absoluteSiteUrl(`/songs/${slug}?${params.toString()}`);
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const songs = await getSitemapSongs();

  return [
    {
      url: absoluteSiteUrl("/"),
      lastModified: now,
      changeFrequency: "daily",
      priority: 1,
    },
    ...songs.flatMap((song) => {
      const images = song.imageUrl ? [absoluteSiteUrl(song.imageUrl)] : undefined;
      const songEntry = {
        url: absoluteSiteUrl(`/songs/${song.slug}`),
        lastModified: now,
        changeFrequency: "weekly" as const,
        priority: 0.7,
        images,
      };
      const chartEntries = song.chartSummary.map((chart) => ({
        url: chartUrl(song.slug, chart),
        lastModified: now,
        changeFrequency: "weekly" as const,
        priority: 0.65,
        images,
      }));

      return [songEntry, ...chartEntries];
    }),
  ];
}
