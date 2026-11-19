"use client";

import { BarChart3, Clock3, LockKeyhole, TrendingUp, Zap } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useMemo, useState } from "react";

import { homeUpscoreMetric, homeUpscoreMetrics } from "@/lib/performance-upscore-summary";

interface HomePerformanceSummaryProps {
  averageBestScore: number | null;
  averageBestScoreChange24Hours: number | null;
  canSync: boolean;
  pumbility: number | null;
  pumbilityChange24Hours: number | null;
  recentlyPlayed: number;
  synced: boolean;
  passedMaps: number | null;
  upscoresThisMonth: number;
  upscoresThisWeek: number;
  upscoresToday: number;
}

export function HomePerformanceSummary({ averageBestScore, averageBestScoreChange24Hours, canSync, passedMaps, pumbility, pumbilityChange24Hours, recentlyPlayed, synced, upscoresThisMonth, upscoresThisWeek, upscoresToday }: HomePerformanceSummaryProps) {
  const upscoreArgs = useMemo(() => ({ passedMaps, upscoresThisMonth, upscoresThisWeek, upscoresToday }), [passedMaps, upscoresThisMonth, upscoresThisWeek, upscoresToday]);
  const defaultUpscoreMetric = homeUpscoreMetric(upscoreArgs);
  const upscoreMetrics = homeUpscoreMetrics(upscoreArgs);
  const [selectedUpscoreKey, setSelectedUpscoreKey] = useState(defaultUpscoreMetric.key);
  const upscoreMetric = upscoreMetrics.find((metric) => metric.key === selectedUpscoreKey) ?? defaultUpscoreMetric;
  const openRecentCatalog = () => window.dispatchEvent(new Event("piu:open-recent-catalog"));
  const openRecommendations = () => window.dispatchEvent(new Event("piu:open-recommendations"));
  const showNextUpscoreMetric = () => {
    if (upscoreMetrics.length < 2) return;
    const currentIndex = upscoreMetrics.findIndex((metric) => metric.key === upscoreMetric.key);
    setSelectedUpscoreKey(upscoreMetrics[(currentIndex + 1) % upscoreMetrics.length].key);
  };

  return (
    <section className="border-b border-[#d9ded2] bg-[#fbfcf7]" aria-label="Performance summary">
      <div className="mx-auto max-w-7xl px-5 py-5 sm:px-8 lg:px-10">
        <div className="relative overflow-hidden border border-[#d9ded2] bg-white shadow-[0_14px_36px_rgba(29,35,24,0.05)]">
          <div className={synced ? "grid grid-cols-1 divide-y divide-[#e3e7dd] sm:grid-cols-2 sm:divide-x sm:divide-y lg:grid-cols-4 lg:divide-y-0" : "pointer-events-none grid select-none grid-cols-1 blur-sm sm:grid-cols-2 lg:grid-cols-4"} aria-hidden={!synced}>
            <SummaryMetric detail={format24HourChange(pumbilityChange24Hours)} icon={<TrendingUp aria-hidden="true" size={17} />} label="Pumbility" value={formatNumber(pumbility)} />
            <SummaryMetric onClick={openRecommendations} detail={format24HourChange(averageBestScoreChange24Hours)} icon={<BarChart3 aria-hidden="true" size={17} />} label="Average best" value={formatNumber(averageBestScore)} />
            <SummaryMetric onClick={upscoreMetrics.length > 1 ? showNextUpscoreMetric : undefined} icon={<Zap aria-hidden="true" size={17} />} label={upscoreMetric.label} value={formatNumber(upscoreMetric.value)} />
            <SummaryMetric onClick={openRecentCatalog} detail="View all play history" icon={<Clock3 aria-hidden="true" size={17} />} label="Latest session" value={`${formatNumber(recentlyPlayed)} ${recentlyPlayed === 1 ? "play" : "plays"}`} />
          </div>
          {!synced ? (
            <div className="absolute inset-0 flex items-center justify-center bg-white/65 px-4 backdrop-blur-[2px]">
              {canSync ? (
                <form action="/api/performance/sync" method="post">
                  <button className="inline-flex min-h-11 items-center gap-2 bg-[#171916] px-4 text-sm font-black text-white transition hover:bg-[#28c950]" type="submit">
                    <LockKeyhole aria-hidden="true" size={16} />
                    Sync to view stats
                  </button>
                </form>
              ) : (
                <Link className="inline-flex min-h-11 items-center gap-2 bg-[#171916] px-4 text-sm font-black text-white transition hover:bg-[#28c950]" href="/performance">
                  <LockKeyhole aria-hidden="true" size={16} />
                  Sync to view stats
                </Link>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function SummaryMetric({ detail, icon, label, onClick, value }: { detail?: ReactNode; icon: ReactNode; label: string; onClick?: () => void; value: string }) {
  const content = (
    <>
      <span className="flex size-9 shrink-0 items-center justify-center bg-[#eef7ed] text-[#1f7a43]">{icon}</span>
      <div>
        <p className="text-xs font-black uppercase tracking-[0.14em] text-[#7a8471]">{label}</p>
        <p className="mt-1 text-2xl font-black leading-none tracking-tight text-[#171916]">{value}</p>
        {detail ? <p className="mt-1 text-xs font-bold text-[#1f7a43]">{detail}</p> : null}
      </div>
    </>
  );

  if (onClick) {
    return <button className="flex min-h-24 w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-[#f5f8f1]" type="button" onClick={onClick}>{content}</button>;
  }

  return (
    <div className="flex min-h-24 items-center gap-4 px-5 py-4">
      {content}
    </div>
  );
}

function format24HourChange(value: number | null): ReactNode | undefined {
  if (value === null) {
    return undefined;
  }

  return (
    <>
      <span className={value < 0 ? "text-[#c2413a]" : undefined}>{value > 0 ? "+" : ""}{formatNumber(value)}</span>
      <span className="text-[#8a9482]"> · 24h</span>
    </>
  );
}

function formatNumber(value: number | null): string {
  return value === null ? "—" : new Intl.NumberFormat("en-US").format(value);
}
