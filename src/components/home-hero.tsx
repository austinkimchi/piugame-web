"use client";

import { Search, Sparkles, Volume2 } from "lucide-react";
import { MotionConfig, motion, type Variants } from "motion/react";
import { useRouter } from "next/navigation";
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import type { PiuCatalogVersion } from "@/lib/types";
import { requestAccountPreferences } from "@/lib/account-preference-request";
import { manageVersionMenu } from "@/lib/version-menu-focus";

const VERSION_OPTIONS: Array<{ label: string; value: PiuCatalogVersion }> = [
  { label: "Phoenix", value: "phoenix" },
  { label: "PHOENIX 2", value: "phoenix2" },
];

const heroContainer: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.09,
    },
  },
};

const heroItem: Variants = {
  hidden: { opacity: 0, y: 18, filter: "blur(8px)" },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
  },
};

export function HomeHero({ accountSlot, canChangeVersion = false, catalogLabel = "PHOENIX 2", catalogVersion = "phoenix2" }: { accountSlot?: ReactNode; canChangeVersion?: boolean; catalogLabel?: string; catalogVersion?: PiuCatalogVersion }) {
  const router = useRouter();
  const [openVersionMenu, setOpenVersionMenu] = useState(false);
  const [savingVersion, setSavingVersion] = useState(false);
  const [versionError, setVersionError] = useState("");
  const [selectedVersion, setSelectedVersion] = useState(catalogVersion);
  const versionMenuId = useId();
  const versionTriggerRef = useRef<HTMLButtonElement>(null);
  const versionMenuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!openVersionMenu || !versionMenuRef.current || !versionTriggerRef.current) return;
    return manageVersionMenu(versionMenuRef.current, versionTriggerRef.current, () => setOpenVersionMenu(false));
  }, [openVersionMenu]);

  async function changeVersion(nextVersion: PiuCatalogVersion) {
    if (!canChangeVersion || nextVersion === selectedVersion || savingVersion) {
      return;
    }

    const previousVersion = selectedVersion;
    setSelectedVersion(nextVersion);
    setSavingVersion(true);
    setVersionError("");
    try {
      const result = await requestAccountPreferences({ piuGameVersion: nextVersion });
      if (!result.ok) {
        setSelectedVersion(previousVersion);
        setVersionError(result.error);
        return;
      }

      setOpenVersionMenu(false);
      router.refresh();
    } finally {
      setSavingVersion(false);
    }
  }

  return (
    <MotionConfig reducedMotion="user">
      <section className="hero-stage relative overflow-hidden border-b border-[#d9ded2] bg-[#fbfcf7]">
      <motion.div
        className="relative z-10 mx-auto flex min-h-[42vh] max-w-7xl flex-col justify-end px-5 pb-8 pt-5 sm:px-8 sm:pt-16 lg:px-10"
        initial="hidden"
        animate="visible"
        variants={heroContainer}
      >
        {accountSlot ? <div className="mb-7 flex justify-end sm:absolute sm:right-8 sm:top-5 sm:mb-0 lg:right-10">{accountSlot}</div> : null}
        <motion.div variants={heroItem} className="relative z-40 mb-7 flex flex-wrap items-center gap-3 text-sm font-medium text-[#596153]">
          <motion.span
            className="hero-chip inline-flex items-center gap-2 border border-[#cdd5c5] bg-white px-3 py-1.5"
            whileHover={{ y: -3, scale: 1.03 }}
            whileTap={{ scale: 0.98 }}
          >
            <Volume2 aria-hidden="true" size={16} />
            Supports Song Previews
          </motion.span>
          <motion.div
            className="hero-chip hero-chip-delayed relative ml-auto sm:ml-0"
            tabIndex={-1}
            whileHover={{ y: -3, scale: 1.03 }}
            whileTap={{ scale: 0.98 }}
          >
            <button
              aria-controls={openVersionMenu ? versionMenuId : undefined}
              aria-expanded={openVersionMenu}
              aria-haspopup="menu"
              className="inline-flex items-center gap-2 border border-[#cdd5c5] bg-white px-3 py-1.5 text-[#596153] transition hover:border-[#28c950] hover:text-[#1f7a43] focus:outline-none focus:ring-2 focus:ring-[#28c950]/45"
              onClick={() => setOpenVersionMenu((current) => !current)}
              onKeyDown={(event) => {
                if (!openVersionMenu && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                  event.preventDefault();
                  setOpenVersionMenu(true);
                }
              }}
              ref={versionTriggerRef}
              type="button"
            >
              <Sparkles aria-hidden="true" size={16} />
              {VERSION_OPTIONS.find((option) => option.value === selectedVersion)?.label ?? catalogLabel}
            </button>
            {openVersionMenu ? (
              <div
                className="absolute right-0 top-full z-30 min-w-40 border border-[#cdd5c5] bg-white p-1 shadow-[0_14px_34px_rgba(29,35,24,0.14)]"
                aria-label="Catalog version"
                id={versionMenuId}
                ref={versionMenuRef}
                role="menu"
              >
                {VERSION_OPTIONS.map((option) => {
                  const selected = option.value === selectedVersion;
                  return (
                    <button
                      aria-checked={selected}
                      className={`flex w-full items-center justify-between gap-4 px-3 py-2 text-left text-sm font-black transition ${selected ? "bg-[#ecfff0] text-[#1f7a43]" : "text-[#3d4638] hover:bg-[#f5f7f0]"} disabled:cursor-not-allowed disabled:opacity-55`}
                      disabled={!canChangeVersion || savingVersion}
                      key={option.value}
                      onClick={() => void changeVersion(option.value)}
                      role="menuitemradio"
                      tabIndex={-1}
                      type="button"
                    >
                      {option.label}
                      {selected ? <span aria-hidden="true">✓</span> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </motion.div>
          {versionError ? <p className="w-full text-sm font-bold text-[#9b2b1f]" role="alert">{versionError}</p> : null}
        </motion.div>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end">
          <motion.div variants={heroItem} className="hero-copy">
            <h1 className="hero-title max-w-4xl text-5xl font-black leading-[0.95] tracking-normal text-[#11130f] sm:text-7xl">
              MyPIU
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-[#4f5849]">
              A searchable Pump It Up catalog for charts, version history, and previews.
            </p>
          </motion.div>
          <motion.div
            variants={heroItem}
            className="hero-control-card border-l-4 border-[#28c950] bg-white p-5 shadow-[0_18px_55px_rgba(29,35,24,0.08)]"
            whileHover={{ y: -6, rotateX: 2 }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
          >
            <div className="flex items-center gap-3 text-sm font-semibold uppercase tracking-normal text-[#596153]">
              <Search aria-hidden="true" size={17} />
              {catalogLabel} Catalog
            </div>
            <p className="mt-3 text-sm leading-6 text-[#56604e]">
              Your personal notebook for the songs you are learning, clearing, and coming back to.
            </p>
          </motion.div>
        </div>
      </motion.div>
      </section>
    </MotionConfig>
  );
}
