"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef } from "react";

import type { PublicSong } from "@/lib/types";

interface SongCardProps {
  song: PublicSong;
  previewEnabled: boolean;
}

export function SongCard({ song, previewEnabled }: SongCardProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  async function playPreview() {
    if (!previewEnabled || !song.previewUrl || !audioRef.current) {
      return;
    }

    audioRef.current.currentTime = 0;
    try {
      await audioRef.current.play();
    } catch {
      // Browsers may block autoplay even after hover; the card should still feel responsive.
    }
  }

  function stopPreview() {
    if (!audioRef.current) {
      return;
    }
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
  }

  return (
    <Link
      className="group block focus:outline-none"
      href={`/songs/${song.slug}`}
      onBlur={stopPreview}
      onFocus={() => void playPreview()}
      onMouseEnter={() => void playPreview()}
      onMouseLeave={stopPreview}
    >
      <article className="h-full overflow-hidden border border-[#d6ddcf] bg-white shadow-[0_10px_30px_rgba(30,34,26,0.06)] transition duration-200 group-hover:-translate-y-1 group-hover:scale-[1.025] group-hover:border-[#e3412f] group-hover:shadow-[0_18px_44px_rgba(30,34,26,0.14)] group-focus-visible:-translate-y-1 group-focus-visible:scale-[1.025] group-focus-visible:border-[#e3412f]">
        <div className="relative aspect-square bg-[#e8ece1]">
          {song.imageUrl ? (
            <Image
              alt={`${song.title} jacket`}
              className="object-cover"
              fill
              sizes="(min-width: 1280px) 16vw, (min-width: 768px) 25vw, 50vw"
              src={song.imageUrl}
            />
          ) : (
            <div className="flex h-full items-center justify-center px-3 text-center text-sm font-bold text-[#687260]">
              No jacket
            </div>
          )}
          {song.series === "Phoenix 2" ? (
            <div className="absolute right-2 top-2 bg-[#e3412f]/95 px-2 py-1 text-[11px] font-black uppercase text-white">
              Phoenix 2
            </div>
          ) : null}
        </div>
        <div className="p-3">
          <h2 className="line-clamp-2 min-h-[2.5rem] text-sm font-black leading-5 text-[#161914]">
            {song.title}
          </h2>
          <p className="mt-1 truncate text-xs font-semibold text-[#66705f]">{song.artist}</p>
          <div className="mt-3 flex min-h-6 flex-wrap gap-1">
            {song.chartSummary.slice(0, 4).map((chart) => (
              <span key={chart} className="border border-[#d8dfd1] bg-[#f5f7f0] px-1.5 py-0.5 text-[11px] font-bold text-[#3d4638]">
                {chart}
              </span>
            ))}
            {song.previewAvailable ? (
              <span className="border border-[#f0b5ae] bg-[#fff1ef] px-1.5 py-0.5 text-[11px] font-bold text-[#9b2b1f]">
                audio
              </span>
            ) : null}
          </div>
        </div>
      </article>
      {song.previewUrl ? <audio ref={audioRef} preload="none" src={song.previewUrl} /> : null}
    </Link>
  );
}
