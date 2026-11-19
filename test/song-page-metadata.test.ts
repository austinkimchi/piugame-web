import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import * as React from "react";
import ts from "typescript";
import * as catalogVersion from "../src/lib/catalog-version.ts";
import * as pageUrl from "../src/lib/song-page-url.ts";
import * as piuVersion from "../src/lib/piu-version.ts";
import type { PiuSeriesId, PublicSong } from "../src/lib/types.ts";

type PageModule = typeof import("../src/app/songs/[slug]/page.tsx");
const require = createRequire(import.meta.url);
const { outputText } = ts.transpileModule(readFileSync(new URL("../src/app/songs/[slug]/page.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
});

function fixture(preference: "phoenix" | "phoenix2" | null) {
  const communityCalls: unknown[][] = [];
  const songs = {
    nightmare: { slug: "a-nightmare-banya-phoenix2", title: "A Nightmare", artist: "Banya", version: "phoenix2", supportedVersions: ["phoenix", "phoenix2"], chartTokensByVersion: { phoenix: ["S3", "S6", "D14"], phoenix2: ["S3", "S6", "D15"] }, imageUrl: "/jacket.png" },
    removed: { slug: "after-like-ive-phoenix2", title: "After LIKE", artist: "IVE", version: "phoenix2", supportedVersions: ["phoenix"], removedFromVersions: ["phoenix2"], chartTokensByVersion: { phoenix: ["S1", "D23"] }, imageUrl: "/old-jacket.png" },
  };
  const dependencies: Record<string, unknown> = {
    react: { cache: (fn: unknown) => fn }, "react/jsx-runtime": require("react/jsx-runtime"),
    "next/headers": { headers: async () => new Headers() },
    "next/navigation": { notFound: () => { throw new Error("not-found"); } },
    "@/components/song-detail-view": { SongDetailView: "song-detail-view" },
    "@/lib/auth": {
      getCurrentUser: async () => preference ? { preferences: { piuGameVersion: preference } } : null,
      isAdmin: () => false,
      getSongCommunityState: async (...args: unknown[]) => { communityCalls.push(args); return {}; },
    },
    "@/lib/catalog": { getSongBySlug: async (slug: string, version: PiuSeriesId) => {
      const source = slug.startsWith("a-nightmare-") ? songs.nightmare : slug.startsWith("after-like-") ? songs.removed : null;
      if (!source) return null;
      const tokens = source.chartTokensByVersion as Partial<Record<PiuSeriesId, string[]>>;
      return { ...source, chartSummary: tokens[version] ?? [] } as unknown as PublicSong;
    } },
    "@/lib/chart-community": { chartCommunityKey: (_song: unknown, version: string, chart: string) => `${version}:${chart}` },
    "@/lib/catalog-version": catalogVersion, "@/lib/song-page-url": pageUrl, "@/lib/piu-version": piuVersion,
    "@/lib/rate-limit": { checkRateLimit: () => true },
    "@/lib/site": { absoluteSiteUrl: (value: string) => new URL(value, "https://example.com").href, siteName: "MyPIU", sitePreviewImage: { path: "/preview.png", alt: "Preview", width: 100, height: 100, type: "image/png" } },
  };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", outputText)((name: string) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  return { page: loaded.exports as PageModule, communityCalls };
}

function pageProps(slug: string, version?: string, chart?: string) {
  return { params: Promise.resolve({ slug }), searchParams: Promise.resolve({ version, chart }) };
}
function detailProps(element: React.ReactElement) {
  const children = (element.props as { children: React.ReactElement }).children;
  return children.props as { song: PublicSong; catalogVersion: string; initialSelectedChartToken: string | null };
}

test("A Nightmare D14/D15 metadata and rendered selection agree for anonymous and both account preferences", async () => {
  for (const preference of [null, "phoenix", "phoenix2"] as const) {
    for (const [version, chart] of [["phoenix", "D14"], ["phoenix2", "D15"]]) {
      const f = fixture(preference);
      const props = pageProps("a-nightmare-banya-phoenix2", version, chart);
      const metadata = await f.page.generateMetadata(props);
      assert.equal(metadata.alternates?.canonical, `/songs/a-nightmare-banya-phoenix2?version=${version}`);
      assert.match(String(metadata.title), new RegExp(`A Nightmare ${chart} by Banya`));
      assert.ok(metadata.description?.includes(`Selected chart: ${chart}.`));
      assert.equal((metadata.openGraph as { url: string }).url, `/songs/a-nightmare-banya-phoenix2?version=${version}&chart=${chart}`);
      const detail = detailProps(await f.page.default(props));
      assert.equal(detail.catalogVersion, version);
      assert.equal(detail.initialSelectedChartToken, chart);
      assert.ok(detail.song.chartSummary.includes(chart));
      assert.equal(f.communityCalls[0][3], `${version}:${chart}`);
    }
  }
});

test("unsupported and absent versions choose a stable public default and invalid charts canonicalize to the song", async () => {
  for (const preference of [null, "phoenix", "phoenix2"] as const) {
    for (const version of [undefined, "xx", "invalid"]) {
      const f = fixture(preference);
      const props = pageProps("a-nightmare-banya-phoenix2", version, "D14");
      const metadata = await f.page.generateMetadata(props);
      assert.equal(metadata.alternates?.canonical, "/songs/a-nightmare-banya-phoenix2?version=phoenix2");
      assert.equal((metadata.openGraph as { url: string }).url, metadata.alternates?.canonical);
      assert.ok(!String(metadata.title).includes("D14"));
      const detail = detailProps(await f.page.default(props));
      assert.equal(detail.catalogVersion, "phoenix2");
      assert.equal(detail.initialSelectedChartToken, null);
    }
  }
});

test("removed-only source aliases resolve to historical metadata and the existing community identity", async () => {
  for (const preference of [null, "phoenix", "phoenix2"] as const) {
    for (const version of [undefined, "phoenix", "phoenix2"]) {
      const f = fixture(preference);
      const props = pageProps("after-like-ive-phoenix", version, "D23");
      const metadata = await f.page.generateMetadata(props);
      assert.equal(metadata.alternates?.canonical, "/songs/after-like-ive-phoenix2?version=phoenix");
      assert.match(String(metadata.title), /After LIKE D23 by IVE · PHOENIX$/);
      const detail = detailProps(await f.page.default(props));
      assert.equal(detail.catalogVersion, "phoenix");
      assert.equal(detail.initialSelectedChartToken, "D23");
      assert.equal(f.communityCalls[0][1], "after-like-ive-phoenix2");
    }
  }
});

test("unknown song pages remain noindex and not found", async () => {
  const f = fixture(null), props = pageProps("missing");
  assert.deepEqual((await f.page.generateMetadata(props)).robots, { index: false, follow: false });
  await assert.rejects(f.page.default(props), /not-found/);
});
