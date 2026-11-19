import type { MetadataRoute } from "next";

import { getPublicCatalogSnapshot } from "@/lib/public-catalog";
import { catalogCommunitySlug } from "@/lib/catalog-private-overlay";
import { absoluteSiteUrl } from "@/lib/site";
import { songPagePath } from "@/lib/song-page-url";

// Builds intentionally have no database credentials. Resolve the real public
// catalog at request time, reusing its shared cache and write invalidation.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const snapshots = await Promise.all([
    getPublicCatalogSnapshot("phoenix2"),
    getPublicCatalogSnapshot("phoenix"),
  ]);
  const seen = new Set<string>();
  const songs: MetadataRoute.Sitemap = [];
  for (const snapshot of snapshots) {
    for (const song of snapshot.songs) {
      // Current songs take precedence. Add historical-only identities, not
      // every older version of a shared song or its transliterated alias.
      const identity = catalogCommunitySlug(song);
      if (seen.has(identity)) continue;
      seen.add(identity);
      songs.push({
        url: absoluteSiteUrl(songPagePath(song, snapshot.selectedVersion)),
        changeFrequency: "weekly",
        priority: 0.7,
        images: song.imageUrl ? [absoluteSiteUrl(song.imageUrl)] : undefined,
      });
    }
  }

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
    ...songs,
  ];
}
