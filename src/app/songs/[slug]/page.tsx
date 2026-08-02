import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { SongDetailView } from "@/components/song-detail-view";
import { getCurrentUser, getSongCommunityState, isAdmin } from "@/lib/auth";
import { getSongBySlug } from "@/lib/catalog";
import { checkRateLimit } from "@/lib/rate-limit";
import { absoluteSiteUrl, siteName, sitePreviewImage } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SongPageProps {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ chart?: string | string[] }>;
}

function songChartPath(slug: string, chart: string): string {
  const params = new URLSearchParams({ chart });
  return `/songs/${slug}?${params.toString()}`;
}

export async function generateMetadata({ params, searchParams }: SongPageProps): Promise<Metadata> {
  const { slug } = await params;
  const song = await getSongBySlug(slug);

  if (!song) {
    return {
      title: "Song Not Found",
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  const selectedChart = normalizeSelectedChart((await searchParams)?.chart, song.chartSummary);
  const title = selectedChart ? `${song.title} ${selectedChart} by ${song.artist}` : `${song.title} by ${song.artist}`;
  const charts = song.chartSummary.length > 0 ? ` Charts: ${song.chartSummary.slice(0, 12).join(", ")}.` : "";
  const selectedChartSentence = selectedChart ? ` Featured chart token: ${selectedChart}.` : "";
  const description = `${song.title} by ${song.artist} in the ${siteName} Pump It Up catalog.${selectedChartSentence}${charts}`;
  const image = song.imageUrl ? absoluteSiteUrl(song.imageUrl) : absoluteSiteUrl(sitePreviewImage.path);
  const imageAlt = song.imageUrl ? `${song.title} jacket art` : sitePreviewImage.alt;
  const canonicalPath = selectedChart ? songChartPath(song.slug, selectedChart) : `/songs/${song.slug}`;

  return {
    title,
    description,
    keywords: [
      song.title,
      song.artist,
      siteName,
      "Pump It Up",
      "PIU",
      "Pump It Up Phoenix 2",
      ...song.chartSummary,
    ],
    alternates: {
      canonical: canonicalPath,
    },
    openGraph: {
      title,
      description,
      url: canonicalPath,
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
  const song = await getSongBySlug(slug);
  if (!song) {
    notFound();
  }
  const user = await getCurrentUser();
  const selectedChart = normalizeSelectedChart((await searchParams)?.chart, song.chartSummary);
  const communityState = await getSongCommunityState(user, song.slug, selectedChart ?? song.chartSummary[0] ?? null);
  const pageUrl = absoluteSiteUrl(selectedChart ? songChartPath(song.slug, selectedChart) : `/songs/${song.slug}`);
  const imageUrl = song.imageUrl ? absoluteSiteUrl(song.imageUrl) : undefined;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "MusicRecording",
    name: song.title,
    byArtist: {
      "@type": "MusicGroup",
      name: song.artist,
    },
    url: pageUrl,
    image: imageUrl,
    inLanguage: "en",
    genre: "Pump It Up",
    isPartOf: {
      "@type": "WebSite",
      name: siteName,
      url: absoluteSiteUrl("/"),
    },
    identifier: selectedChart,
    additionalProperty: song.chartSummary.map((chart) => ({
      "@type": "PropertyValue",
      name: "PIU chart token",
      value: chart,
      url: absoluteSiteUrl(songChartPath(song.slug, chart)),
    })),
  };

  return (
    <main className="min-h-screen bg-[#f7f8f2] text-[#171916]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <SongDetailView
        song={song}
        community={{
          user,
          initialState: communityState,
        }}
        initialSelectedChartToken={selectedChart}
        userIsAdmin={isAdmin(user)}
      />
    </main>
  );
}

function normalizeSelectedChart(value: string | string[] | undefined, chartSummary: string[]): string | null {
  const chart = Array.isArray(value) ? value[0] : value;
  return chart && chartSummary.includes(chart) ? chart : null;
}
