import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { load } from "cheerio";
import ts from "typescript";

const require = createRequire(import.meta.url);
const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const modules = new Map();
// Render actual client components, Motion and hooks on the server. Effects never
// run, so this checks visibility before hydration or an IntersectionObserver.
function sourceModule(filename) {
  const resolved = [filename, `${filename}.ts`, `${filename}.tsx`].find(existsSync);
  assert.ok(resolved, `Missing source module ${filename}`);
  if (modules.has(resolved)) return modules.get(resolved).exports;
  const module = { exports: {} };
  modules.set(resolved, module);
  const { outputText } = ts.transpileModule(readFileSync(resolved, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  });
  new Function("require", "module", "exports", outputText)((name) => {
    if (name.startsWith("@/")) return sourceModule(path.join(sourceRoot, name.slice(2)));
    if (name.startsWith(".")) return sourceModule(path.resolve(path.dirname(resolved), name));
    return require(name);
  }, module, module.exports);
  return module.exports;
}

const { SongExplorer } = sourceModule(path.join(sourceRoot, "components/song-explorer.tsx"));

test("a fresh complete catalog renders search, filters and cards without waiting for visibility callbacks", () => {
  const songs = Array.from({ length: 675 }, (_, index) => ({
    slug: `fixture-${index}`, title: `Song ${index}`, artist: "Fixture", songKey: `Song ${index}`,
    version: "phoenix2", supportedVersions: ["phoenix2"], removedFromVersions: [],
    history: [], chartHistory: [], chartLinks: [], imageUrl: null, previewUrl: null,
    previewAvailable: false, audioPath: null, bpm: null, chartSummary: ["S15"],
    folder: "ORIGINAL", folderPosition: null, folderSongCount: null,
    series: "PHOENIX 2", seriesSongCount: null, tags: [], isPremium: false,
  }));
  const html = renderToStaticMarkup(React.createElement(SongExplorer, {
    initialSongs: songs, initialFavoriteSlugs: [], chartRecommendations: {}, featureSong: null,
    filterOptions: { folders: ["ORIGINAL"], series: ["PHOENIX 2"], levels: ["15"], charts: ["S15"] },
    canFavorite: false, initialPreviewMuted: true, initialPreviewVolume: 0.5,
    initialSortBy: "title", initialSortDirection: "asc", initialFavoritesFirst: false,
    userIsAdmin: false, catalogVersion: "phoenix2", showLanding: false,
  }));
  const $ = load(html);
  const search = $("#search input[aria-label='Search songs']");
  const cards = $("#search article");
  assert.equal(search.length, 1);
  assert.ok(cards.length > 0 && cards.length < 675, "initial cards stay virtualized");
  assert.equal($("#search [role='listitem']").first().attr("aria-setsize"), "675");
  for (const element of [search, $("#search aside").first(), cards.first()]) {
    assert.equal(element.length, 1);
    element.add(element.parents()).each((_, node) => {
      const styles = Object.fromEntries(($(node).attr("style") ?? "").split(";").filter(Boolean).map((rule) => rule.split(":").map((part) => part.trim())));
      assert.notEqual(styles.opacity, "0", "essential catalog content must not start transparent");
      assert.notEqual(styles.visibility, "hidden", "essential catalog content must not start hidden");
      assert.notEqual(styles.display, "none", "essential catalog content must not start removed");
    });
  }
});
