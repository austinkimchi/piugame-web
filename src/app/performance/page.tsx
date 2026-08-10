import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Activity, ArrowUpRight, BarChart3, Clock3, Database, RefreshCw, ShieldCheck, TrendingUp } from "lucide-react";

import { AccountBar } from "@/components/account-bar";
import { getCurrentUser, getCurrentUserId } from "@/lib/auth";
import { getPerformanceDashboard, type PerformanceDashboard } from "@/lib/performance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Performance",
  description: "Track Pump It Up play statistics, recent play history, and Pumbility movement.",
  alternates: {
    canonical: "/performance",
  },
};

export default async function PerformancePage() {
  const [user, userId] = await Promise.all([getCurrentUser(), getCurrentUserId()]);
  const dashboard = await getPerformanceDashboard(userId);

  return (
    <main className="min-h-screen bg-[#f7f8f2] text-[#171916]">
      <section className="border-b border-[#d9ded2] bg-[#fbfcf7]">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-5 py-6 sm:px-8 lg:px-10">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <Link className="text-sm font-black uppercase tracking-[0.18em] text-[#56604e] transition hover:text-[#171916]" href="/">
              MyPIU
            </Link>
            <AccountBar />
          </div>

          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end">
            <div className="max-w-3xl">
              <p className="mb-3 inline-flex items-center gap-2 border border-[#cdd5c5] bg-white px-3 py-2 text-xs font-black uppercase tracking-[0.16em] text-[#56604e]">
                <Activity aria-hidden="true" size={14} />
                Performance MVP
              </p>
              <h1 className="text-4xl font-black leading-[0.98] tracking-normal text-[#171916] sm:text-6xl">Play data that keeps up with serious sessions.</h1>
              <p className="mt-5 max-w-2xl text-base font-medium leading-7 text-[#56604e]">
                Recent plays, Pumbility, chart bests, and upscore history are stored in MongoDB with scheduler-ready refreshes.
              </p>
            </div>

            <div className="border border-[#cdd5c5] bg-white p-5 shadow-[0_16px_40px_rgba(29,35,24,0.07)]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-[#7a8471]">Sync status</p>
                  <p className="mt-2 text-2xl font-black text-[#171916]">{statusLabel(dashboard)}</p>
                </div>
                <span className="flex h-11 w-11 items-center justify-center bg-[#171916] text-white">
                  <RefreshCw aria-hidden="true" size={19} />
                </span>
              </div>
              <p className="mt-4 text-sm font-medium leading-6 text-[#56604e]">{statusDetail(user, dashboard)}</p>
              {dashboard.canSync ? (
                <form action="/api/performance/sync" className="mt-5" method="post">
                  <button className="inline-flex h-11 w-full items-center justify-center gap-2 bg-[#28c950] px-4 text-sm font-black text-[#071109] transition hover:bg-[#35d867]" type="submit">
                    <RefreshCw aria-hidden="true" size={16} />
                    Sync now
                  </button>
                </form>
              ) : (
                <Link className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 bg-[#171916] px-4 text-sm font-black text-white transition hover:bg-[#2f352b]" href="/">
                  <ArrowUpRight aria-hidden="true" size={16} />
                  Open account setup
                </Link>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-6 px-5 py-8 sm:px-8 lg:grid-cols-4 lg:px-10">
        <MetricCard icon={<TrendingUp aria-hidden="true" size={19} />} label="Pumbility" value={formatNumber(dashboard.profile?.pumbilityScore)} detail={formatNumber(dashboard.profile?.pp, "PP")} />
        <MetricCard icon={<BarChart3 aria-hidden="true" size={19} />} label="Tracked charts" value={formatNumber(dashboard.totals.trackedCharts)} detail={`${formatNumber(dashboard.totals.trackedPlays)} recent plays stored`} />
        <MetricCard icon={<ShieldCheck aria-hidden="true" size={19} />} label="Upscores" value={formatNumber(dashboard.totals.upscores)} detail="From chart best history" />
        <MetricCard icon={<Database aria-hidden="true" size={19} />} label="Average best" value={formatNumber(dashboard.totals.averageBestScore)} detail="Across tracked charts" />
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-6 px-5 pb-12 sm:px-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:px-10">
        <div className="border border-[#d9ded2] bg-white">
          <div className="flex items-center justify-between gap-4 border-b border-[#e4e8dd] px-5 py-4">
            <div>
              <h2 className="text-lg font-black text-[#171916]">Top tracked charts</h2>
              <p className="mt-1 text-sm font-medium text-[#66705e]">Best scores from ingested recent plays</p>
            </div>
            <BarChart3 aria-hidden="true" className="text-[#28c950]" size={22} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] border-collapse text-left">
              <thead className="bg-[#f2f4ed] text-xs font-black uppercase tracking-[0.14em] text-[#66705e]">
                <tr>
                  <th className="px-5 py-3">Chart</th>
                  <th className="px-5 py-3">Best</th>
                  <th className="px-5 py-3">Delta</th>
                  <th className="px-5 py-3">Grade</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edf0e8]">
                {dashboard.topCharts.length > 0 ? (
                  dashboard.topCharts.map((chart) => (
                    <tr key={chart.chartToken}>
                      <td className="px-5 py-4">
                        <p className="max-w-[22rem] truncate text-sm font-black text-[#171916]">{chart.songName}</p>
                        <p className="mt-1 text-xs font-bold text-[#66705e]">{chart.mode ?? "Mode"} {chart.level ?? ""}</p>
                      </td>
                      <td className="px-5 py-4 font-mono text-sm font-black text-[#171916]">{formatNumber(chart.bestScore)}</td>
                      <td className="px-5 py-4 text-sm font-black text-[#1b8f40]">{formatDelta(chart.delta)}</td>
                      <td className="px-5 py-4 text-sm font-black text-[#171916]">{chart.bestGrade ?? "Unranked"}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-5 py-10 text-sm font-bold text-[#66705e]" colSpan={4}>
                      No tracked chart scores yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="border border-[#d9ded2] bg-white">
          <div className="flex items-center justify-between gap-4 border-b border-[#e4e8dd] px-5 py-4">
            <div>
              <h2 className="text-lg font-black text-[#171916]">Recent plays</h2>
              <p className="mt-1 text-sm font-medium text-[#66705e]">{dashboard.profile?.recentArcade ?? "Phoenix 2"}</p>
            </div>
            <Clock3 aria-hidden="true" className="text-[#157bda]" size={22} />
          </div>
          <div className="divide-y divide-[#edf0e8]">
            {dashboard.recentPlays.length > 0 ? (
              dashboard.recentPlays.map((play) => (
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 px-5 py-4" key={`${play.chartToken}-${play.playedAt ?? play.score ?? "play"}`}>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-[#171916]">{play.songName}</p>
                    <p className="mt-1 text-xs font-bold text-[#66705e]">{play.mode ?? "Mode"} {play.level ?? ""} / {formatDate(play.playedAt)}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-sm font-black text-[#171916]">{formatNumber(play.score)}</p>
                    <p className="mt-1 text-xs font-black text-[#66705e]">{play.grade ?? play.plate ?? "Played"}</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="px-5 py-10 text-sm font-bold text-[#66705e]">No recent play snapshots yet.</p>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function MetricCard(props: { icon: ReactNode; label: string; value: string; detail: string }) {
  return (
    <div className="border border-[#d9ded2] bg-white p-5 shadow-[0_12px_30px_rgba(29,35,24,0.05)]">
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs font-black uppercase tracking-[0.14em] text-[#66705e]">{props.label}</p>
        <span className="text-[#28c950]">{props.icon}</span>
      </div>
      <p className="mt-5 font-mono text-3xl font-black text-[#171916]">{props.value}</p>
      <p className="mt-2 text-sm font-bold text-[#66705e]">{props.detail}</p>
    </div>
  );
}

function statusLabel(dashboard: PerformanceDashboard): string {
  if (!dashboard.mongoReady) {
    return "Database offline";
  }

  return dashboard.profile?.syncStatus ?? "Not connected";
}

function statusDetail(user: Awaited<ReturnType<typeof getCurrentUser>>, dashboard: PerformanceDashboard): string {
  if (!user) {
    return "Sign in to start collecting performance snapshots.";
  }

  if (!dashboard.mongoReady) {
    return "Set MONGODB_URI to enable performance storage.";
  }

  if (!user.piuProfile) {
    return "Link a PIU account to queue automatic refreshes.";
  }

  if (dashboard.profile?.syncError) {
    return dashboard.profile.syncError;
  }

  const nextRefresh = formatDate(dashboard.profile?.nextRefreshAt ?? null);
  return `Auto refresh is queued for all users during the MVP. Next refresh: ${nextRefresh}.`;
}

function formatNumber(value: number | null | undefined, suffix?: string): string {
  if (value === null || value === undefined) {
    return "-";
  }

  return `${new Intl.NumberFormat("en-US").format(value)}${suffix ? ` ${suffix}` : ""}`;
}

function formatDelta(value: number | null): string {
  if (value === null) {
    return "-";
  }

  return value > 0 ? `+${formatNumber(value)}` : formatNumber(value);
}

function formatDate(value: string | null): string {
  if (!value) {
    return "Pending";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}
