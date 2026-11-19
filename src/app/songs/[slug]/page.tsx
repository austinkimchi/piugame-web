import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { SongDetailView } from "@/components/song-detail-view";
import { getCurrentUser, getSongCommunityState, isAdmin } from "@/lib/auth";
import { getSongBySlug } from "@/lib/catalog";
import { chartCommunityKey } from "@/lib/chart-community";
import { piuSeriesMetadata } from "@/lib/catalog-version";
import { requestedSongVersion, selectedSongChart, songPagePath, songPageVersion } from "@/lib/song-page-url";
import type { PiuSeriesId } from "@/lib/types";
import { normalizePiuGameVersion } from "@/lib/piu-version";
import { checkRateLimit } from "@/lib/rate-limit";
import { absoluteSiteUrl, siteName, sitePreviewImage } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SongPageProps {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ chart?: string | string[]; version?: string | string[] }>;
}

const getPublicSongPage = cache(async (slug: string, requestedVersion: PiuSeriesId) => {
  const baseSong = await getSongBySlug(slug, requestedVersion);
  if (!baseSong) return null;
  const catalogVersion = songPageVersion(baseSong, requestedVersion);
  const song = catalogVersion === requestedVersion ? baseSong : await getSongBySlug(slug, catalogVersion);
  return song ? { song, catalogVersion } : null;
});

export async function generateMetadata({ params, searchParams }: SongPageProps): Promise<Metadata> {
  const { slug } = await params;
  const query = await searchParams;
  const page = await getPublicSongPage(slug, requestedSongVersion(query?.version));

  if (!page) {
    return {
      title: "Song Not Found",
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  const { song, catalogVersion } = page;
  const selectedChart = selectedSongChart(query?.chart, song.chartSummary);
  const versionLabel = piuSeriesMetadata(catalogVersion).label;
  const title = `${song.title}${selectedChart ? ` ${selectedChart}` : ""} by ${song.artist} · ${versionLabel}`;
  const charts = song.chartSummary.length > 0 ? ` Charts: ${song.chartSummary.slice(0, 12).join(", ")}.` : "";
  const description = `${song.title} by ${song.artist} in Pump It Up ${versionLabel} on ${siteName}.${selectedChart ? ` Selected chart: ${selectedChart}.` : ""}${charts}`;
  const canonicalPath = songPagePath(song, catalogVersion);
  const sharePath = songPagePath(song, catalogVersion, selectedChart);
  const image = song.imageUrl ? absoluteSiteUrl(song.imageUrl) : absoluteSiteUrl(sitePreviewImage.path);
  const imageAlt = song.imageUrl ? `${song.title} jacket art` : sitePreviewImage.alt;

  return {
    title,
    description,
    alternates: {
      canonical: canonicalPath,
    },
    openGraph: {
      title,
      description,
      url: sharePath,
      siteName,
      images: [
        {
          url: image,
          ...(song.imageUrl
            ? {}
            : {
                width: sitePreviewImage.width,
                height: sitePreviewImage.height,
                type: sitePreviewImage.type,
              }),
          alt: imageAlt,
        },
      ],
      type: "music.song",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: {
        url: image,
        alt: imageAlt,
      },
    },
  };
}

export default async function SongPage({ params, searchParams }: SongPageProps) {
  const requestHeaders = await headers();
  const key = `${requestHeaders.get("x-forwarded-for") ?? "local"}:${requestHeaders.get("user-agent") ?? "unknown"}:detail`;
  if (!checkRateLimit(key)) {
    notFound();
  }

  const { slug } = await params;
  const query = await searchParams;
  const page = await getPublicSongPage(slug, requestedSongVersion(query?.version));
  if (!page) {
    notFound();
  }
  const { song, catalogVersion } = page;
  const user = await getCurrentUser();
  const selectedChart = selectedSongChart(query?.chart, song.chartSummary);
  const communityChart = selectedChart ?? song.chartSummary[0] ?? null;
  const communityState = await getSongCommunityState(user, song.slug, communityChart, chartCommunityKey(song, catalogVersion, communityChart));

  return (
    <main className="min-h-screen bg-[#f7f8f2] text-[#171916]">
      <SongDetailView
        key={`${song.slug}:${catalogVersion}:${selectedChart ?? "song"}`}
        song={song}
        community={{
          user,
          initialState: communityState,
        }}
        initialSelectedChartToken={selectedChart}
        catalogVersion={catalogVersion}
        performanceVersion={normalizePiuGameVersion(catalogVersion)}
        userIsAdmin={isAdmin(user)}
      />
    </main>
  );
}
