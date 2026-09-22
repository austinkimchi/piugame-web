import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Activity, ArrowUpRight, BarChart3, Database, RefreshCw, ShieldCheck, TrendingUp } from "lucide-react";

import { AccountBar } from "@/components/account-bar";
import { BrowserExtensionSyncControl } from "@/components/browser-extension-sync-control";
import { PerformanceDashboardTables } from "@/components/performance-dashboard-tables";
import { PerformancePageRefresh } from "@/components/performance-page-refresh";
import { getCurrentUser } from "@/lib/auth";
import { getSongsByTitles } from "@/lib/catalog";
import { getPerformanceDashboard, type PerformanceDashboard } from "@/lib/performance";
import { createPerformanceSyncToken } from "@/lib/performance-sync-token";
import { normalizePiuGameVersion } from "@/lib/piu-version";

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
  const user = await getCurrentUser();
  const userId = user?.id ?? null;
  const dashboard = await getPerformanceDashboard(userId);
  const catalogSongsByTitle = await getSongsByTitles(
    normalizePiuGameVersion(user?.preferences.piuGameVersion),
    [...dashboard.topCharts.map((chart) => chart.songName), ...dashboard.recentPlays.map((play) => play.songName)],
  );
  const topCharts = dashboard.topCharts.map((chart) => ({
    ...chart,
    song: catalogSongsByTitle.get(songLookupKey(chart.songName)) ?? null,
  }));
  const recentPlays = dashboard.recentPlays.map((play) => ({
    ...play,
    song: catalogSongsByTitle.get(songLookupKey(play.songName)) ?? null,
  }));
  const nextTopChartsOffset = topCharts.length < dashboard.totals.trackedPumbilityCharts ? topCharts.length : null;
  const nextRecentPlaysOffset = recentPlays.length < dashboard.totals.trackedPlays ? recentPlays.length : null;
  const pageRefreshToken = user?.piuProfile && userId && dashboard.mongoReady ? createPerformanceSyncToken(userId) : null;

  return (
    <main className="min-h-screen bg-[#f7f8f2] text-[#171916]">
      <PerformancePageRefresh token={pageRefreshToken} />
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
                <div className="mt-5">
                  <BrowserExtensionSyncControl />
                </div>
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
        <MetricCard icon={<TrendingUp aria-hidden="true" size={19} />} label="Pumbility" value={formatNumber(dashboard.profile?.pumbilityScore)} detail={`Rating ${formatNumber(dashboard.profile?.rating)}`} />
        <MetricCard icon={<BarChart3 aria-hidden="true" size={19} />} label="Tracked charts" value={formatNumber(dashboard.totals.trackedCharts)} detail={`${formatNumber(dashboard.totals.trackedPlays)} recent plays stored`} />
        <MetricCard icon={<ShieldCheck aria-hidden="true" size={19} />} label="Upscores" value={formatNumber(dashboard.totals.upscores)} detail="From chart best history" />
        <MetricCard icon={<Database aria-hidden="true" size={19} />} label="Average best" value={formatNumber(dashboard.totals.averageBestScore)} detail="Across tracked charts" />
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-6 px-5 pb-12 sm:px-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:px-10">
        <PerformanceDashboardTables
          key={`${dashboard.profile?.lastSyncedAt ?? "pending"}:${dashboard.totals.trackedPlays}:${dashboard.totals.trackedCharts}`}
          nextTopChartsOffset={nextTopChartsOffset}
          nextRecentPlaysOffset={nextRecentPlaysOffset}
          performanceVersion={normalizePiuGameVersion(user?.preferences.piuGameVersion)}
          communityUser={user}
          previewVolume={user?.preferences.songPreviewVolume ?? 0.5}
          lastFetchedAt={dashboard.profile?.lastSyncedAt}
          recentArcade={dashboard.profile?.recentArcade}
          recentPlays={recentPlays}
          totalRecentPlays={dashboard.totals.trackedPlays}
          totalTopCharts={dashboard.totals.trackedPumbilityCharts}
          topCharts={topCharts}
        />
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

  if (!user.preferences.performanceAutoRefresh) {
    return "Opening this page refreshes recent plays for your account. Backend auto refresh is off.";
  }

  const nextRefresh = formatDate(dashboard.profile?.nextRefreshAt ?? null);
  return `Backend auto refresh is enabled. Next refresh: ${nextRefresh}.`;
}

function formatNumber(value: number | null | undefined, suffix?: string): string {
  if (value === null || value === undefined) {
    return "-";
  }

  return `${new Intl.NumberFormat("en-US").format(value)}${suffix ? ` ${suffix}` : ""}`;
}

function formatDate(value: string | null): string {
  if (!value) {
    return "Pending";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return formatStableDateTime(parsed);
}

function formatStableDateTime(value: Date): string {
  const month = new Intl.DateTimeFormat("en-US", { month: "short" }).format(value);
  const day = new Intl.DateTimeFormat("en-US", { day: "numeric" }).format(value);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(value);

  return `${month} ${day}, ${time}`;
}

function songLookupKey(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}
