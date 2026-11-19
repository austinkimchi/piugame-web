import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { load } from "cheerio";
import ts from "typescript";

import { performanceResultBadges } from "../src/lib/performance-result-badges.ts";

type ManifestAsset = { path: string; width: number; height: number; bytes: number; sha256: string; sourceUrl: string };
const assetRoot = new URL("../public/assets/piu/ui/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", assetRoot), "utf8")) as {
  assets: ManifestAsset[]; assetCount: number; totalBytes: number;
};
const byPath = new Map(manifest.assets.map((asset) => [`/assets/piu/ui/${asset.path}`, asset]));
const grades = ["SSS+", "SSS", "SS+", "SS", "S+", "S", "AAA+", "AAA", "AA+", "AA", "A+", "A", "B", "C", "D", "F"];
const plates = ["pg", "ug", "eg", "sg", "mg", "tg", "fg", "rg"];

// Compile the actual small component with React and Next Image, not an imitation renderer.
const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/components/performance-result-badge.tsx", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
});
const loaded = { exports: {} };
new Function("require", "module", "exports", outputText)(require, loaded, loaded.exports);
const { PerformanceResultBadge } = loaded.exports as typeof import("../src/components/performance-result-badge");

test("all recognized grades and plates resolve to verified edition-specific files and dimensions", () => {
  for (const version of ["phoenix", "phoenix2"] as const) {
    for (const grade of grades) {
      for (const failed of [false, true]) {
        const raw = `${failed ? "x_" : ""}${grade.toLowerCase().replace("+", "_p")}`;
        const badge = performanceResultBadges({ grade: raw, plate: null, version }).grade!;
        assert.equal(badge.text, grade);
        assert.equal(badge.label, `${failed ? "Failed grade" : "Grade"} ${grade}`);
        assert.ok(badge.image);
        const asset = byPath.get(badge.image.src)!;
        assert.ok(asset, badge.image.src);
        assert.equal(badge.image.width, asset.width);
        assert.equal(badge.image.height, asset.height);
        assert.ok(asset.path.startsWith(`${version}/grades/${failed ? "failed/" : ""}`));
      }
    }
    for (const plate of plates) {
      const badge = performanceResultBadges({ grade: null, plate: ` S_${plate.toUpperCase()} `, version }).plate!;
      assert.equal(badge.text, plate.toUpperCase());
      assert.equal(badge.label, `Plate ${plate.toUpperCase()}`);
      assert.ok(badge.image);
      const asset = byPath.get(badge.image.src)!;
      assert.ok(asset);
      assert.equal(badge.image.width, asset.width);
      assert.equal(badge.image.height, asset.height);
    }
  }
});

test("plus spelling and failed prefix normalize without treating a plate as a grade", () => {
  assert.deepEqual(
    performanceResultBadges({ grade: " X_aA+ ", plate: "RG", version: "phoenix2" }),
    performanceResultBadges({ grade: "x_aa_p", plate: "rg", version: "phoenix2" }),
  );
  const result = performanceResultBadges({ grade: null, plate: "rg", version: "phoenix" });
  assert.equal(result.grade?.text, "Played");
  assert.equal(result.grade?.image, null);
  assert.equal(result.plate?.label, "Plate RG");
});

test("stage breaks suppress result artwork and unknown input retains text without invented paths", () => {
  assert.deepEqual(performanceResultBadges({ grade: "SSS+", plate: "pg", version: "phoenix2", stageBreak: true }), { grade: null, plate: null });
  const unknown = performanceResultBadges({ grade: "x_future_grade", plate: "../new", version: "phoenix2" });
  assert.equal(unknown.grade?.text, "FUTURE GRADE");
  assert.equal(unknown.grade?.label, "Failed grade FUTURE GRADE");
  assert.equal(unknown.grade?.image, null);
  assert.equal(unknown.plate?.text, "../NEW");
  assert.equal(unknown.plate?.image, null);
  const empty = performanceResultBadges({ grade: " ", plate: " ", version: "phoenix" });
  assert.equal(empty.grade?.label, "Played; grade unavailable");
  assert.equal(empty.plate, null);
  const invalidVersion = performanceResultBadges({ grade: "s", plate: "pg", version: "../unknown" as "phoenix" });
  assert.equal(invalidVersion.grade?.image, null);
  assert.equal(invalidVersion.plate?.image, null);
});

test("rendered badges expose one accessible label, decorative image, and intrinsic dimensions", () => {
  for (const version of ["phoenix", "phoenix2"] as const) {
    const result = performanceResultBadges({ grade: "x_aa_p", plate: "rg", version });
    for (const kind of ["grade", "plate"] as const) {
      const badge = result[kind]!;
      const $ = load(renderToStaticMarkup(createElement(PerformanceResultBadge, { badge, kind })));
      assert.equal($("[role=img]").length, 1);
      assert.equal($("[role=img]").attr("aria-label"), badge.label);
      assert.equal($("img").attr("alt"), "");
      assert.equal($("img").attr("aria-hidden"), "true");
      assert.equal(Number($("img").attr("width")), badge.image?.width);
      assert.equal(Number($("img").attr("height")), badge.image?.height);
    }
  }
});

test("rendered unknown and empty badges use safe text and no image requests", () => {
  const result = performanceResultBadges({ grade: "<future>", plate: null, version: "phoenix2" });
  const $ = load(renderToStaticMarkup(createElement(PerformanceResultBadge, { badge: result.grade, kind: "grade" })));
  assert.equal($("img").length, 0);
  assert.equal($("[role=img]").text(), "<FUTURE>");
  assert.equal($("future").length, 0);
  assert.equal(renderToStaticMarkup(createElement(PerformanceResultBadge, { badge: result.plate, kind: "plate" })), "");
});

test("the collected PNG bytes, dimensions and totals match their provenance manifest", () => {
  assert.equal(manifest.assets.length, manifest.assetCount);
  assert.equal(new Set(manifest.assets.map((a) => a.path)).size, manifest.assetCount);
  assert.equal(manifest.assets.reduce((sum, a) => sum + a.bytes, 0), manifest.totalBytes);
  for (const asset of manifest.assets) {
    const bytes = readFileSync(new URL(asset.path, assetRoot));
    assert.equal(bytes.length, asset.bytes, asset.path);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256, asset.path);
    assert.equal(bytes.readUInt32BE(16), asset.width, asset.path);
    assert.equal(bytes.readUInt32BE(20), asset.height, asset.path);
    assert.ok(["piugame.com", "phoenix.piugame.com"].includes(new URL(asset.sourceUrl).hostname));
  }
});
