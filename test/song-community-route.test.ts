import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { NextRequest } from "next/server";
import ts from "typescript";
import * as catalogVersion from "../src/lib/catalog-version.ts";
import * as chartCommunity from "../src/lib/chart-community.ts";

type CommunityRoute = typeof import("../src/app/api/songs/[slug]/community/route.ts");
const source = readFileSync(new URL("../src/app/api/songs/[slug]/community/route.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
});
const storageSlug = "original-artist-phoenix2";
const sourceSlug = "original-artist-phoenix";

function fixture() {
  const song = { slug: storageSlug, chartSummary: ["S18"], chartLinks: [{ id: "linked-chart", tokens: { phoenix: "S18", phoenix2: "S20" } }] };
  const savedSongs = new Map<string, boolean>();
  const notes = new Map<string, string>();
  const reads: Array<{ slug: string; token: string | null; key: string | null }> = [];
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/catalog-version": catalogVersion,
    "@/lib/chart-community": chartCommunity,
    "@/lib/catalog": { async getSongBySlug(slug: string, version: string) {
      assert.equal(version, "phoenix");
      return slug === sourceSlug || slug === storageSlug ? song : null;
    } },
    "@/lib/auth": {
      async getCurrentUser() { return { id: "fixture-user" }; },
      async getSongCommunityState(_user: unknown, slug: string, token: string | null, key: string | null) {
        reads.push({ slug, token, key });
        return { saved: savedSongs.get(slug) ?? false, note: notes.get(`${slug}:${key ?? token}`) ?? "", userTags: [], communityTags: [], tagVotes: [], posts: [] };
      },
      async setSongSaved(_user: unknown, resolvedSong: typeof song, saved: boolean) { savedSongs.set(resolvedSong.slug, saved); },
      async saveSongNote(_user: unknown, resolvedSong: typeof song, chartKey: string, note: string) { notes.set(`${resolvedSong.slug}:${chartKey}`, note); },
    },
  };
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", outputText)((name: string) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, loadedModule, loadedModule.exports);
  return { route: loadedModule.exports as CommunityRoute, reads, savedSongs, notes };
}

function request(slug: string, body?: Record<string, unknown>): NextRequest {
  const url = `https://example.test/api/songs/${slug}/community?version=phoenix&chart=S18`;
  return Object.assign(new Request(url, body ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: "phoenix", chartToken: "S18", ...body }),
  } : undefined), { nextUrl: new URL(url) }) as NextRequest;
}
const context = (slug: string) => ({ params: Promise.resolve({ slug }) });

for (const writeSlug of [sourceSlug, storageSlug]) {
  test(`community saves and chart notes written through ${writeSlug} are readable through both URLs`, async () => {
    const { route, reads, savedSongs, notes } = fixture();
    for (const action of [{ action: "save", saved: true }, { action: "note", note: "Practice the ending" }]) {
      const post = await route.POST(request(writeSlug, action), context(writeSlug));
      assert.equal(post.status, 200);
      assert.equal(post.headers.get("Cache-Control"), "private, no-store");
      const { state } = await post.json();
      assert.equal(state.saved, true);
      if (action.action === "note") assert.equal(state.note, "Practice the ending");
      for (const readSlug of [sourceSlug, storageSlug]) {
        const get = await route.GET(request(readSlug), context(readSlug));
        assert.equal(get.status, 200);
        assert.equal(get.headers.get("Cache-Control"), "private, no-store");
        assert.deepEqual(await get.json(), state);
      }
    }
    assert.deepEqual([...savedSongs], [[storageSlug, true]]);
    assert.deepEqual([...notes], [[`${storageSlug}:linked-chart`, "Practice the ending"]]);
    assert.ok(reads.every((read) => read.slug === storageSlug && read.token === "S18" && read.key === "linked-chart"));
  });
}

test("unresolved community GET preserves the existing request-slug fallback", async () => {
  const { route, reads } = fixture();
  const response = await route.GET(request("missing-song"), context("missing-song"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).saved, false);
  assert.deepEqual(reads, [{ slug: "missing-song", token: "S18", key: null }]);
});
