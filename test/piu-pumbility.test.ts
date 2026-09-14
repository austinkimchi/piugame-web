import assert from "node:assert/strict";
import test from "node:test";

import { parsePumbilityScore } from "../src/lib/piu-pumbility.ts";

test("parses the current Phoenix 2 Pumbility total including its decimal", () => {
  const html = `
    <div class="pumbility_total_wrap">
      <div class="icon"></div>
      <div class="info-wrap">
        <div class="title">GOLD Lv.3</div>
        <div class="score">15,510<span class="pumbility-point-sub">.38</span></div>
      </div>
    </div>
  `;

  assert.equal(parsePumbilityScore(html), 15_510.38);
});

test("continues to parse the legacy Pumbility markup", () => {
  const html = `
    <div class="pumbility_total_wrap">
      <div class="inn">
        <div class="t1">Pumbility</div>
        <div class="t2">9,352</div>
      </div>
    </div>
  `;

  assert.equal(parsePumbilityScore(html), 9_352);
});

test("returns null when the Pumbility total is absent", () => {
  assert.equal(parsePumbilityScore("<main>No performance data</main>"), null);
});
