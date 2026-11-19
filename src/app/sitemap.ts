import type { MetadataRoute } from "next";

import { getPublicCatalogSnapshot } from "@/lib/public-catalog";
import { absoluteSiteUrl } from "@/lib/site";

// Builds intentionally have no database credentials. Resolve the real public
// catalog at request time, reusing its shared cache and write invalidation.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { songs } = await getPublicCatalogSnapshot("phoenix2");

  return [
    {
      url: absoluteSiteUrl("/"),
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: absoluteSiteUrl("/privacy"),
      changeFrequency: "yearly",
      priority: 0.4,
    },
    ...songs.map((song) => ({
      url: absoluteSiteUrl(`/songs/${song.slug}`),
      changeFrequency: "weekly" as const,
      priority: 0.7,
      images: song.imageUrl ? [absoluteSiteUrl(song.imageUrl)] : undefined,
    })),
  ];
}
