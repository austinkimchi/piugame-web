"use client";

import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { catalogGridWindow } from "@/lib/catalog-grid-window";

interface CatalogSongGridProps<T extends { slug: string }> {
  songs: T[];
  renderSong: (song: T, index: number) => ReactNode;
}

const FOCUSABLE = 'a[href],button:not([disabled]),[tabindex="0"]';

/** All data is local; only image-heavy cards near the viewport are mounted. */
export function CatalogSongGrid<T extends { slug: string }>({ songs, renderSong }: CatalogSongGridProps<T>) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ columns: 3, rowHeight: 200, gap: 0, top: 0, height: 800 });
  const [focusedSlug, setFocusedSlug] = useState<string | null>(null);
  const focusedIndex = songs.findIndex((song) => song.slug === focusedSlug);
  const indices = catalogGridWindow({ count: songs.length, columns: layout.columns, rowHeight: layout.rowHeight, viewportTop: layout.top, viewportHeight: layout.height, focusedIndex });

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    let frame = 0;
    const measure = () => {
      const bounds = grid.getBoundingClientRect();
      const columns = window.innerWidth >= 1280 ? 5 : window.innerWidth >= 768 ? 4 : 3;
      const gap = window.innerWidth >= 768 ? 12 : 0;
      // The card consists of a square jacket and its fixed 64px text block.
      const rowHeight = (bounds.width - (columns - 1) * gap) / columns + 64 + gap;
      const top = Math.max(0, Math.floor(-bounds.top / rowHeight) * rowHeight);
      const height = Math.ceil(window.innerHeight / rowHeight) * rowHeight;
      setLayout((current) => current.columns === columns && current.rowHeight === rowHeight && current.gap === gap && current.top === top && current.height === height
        ? current : { columns, rowHeight, gap, top, height });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(grid);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    const card = target.closest<HTMLElement>("[data-catalog-index]");
    if (!card) return;
    const focusable = [...card.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const boundary = event.shiftKey ? focusable[0] : focusable.at(-1);
    if (target !== boundary) return;
    const next = Number(card.dataset.catalogIndex) + (event.shiftKey ? -1 : 1);
    if (next < 0 || next >= songs.length || indices.includes(next)) return;
    event.preventDefault();
    // Mount the adjacent card before moving focus. This lets keyboard users
    // traverse the complete catalog even at the edge of the viewport window.
    flushSync(() => setFocusedSlug(songs[next].slug));
    const nextCard = gridRef.current?.querySelector<HTMLElement>(`[data-catalog-index="${next}"]`);
    const nextTargets = nextCard ? [...nextCard.querySelectorAll<HTMLElement>(FOCUSABLE)] : [];
    (event.shiftKey ? nextTargets.at(-1) : nextTargets[0])?.focus();
  }

  return (
    <div
      aria-label="Songs"
      className="grid"
      data-catalog-grid="complete"
      onFocusCapture={(event) => {
        const card = (event.target as HTMLElement).closest<HTMLElement>("[data-catalog-index]");
        if (card) setFocusedSlug(songs[Number(card.dataset.catalogIndex)]?.slug ?? null);
      }}
      onKeyDown={handleKeyDown}
      ref={gridRef}
      role="list"
      style={{
        gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
        gridTemplateRows: songs.length ? `repeat(${Math.ceil(songs.length / layout.columns)}, ${layout.rowHeight - layout.gap}px)` : undefined,
        gap: layout.gap,
      }}
    >
      {indices.map((index) => (
        <div
          aria-posinset={index + 1}
          aria-setsize={songs.length}
          className="min-w-0"
          data-catalog-index={index}
          key={songs[index].slug}
          role="listitem"
          style={{ gridColumn: index % layout.columns + 1, gridRow: Math.floor(index / layout.columns) + 1 }}
        >
          {renderSong(songs[index], index)}
        </div>
      ))}
    </div>
  );
}
