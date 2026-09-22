import type { MetadataRoute } from "next";

import { getSitemapSongs } from "@/lib/catalog";
import { absoluteSiteUrl } from "@/lib/site";

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
    {
      url: absoluteSiteUrl("/privacy"),
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.4,
    },
    ...songs.map((song) => ({
      url: absoluteSiteUrl(`/songs/${song.slug}`),
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.7,
      images: song.imageUrl ? [absoluteSiteUrl(song.imageUrl)] : undefined,
    })),
  ];
}
