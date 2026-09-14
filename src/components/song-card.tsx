"use client";

import Image from "next/image";
import Link from "next/link";
import { Crown, Radio, Star } from "lucide-react";
import { motion } from "motion/react";
import { type MouseEvent, useState } from "react";

import type { PublicSong } from "@/lib/types";

const CHART_GRID_COLUMNS = 4;
const MIN_CHART_GRID_SLOTS = 12;
const LONG_TITLE_LENGTH = 24;
const EXTRA_LONG_TITLE_LENGTH = 34;

interface SongCardProps {
  song: PublicSong;
  previewEnabled: boolean;
  isPreviewActive: boolean;
  sequence?: number;
  onOpen?: (song: PublicSong, chartToken?: string) => void;
  onPreviewStart: (song: PublicSong) => void;
  onPreviewStop: () => void;
  showSingleChartToken?: boolean;
  showManualUploadState?: boolean;
}

export function SongCard({ song, previewEnabled, isPreviewActive, sequence = 0, onOpen, onPreviewStart, onPreviewStop, showSingleChartToken = false }: SongCardProps) {
  const [loadedImageUrl, setLoadedImageUrl] = useState<string | null>(null);
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const imageLoaded = !song.imageUrl || loadedImageUrl === song.imageUrl;
  const imageFailed = Boolean(song.imageUrl && failedImageUrl === song.imageUrl);
  const imageVisible = !song.imageUrl || imageFailed || imageLoaded;
  const chartGridSlots = Math.max(
    MIN_CHART_GRID_SLOTS,
    Math.ceil(song.chartSummary.length / CHART_GRID_COLUMNS) * CHART_GRID_COLUMNS,
  );
  const emptyChartSlots = chartGridSlots - song.chartSummary.length;
  const titleSizeClass =
    song.title.length > EXTRA_LONG_TITLE_LENGTH
      ? "text-[11px] sm:text-xs"
      : song.title.length > LONG_TITLE_LENGTH
        ? "text-xs sm:text-[13px]"
        : "text-[13px] sm:text-sm";

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!onOpen || event.defaultPrevented || event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) {
      return;
    }

    event.preventDefault();
    onPreviewStop();
    onOpen(song);
  }

  function handlePreviewClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();

    if (isPreviewActive) {
      onPreviewStop();
      return;
    }

    onPreviewStart(song);
  }

  function handleChartClick(event: MouseEvent<HTMLButtonElement>, chart: string) {
    if (!onOpen || event.defaultPrevented || event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onPreviewStop();
    onOpen(song, chart);
  }

  const entryDelay = Math.min(sequence, 9) * 0.036;

  return (
    <motion.div
      className="h-full"
      initial={{ opacity: 0, y: 16, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: entryDelay, duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
      layout
    >
      <motion.article
        className="song-card-surface group relative flex h-full flex-col overflow-hidden border border-[#d6ddcf] bg-white shadow-[0_10px_30px_rgba(30,34,26,0.06)] transition-colors duration-300 ease-out hover:border-[#28c950] focus-within:border-[#28c950]"
        data-preview-active={isPreviewActive ? "true" : "false"}
        onMouseEnter={() => {
          if (supportsPreviewHover()) {
            onPreviewStart(song);
          }
        }}
        onMouseLeave={() => {
          if (supportsPreviewHover()) {
            onPreviewStop();
          }
        }}
        whileHover={{ y: -5, scale: 1.025 }}
        whileFocus={{ y: -5, scale: 1.025 }}
        whileTap={{ scale: 0.985 }}
        transition={{ type: "spring", stiffness: 360, damping: 25 }}
      >
        <Link
          className="absolute inset-0 z-10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#28c950]/45"
          href={`/songs/${song.slug}`}
          onBlur={onPreviewStop}
          onFocus={() => {
            if (supportsPreviewHover()) {
              onPreviewStart(song);
            }
          }}
          onClick={handleClick}
          aria-label={`Open ${song.title}`}
        />
        <div className="relative aspect-square bg-[#e8ece1]">
          {song.imageUrl && !imageFailed ? (
            <Image
              alt={`${song.title} jacket`}
              className={`song-card-image object-cover transition duration-500 ease-in-out ${imageVisible ? "song-image-enter opacity-100" : "opacity-0"}`}
              fill
              onError={() => {
                setFailedImageUrl(song.imageUrl);
              }}
              onLoad={() => {
                setLoadedImageUrl(song.imageUrl);
              }}
              quality={92}
              sizes="(min-width: 1280px) 320px, (min-width: 1024px) 260px, (min-width: 768px) 240px, (min-width: 640px) 30vw, 33vw"
              src={song.imageUrl}
            />
          ) : (
            <div className="flex h-full items-center justify-center px-3 text-center text-sm font-bold text-[#687260]">
              No jacket
            </div>
          )}
          <motion.div
            aria-hidden="true"
            className="song-card-glint"
            initial={false}
            animate={isPreviewActive ? { opacity: [0.16, 0.48, 0.16] } : { opacity: 0 }}
            transition={{ duration: 1.1, repeat: isPreviewActive ? Infinity : 0, ease: "easeInOut" }}
          />
          {song.previewAvailable ? (
            <motion.button
              aria-label={isPreviewActive ? `Stop preview for ${song.title}` : previewEnabled ? `Play preview for ${song.title}` : `Song previews are muted for ${song.title}`}
              className={`audio-pill absolute left-2 top-2 z-20 inline-flex size-6 md:size-8 items-center justify-center shadow-[0_10px_24px_rgba(30,34,26,0.18)] disabled:cursor-not-allowed ${
                isPreviewActive
                  ? "bg-[#28c950]/90 text-white"
                  : previewEnabled
                    ? "bg-white/90 text-[#1f5f39]"
                    : "bg-[#eef1e8]/90 text-[#687260]"
              }`}
              disabled={!previewEnabled}
              onClick={handlePreviewClick}
              title={isPreviewActive ? "Stop preview" : previewEnabled ? "Play preview" : "Song previews are muted"}
              type="button"
              animate={isPreviewActive ? { scale: [1, 1.08, 1] } : { scale: 1 }}
              transition={{ duration: 1.2, repeat: isPreviewActive ? Infinity : 0, ease: "easeInOut" }}
            >
              <Radio size={13} />
            </motion.button>
          ) : null}
          {song.isFavorite || song.isPremium || song.series === "Phoenix 2" ? (
            <motion.div
              className="pointer-events-none absolute right-2 top-2 z-20 flex items-center gap-1"
              initial={{ opacity: 0, y: -8, rotate: 2 }}
              animate={{ opacity: 1, y: 0, rotate: 0 }}
              transition={{ delay: entryDelay + 0.16, type: "spring", stiffness: 420, damping: 22 }}
            >
              {song.isFavorite ? (
                <span className="song-favorite-badge inline-flex h-6 min-w-6 items-center justify-center bg-[#fff4cf]/95 px-1 text-[#9b6412] shadow-[0_10px_24px_rgba(155,100,18,0.22)]">
                  <Star aria-hidden="true" fill="currentColor" size={13} />
                </span>
              ) : null}
              {song.isPremium ? (
                <span
                  aria-label="Premium song"
                  className="inline-flex h-6 items-center gap-1 bg-[#171916]/95 px-2 text-[10px] font-black uppercase text-[#ffca6d] shadow-[0_10px_24px_rgba(23,25,22,0.24)]"
                  title="Premium song"
                >
                  <Crown aria-hidden="true" size={12} />
                  Premium
                </span>
              ) : null}
              {song.series === "Phoenix 2" ? (
                <span className="song-new-badge bg-[#e3412f]/95 px-2 py-1 text-[11px] font-black uppercase text-white">
                  NEW
                </span>
              ) : null}
            </motion.div>
          ) : null}
          {song.chartSummary.length > 0 ? (
            <>
              <span className="pointer-events-none absolute bottom-2 right-2 z-20 bg-[#f5f7f0]/90 px-1.5 py-1 text-[10px] font-black uppercase leading-none text-[#263020] shadow-[0_2px_8px_rgba(0,0,0,0.16)] sm:hidden">
                {showSingleChartToken && song.chartSummary.length === 1 ? song.chartSummary[0] : `${song.chartSummary.length} ${song.chartSummary.length === 1 ? "chart" : "charts"}`}
              </span>
              <div className="pointer-events-none absolute bottom-2 right-2 z-20 hidden grid-cols-4 gap-1 sm:grid">
                {Array.from({ length: emptyChartSlots }, (_, index) => (
                  <span key={`empty-${index}`} aria-hidden="true" className="min-h-6 min-w-8" />
                ))}
                {song.chartSummary.map((chart, index) => (
                  <motion.button
                    key={`${chart}-${index}`}
                    className="song-chart-chip pointer-events-auto flex min-h-6 min-w-8 items-center justify-center border border-white/60 bg-[#f5f7f0]/75 px-[0px] text-[11px] font-bold text-[#263020] shadow-[0_2px_8px_rgba(0,0,0,0.16)] transition hover:border-[#28c950] hover:bg-white focus:outline-none focus-visible:border-[#28c950] focus-visible:ring-2 focus-visible:ring-[#28c950]/35"
                    initial={{ opacity: 0, y: 8, scale: 0.9 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ delay: entryDelay + Math.min(index, 11) * 0.028, duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                    title={`Open ${song.title} ${chart}`}
                    type="button"
                    onClick={(event) => handleChartClick(event, chart)}
                  >
                    {chart}
                  </motion.button>
                ))}
              </div>
            </>
          ) : null}
        </div>
        <div className="flex min-h-16 flex-col p-3">
          <h2 className={`line-clamp-1 font-black leading-5 text-[#161914] ${titleSizeClass}`}>
            {song.title}
          </h2>
          <p className="mt-0.5 line-clamp-1 text-xs font-semibold leading-4 text-[#66705f]">{song.artist}</p>
          {song.previewAvailable ? (
            <span className="sr-only">{previewEnabled ? "Preview available" : "Preview muted"}</span>
          ) : null}
        </div>
      </motion.article>
    </motion.div>
  );
}

function supportsPreviewHover(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(hover: hover)").matches;
}
