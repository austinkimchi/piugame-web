"use client";

import { ArrowRight, BookmarkCheck, MessageSquareText, Search, Tags } from "lucide-react";
import dynamic from "next/dynamic";
import { motion } from "motion/react";

import type { PublicSong } from "@/lib/types";

const SongPopupModel = dynamic(
  () => import("@/components/song-popup-model").then((module) => module.SongPopupModel),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[420px] items-center justify-center border border-[#d9ded2] bg-[#fbfcf7] text-sm font-black uppercase text-[#66705f]">
        Building preview
      </div>
    ),
  },
);

const features = [
  {
    icon: Search,
    title: "Find charts fast",
    body: "Search by title, artist, folder, series, tag, or exact chart level.",
  },
  {
    icon: BookmarkCheck,
    title: "Save your rotation",
    body: "Favorite songs you are clearing, grinding, or saving for the next session.",
  },
  {
    icon: Tags,
    title: "Trust player context",
    body: "Community tags surface the patterns people actually feel under their feet.",
  },
  {
    icon: MessageSquareText,
    title: "Leave notes where they matter",
    body: "Attach goals, screenshots, and reminders directly to the song detail view.",
  },
];

export function GuestFeatureShowcase({
  featureSong,
  onExplore,
}: {
  featureSong: PublicSong | null;
  onExplore: () => void;
}) {
  return (
    <motion.section
      className="feature-showcase relative overflow-visible border-y border-[#d9ded2] bg-[#f3f6ef]"
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="relative z-10 mx-auto grid max-w-7xl gap-8 px-5 py-10 sm:px-8 lg:grid-cols-[minmax(330px,0.84fr)_minmax(0,1.16fr)] lg:items-center lg:px-10 lg:py-14">
        <div>
          <h2 className="max-w-2xl text-4xl font-black leading-none tracking-normal text-[#11130f] sm:text-5xl">
            Turn every song page into a personal PIU notebook.
          </h2>
          <p className="mt-5 max-w-xl text-base font-medium leading-7 text-[#56604e]">
            MyPIU combines the official-feeling catalog flow with the player context people usually keep scattered across screenshots, spreadsheets, and chat threads.
          </p>

          <div className="mt-7 grid gap-3">
            {features.map((feature, index) => {
              const Icon = feature.icon;

              return (
                <motion.article
                  key={feature.title}
                  className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-3 border border-[#d5ddce] bg-white/84 p-3 shadow-[0_10px_34px_rgba(25,32,22,0.06)] backdrop-blur"
                  initial={{ opacity: 0, x: -16 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.05, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                >
                  <span className="flex size-11 items-center justify-center border border-[#bfd2c1] bg-[#eaffef] text-[#1f7a43]">
                    <Icon aria-hidden="true" size={19} />
                  </span>
                  <span className="min-w-0">
                    <strong className="block text-sm font-black uppercase text-[#171916]">{feature.title}</strong>
                    <span className="mt-1 block text-sm font-medium leading-6 text-[#64705d]">{feature.body}</span>
                  </span>
                </motion.article>
              );
            })}
          </div>

          <div className="mt-7 flex flex-wrap gap-3">
            <motion.a
              className="inline-flex min-h-11 items-center gap-2 border border-[#171916] bg-[#171916] px-5 py-3 text-sm font-black text-white transition hover:bg-[#343b30]"
              href="/api/auth/google/login?next=/"
              whileHover={{ y: -3, scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
            >
              Sign in to build yours
              <ArrowRight aria-hidden="true" size={17} />
            </motion.a>
            <motion.button
              className="inline-flex min-h-11 items-center gap-2 border border-[#c5cfc0] bg-white px-5 py-3 text-sm font-black text-[#171916] transition hover:bg-[#eef1e8]"
              type="button"
              whileHover={{ y: -3, scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              onClick={onExplore}
            >
              Browse catalog
            </motion.button>
          </div>
        </div>

        <div className="relative mt-10 min-h-[560px] overflow-visible sm:mt-0 sm:min-h-[610px] lg:min-h-[640px]">
          <SongPopupModel song={featureSong} />
        </div>
      </div>
    </motion.section>
  );
}
