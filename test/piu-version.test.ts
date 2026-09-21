import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_PIU_GAME_VERSION, isPiuGameVersion, normalizePiuGameVersion, performanceVersionForCatalog } from "../src/lib/piu-version.ts";

test("defaults PIUGAME version to Phoenix", () => {
  assert.equal(DEFAULT_PIU_GAME_VERSION, "phoenix");
  assert.equal(normalizePiuGameVersion(undefined), "phoenix");
  assert.equal(normalizePiuGameVersion("unknown"), "phoenix");
});

test("accepts Phoenix 2 as an explicit PIUGAME version", () => {
  assert.equal(normalizePiuGameVersion("phoenix2"), "phoenix2");
});

test("validates supported PIUGAME versions", () => {
  assert.equal(isPiuGameVersion("phoenix"), true);
  assert.equal(isPiuGameVersion("phoenix2"), true);
  assert.equal(isPiuGameVersion("prime2"), false);
});

test("maps catalog history to the performance data version", () => {
  assert.equal(performanceVersionForCatalog("phoenix"), "phoenix");
  assert.equal(performanceVersionForCatalog("phoenix2"), "phoenix2");
  assert.equal(performanceVersionForCatalog("xx"), "phoenix2");
  assert.equal(performanceVersionForCatalog("phoenix2", "phoenix2"), "phoenix");
});
