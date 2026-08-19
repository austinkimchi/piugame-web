import assert from "node:assert/strict";
import test from "node:test";

import { catalogChartTokenFromPlay, performanceChartTokenCandidates, performanceChartTokenCandidatesFromPlay, performanceChartTokenKey } from "../src/lib/performance-chart-key.ts";

test("creates the same normalized performance chart key used by stored plays", () => {
  assert.equal(performanceChartTokenKey("Christmas Memories", "C", "2"), "christmas-memories:c:2");
});

test("maps current co-op catalog token to indexed performance key candidates", () => {
  assert.deepEqual(performanceChartTokenCandidates("Christmas Memories", "C2"), [
    "christmas-memories:c:2",
    "christmas-memories:co-op:2",
    "christmas-memories:coop:2",
    "christmas-memories:cooperative:2",
  ]);
});

test("accepts old co-op catalog token spelling while the database uses C2-style charts", () => {
  assert.deepEqual(performanceChartTokenCandidates("Christmas Memories", "Cx2"), [
    "christmas-memories:c:2",
    "christmas-memories:co-op:2",
    "christmas-memories:coop:2",
    "christmas-memories:cooperative:2",
  ]);
});

test("converts a performance play into its compact catalog chart token", () => {
  assert.equal(catalogChartTokenFromPlay({ mode: "Co-op", level: "2" }), "C2");
  assert.equal(catalogChartTokenFromPlay({ mode: "Doubles", level: "18+" }), "D18+");
  assert.equal(catalogChartTokenFromPlay({ mode: "unknown", level: "18" }), null);
});

test("maps play mode aliases to the same chart stat candidates", () => {
  assert.deepEqual(performanceChartTokenCandidatesFromPlay({ songName: "New Rose", mode: "Single", level: "19" }), [
    "new-rose:s:19",
    "new-rose:single:19",
    "new-rose:singles:19",
  ]);
});
