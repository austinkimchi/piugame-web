import { BarChart3, LockKeyhole, TrendingUp, Zap } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

interface HomePerformanceSummaryProps {
  averageBestScore: number | null;
  averageBestScoreChangeThisWeek: number | null;
  canSync: boolean;
  pumbility: number | null;
  pumbilityChangeThisWeek: number | null;
  synced: boolean;
  upscoresThisWeek: number;
  upscoresToday: number;
}

export function HomePerformanceSummary({ averageBestScore, averageBestScoreChangeThisWeek, canSync, pumbility, pumbilityChangeThisWeek, synced, upscoresThisWeek, upscoresToday }: HomePerformanceSummaryProps) {
  const showToday = upscoresToday > 3;
  const upscoreLabel = showToday ? "Upscores today" : "Upscores this week";
  const upscoreValue = showToday ? upscoresToday : upscoresThisWeek;

  return (
    <section className="border-b border-[#d9ded2] bg-[#fbfcf7]" aria-label="Performance summary">
      <div className="mx-auto max-w-7xl px-5 py-5 sm:px-8 lg:px-10">
        <div className="relative overflow-hidden border border-[#d9ded2] bg-white shadow-[0_14px_36px_rgba(29,35,24,0.05)]">
          <div className={synced ? "grid grid-cols-1 divide-y divide-[#e3e7dd] sm:grid-cols-3 sm:divide-x sm:divide-y-0" : "pointer-events-none grid select-none grid-cols-1 blur-sm sm:grid-cols-3"} aria-hidden={!synced}>
            <SummaryMetric detail={formatChange(pumbilityChangeThisWeek)} icon={<TrendingUp aria-hidden="true" size={17} />} label="Pumbility" value={formatNumber(pumbility)} />
            <SummaryMetric detail={formatChange(averageBestScoreChangeThisWeek)} icon={<BarChart3 aria-hidden="true" size={17} />} label="Average best" value={formatNumber(averageBestScore)} />
            <SummaryMetric icon={<Zap aria-hidden="true" size={17} />} label={upscoreLabel} value={formatNumber(upscoreValue)} />
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

function SummaryMetric({ detail, icon, label, value }: { detail?: string; icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex min-h-24 items-center gap-4 px-5 py-4">
      <span className="flex size-9 shrink-0 items-center justify-center bg-[#eef7ed] text-[#1f7a43]">{icon}</span>
      <div>
        <p className="text-xs font-black uppercase tracking-[0.14em] text-[#7a8471]">{label}</p>
        <p className="mt-1 text-2xl font-black leading-none tracking-tight text-[#171916]">{value}</p>
        {detail ? <p className="mt-1 text-xs font-bold text-[#1f7a43]">{detail}</p> : null}
      </div>
    </div>
  );
}

function formatChange(value: number | null): string | undefined {
  if (value === null) {
    return undefined;
  }

  return `${value > 0 ? "+" : ""}${formatNumber(value)} this week`;
}

function formatNumber(value: number | null): string {
  return value === null ? "—" : new Intl.NumberFormat("en-US").format(value);
}
