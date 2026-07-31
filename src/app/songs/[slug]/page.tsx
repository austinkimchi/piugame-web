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

export async function generateMetadata({ params }: SongPageProps): Promise<Metadata> {
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

  const title = `${song.title} by ${song.artist}`;
  const charts = song.chartSummary.length > 0 ? ` Charts: ${song.chartSummary.slice(0, 12).join(", ")}.` : "";
  const description = `${song.title} by ${song.artist} in the ${siteName} Pump It Up catalog.${charts}`;
  const image = song.imageUrl ? absoluteSiteUrl(song.imageUrl) : absoluteSiteUrl(sitePreviewImage.path);
  const imageAlt = song.imageUrl ? `${song.title} jacket art` : sitePreviewImage.alt;

  return {
    title,
    description,
    alternates: {
      canonical: `/songs/${song.slug}`,
    },
    openGraph: {
      title,
      description,
      url: `/songs/${song.slug}`,
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

  return (
    <main className="min-h-screen bg-[#f7f8f2] text-[#171916]">
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
