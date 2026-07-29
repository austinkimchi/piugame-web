import { Music2, Search, Sparkles } from "lucide-react";

import { SongExplorer } from "@/components/song-explorer";
import { getLandingSongs } from "@/lib/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Home() {
  const songs = await getLandingSongs();

  return (
    <main className="min-h-screen bg-[#f7f8f2] text-[#171916]">
      <section className="border-b border-[#d9ded2] bg-[#fbfcf7]">
        <div className="mx-auto flex min-h-[42vh] max-w-7xl flex-col justify-end px-5 pb-8 pt-16 sm:px-8 lg:px-10">
          <div className="mb-7 flex flex-wrap items-center gap-3 text-sm font-medium text-[#596153]">
            <span className="inline-flex items-center gap-2 border border-[#cdd5c5] bg-white px-3 py-1.5">
              <Music2 aria-hidden="true" size={16} />
              Pump It Up archive
            </span>
            <span className="inline-flex items-center gap-2 border border-[#cdd5c5] bg-white px-3 py-1.5">
              <Sparkles aria-hidden="true" size={16} />
              Phoenix + Phoenix 2
            </span>
          </div>
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end">
            <div>
              <h1 className="max-w-4xl text-5xl font-black leading-[0.95] tracking-normal text-[#11130f] sm:text-7xl">
                Pump song history, one jacket at a time.
              </h1>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-[#4f5849]">
                A living catalog for Pump It Up songs, chart snapshots, version history,
                changelogs, and tags.
              </p>
            </div>
            <div className="border-l-4 border-[#e3412f] bg-white p-5 shadow-[0_18px_55px_rgba(29,35,24,0.08)]">
              <div className="flex items-center gap-3 text-sm font-semibold uppercase tracking-normal text-[#596153]">
                <Search aria-hidden="true" size={17} />
                Catalog controls
              </div>
              <p className="mt-3 text-sm leading-6 text-[#56604e]">
                Search is intentionally paged and field-limited. The database stays on the
                server; the browser only receives display-ready song cards.
              </p>
            </div>
          </div>
        </div>
      </section>

      <SongExplorer initialSongs={songs} />
    </main>
  );
}
