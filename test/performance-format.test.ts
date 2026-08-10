import assert from "node:assert/strict";
import test from "node:test";

import { formatPerformanceGrade, piuTimestampToDate } from "../src/lib/performance-format.ts";

test("formats grade asset codes as display labels", () => {
  assert.equal(formatPerformanceGrade("aaa_p"), "AAA+");
  assert.equal(formatPerformanceGrade("ss_p"), "SS+");
  assert.equal(formatPerformanceGrade("ss"), "SS");
  assert.equal(formatPerformanceGrade("s_p"), "S+");
  assert.equal(formatPerformanceGrade("aaa"), "AAA");
  assert.equal(formatPerformanceGrade("s"), "S");
});

test("formats prefixed and empty grade values", () => {
  assert.equal(formatPerformanceGrade("x_aa_p"), "AA+");
  assert.equal(formatPerformanceGrade(null), "Played");
});

test("parses PIUGAME GMT timestamps into instants", () => {
  assert.equal(piuTimestampToDate("2026-08-09 09:31:06 (GMT+9)")?.toISOString(), "2026-08-09T00:31:06.000Z");
});
