import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
const require = createRequire(import.meta.url);
const { outputText } = ts.transpileModule(readFileSync(new URL("../src/components/song-chart-link.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
});
const loaded = { exports: {} };
new Function("require", "module", "exports", outputText)(require, loaded, loaded.exports);
const { SongChartLink } = loaded.exports;

test("chart anchors expose share URLs while ordinary clicks select in place and modified clicks navigate normally", () => {
  let selections = 0, prevented = 0;
  const href = "/songs/a-nightmare-banya-phoenix2?version=phoenix&chart=D14";
  const link = SongChartLink({ href, selected: true, className: "", onSelect: () => { selections += 1; }, children: "D14" });
  assert.equal(link.props.href, href);
  assert.equal(link.props["aria-current"], "true");
  const click = { button: 0, defaultPrevented: false, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, preventDefault: () => { prevented += 1; } };
  link.props.onClick(click);
  assert.equal(selections, 1); assert.equal(prevented, 1);
  for (const modified of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { button: 2 }, { defaultPrevented: true }]) link.props.onClick({ ...click, ...modified });
  assert.equal(selections, 1); assert.equal(prevented, 1);
});
