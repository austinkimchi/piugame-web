import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as release from "../src/lib/catalog-release.ts";
import * as performance from "../src/lib/performance-format.ts";

const require = createRequire(import.meta.url);
const { outputText } = ts.transpileModule(readFileSync(new URL("../src/components/song-card.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
});
const loaded = { exports: {} };
new Function("require", "module", "exports", outputText)((name) => {
  if (name === "@/lib/catalog-release") return release;
  if (name === "@/lib/performance-format") return performance;
  if (name === "@/lib/preview-availability") return { usePreviewUnavailable: () => false };
  return require(name);
}, loaded, loaded.exports);

function card(date, isPremium = false) {
  return renderToStaticMarkup(React.createElement(loaded.exports.SongCard, {
    song: { slug: "fixture-phoenix2", title: "Fixture", artist: "Fixture", series: "PHOENIX 2", version: "phoenix2",
      supportedVersions: ["phoenix2"], removedFromVersions: [],
      history: [{ date, type: "added", version: "phoenix2", note: "" }],
      chartSummary: ["S18"], imageUrl: null, previewUrl: null, isPremium, isFavorite: true },
    previewEnabled: false, isPreviewActive: false, animateEntry: false,
    onPreviewStart() {}, onPreviewStop() {},
  }));
}

test("actual card keeps NEW on current additions and premium/favorite badges on older songs", () => {
  const current = card("2026-10-15");
  assert.match(current, /song-new-badge/);
  assert.match(current, /New in PHOENIX 2 v1\.02\.0/);
  const old = card("2026-07-09");
  assert.doesNotMatch(old, /song-new-badge/);
  assert.match(old, /song-favorite-badge/);
  const oldPremium = card("2026-07-09", true);
  assert.doesNotMatch(oldPremium, /song-new-badge/);
  assert.match(oldPremium, /aria-label="Premium song"/);
  assert.match(card("2026-10-15", true), /New in PHOENIX 2 v1\.02\.0, premium song/);
});
