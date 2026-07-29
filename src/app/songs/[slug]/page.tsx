import { ArrowLeft, Disc3, Music2, Tag } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { getSongBySlug } from "@/lib/catalog";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SongPageProps {
  params: Promise<{ slug: string }>;
}

export default async function SongPage({ params }: SongPageProps) {
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

  return (
    <main className="min-h-screen bg-[#f7f8f2] text-[#171916]">
      <section className="mx-auto grid max-w-6xl gap-8 px-5 py-8 sm:px-8 lg:grid-cols-[420px_minmax(0,1fr)] lg:px-10">
        <div>
          <Link className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-[#56604e] hover:text-[#e3412f]" href="/">
            <ArrowLeft aria-hidden="true" size={17} />
            Catalog
          </Link>
          <div className="relative aspect-square overflow-hidden border border-[#d6ddcf] bg-white shadow-[0_18px_55px_rgba(29,35,24,0.10)]">
            {song.imageUrl ? (
              <Image alt={`${song.title} jacket`} className="object-cover" fill priority sizes="420px" src={song.imageUrl} />
            ) : (
              <div className="flex h-full items-center justify-center font-bold text-[#66705f]">No jacket</div>
            )}
          </div>
        </div>

        <div className="pt-10">
          <div className="mb-4 inline-flex items-center gap-2 border border-[#cdd5c5] bg-white px-3 py-1.5 text-sm font-black uppercase text-[#596153]">
            <Disc3 aria-hidden="true" size={16} />
            {song.version === "phoenix2" ? "Pump It Up Phoenix 2" : "Pump It Up Phoenix"}
          </div>
          <h1 className="text-5xl font-black leading-none tracking-normal text-[#11130f] sm:text-7xl">{song.title}</h1>
          <p className="mt-4 text-2xl font-bold text-[#4f5849]">{song.artist}</p>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <InfoPanel label="Folder" value={song.folder ?? "Unassigned"} />
            <InfoPanel label="Series" value={song.series ?? "Unknown"} />
          </div>

          <section className="mt-8 border-y border-[#d9ded2] py-6">
            <div className="mb-3 flex items-center gap-2 text-sm font-black uppercase text-[#596153]">
              <Music2 aria-hidden="true" size={17} />
              Charts
            </div>
            <div className="flex flex-wrap gap-2">
              {song.chartSummary.length > 0 ? (
                song.chartSummary.map((chart) => (
                  <span key={chart} className="border border-[#d8dfd1] bg-white px-3 py-1.5 text-sm font-black text-[#3d4638]">
                    {chart}
                  </span>
                ))
              ) : (
                <p className="text-sm font-medium text-[#66705f]">Chart metadata is ready to appear here once available.</p>
              )}
            </div>
          </section>

          <section className="mt-6">
            <div className="mb-3 flex items-center gap-2 text-sm font-black uppercase text-[#596153]">
              <Tag aria-hidden="true" size={17} />
              Tags and History
            </div>
            <div className="flex flex-wrap gap-2">
              {song.tags.length > 0 ? (
                song.tags.map((tag) => (
                  <span key={tag} className="border border-[#d8dfd1] bg-white px-3 py-1.5 text-sm font-bold text-[#3d4638]">
                    {tag}
                  </span>
                ))
              ) : (
                <p className="text-sm font-medium text-[#66705f]">
                  Changelog entries, tags, and deeper infograph data can be layered into this page next.
                </p>
              )}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

function InfoPanel({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-[#d6ddcf] bg-white p-4">
      <div className="text-xs font-black uppercase text-[#778171]">{label}</div>
      <div className="mt-1 text-lg font-black text-[#171916]">{value}</div>
    </div>
  );
}
