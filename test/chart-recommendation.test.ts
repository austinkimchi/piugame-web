import assert from "node:assert/strict";
import test from "node:test";

import { chartModesFromFilters, estimateSkillTargets, normalizeSongName, recommendChartToken, type ChartSelectionEvidence } from "../src/lib/chart-recommendation.ts";

const NOW = new Date("2026-09-21T20:00:00.000Z");

test("chooses the higher chart when two charts are equally close to the proven level", () => {
  assert.equal(
    recommendChartToken({
      songName: "Target Song",
      chartTokens: ["S15", "S17", "D16"],
      songEvidence: [],
      skillEvidence: [
        result("A", "Single", "15", 970_000),
        result("B", "Single", "16", 950_000),
        result("C", "Single", "16", 940_000),
        result("D", "Single", "17", 930_000),
        result("E", "Single", "18", 910_000),
      ],
      preferredModes: ["S"],
      now: NOW,
    }),
    "S17",
  );
});

test("a play from the last day takes precedence over score and skill guesses", () => {
  assert.equal(
    recommendChartToken({
      songName: "Target Song",
      chartTokens: ["S15", "S17"],
      songEvidence: [
        result("Target Song", "Single", "15", 910_000, "2026-09-21T12:00:00.000Z"),
        result("Target Song", "Single", "17", 999_000, "2026-09-19T12:00:00.000Z"),
      ],
      skillEvidence: [],
      now: NOW,
    }),
    "S15",
  );
});

test("uses the hardest passed chart when no play is recent", () => {
  assert.equal(
    recommendChartToken({
      songName: "Target Song",
      chartTokens: ["S15", "S17"],
      songEvidence: [
        result("Target Song", "Single", "15", 930_000, "2026-08-01T12:00:00.000Z"),
        result("Target Song", "Single", "17", 920_000, "2026-08-02T12:00:00.000Z"),
      ],
      skillEvidence: [],
      now: NOW,
    }),
    "S17",
  );
});

test("prefers the hardest passed chart on the song over a higher score on an easier chart", () => {
  assert.equal(
    recommendChartToken({
      songName: "Big Daddy",
      chartTokens: ["S16", "S19"],
      songEvidence: [
        result("Big Daddy", "Single", "16", 990_000, "2026-08-01T12:00:00.000Z"),
        result("Big Daddy", "Single", "19", 891_000, "2026-08-02T12:00:00.000Z"),
      ],
      skillEvidence: [],
      preferredModes: ["S"],
      now: NOW,
    }),
    "S19",
  );
});

test("matches known-song evidence across case, spacing, and Unicode width variants", () => {
  assert.equal(
    recommendChartToken({
      songName: "ＢＩＧ DADDY",
      chartTokens: ["S16", "S19"],
      songEvidence: [result("  big   daddy ", "Single", "19", 928_767, "2026-09-14T02:45:45.000Z")],
      skillEvidence: [result("Comfortable Song", "Single", "16", 980_000)],
      preferredModes: ["S"],
      now: NOW,
    }),
    "S19",
  );
  assert.equal(normalizeSongName(" ＢＩＧ   Daddy "), "big daddy");
});

test("uses the normal skill range instead of a handful of hardest clears", () => {
  assert.equal(
    recommendChartToken({
      songName: "Tropicanic",
      chartTokens: ["S16", "S19"],
      songEvidence: [],
      skillEvidence: [
        result("A", "Single", "16", 950_000),
        result("B", "Single", "16", 940_000),
        result("C", "Single", "17", 930_000),
        result("D", "Single", "17", 920_000),
        result("E", "Single", "17", 910_000),
        result("F", "Single", "18", 905_000),
        result("G", "Single", "18", 901_000),
      ],
      preferredModes: ["S"],
      now: NOW,
    }),
    "S16",
  );
});

test("treats a weak high-level clear as less comfort evidence than a strong clear", () => {
  const targets = estimateSkillTargets([
    result("A", "Single", "16", 975_000),
    result("B", "Single", "17", 960_000),
    result("C", "Single", "18", 905_000),
    result("D", "Single", "19", 891_000),
  ]);

  assert.ok((targets.get("S")?.level ?? Infinity) < 18);
  assert.equal(
    recommendChartToken({
      songName: "Tropicanic",
      chartTokens: ["S16", "S19"],
      songEvidence: [],
      skillEvidence: [
        result("A", "Single", "16", 975_000),
        result("B", "Single", "17", 960_000),
        result("C", "Single", "18", 905_000),
        result("D", "Single", "19", 891_000),
      ],
      preferredModes: ["S"],
      now: NOW,
    }),
    "S16",
  );
});

test("prefers a previously attempted chart over an unplayed skill-level chart", () => {
  assert.equal(
    recommendChartToken({
      songName: "We Love Your Step",
      chartTokens: ["S18", "S20"],
      songEvidence: [result("We Love Your Step", "Single", "18", null, "2026-08-01T12:00:00.000Z")],
      skillEvidence: [
        result("A", "Single", "20", 950_000),
        result("B", "Single", "20", 940_000),
        result("C", "Single", "20", 930_000),
      ],
      preferredModes: ["S"],
      now: NOW,
    }),
    "S18",
  );
});

test("does not guess without play history or skill evidence", () => {
  assert.equal(
    recommendChartToken({
      songName: "Target Song",
      chartTokens: ["S15", "S17"],
      songEvidence: [],
      skillEvidence: [],
      now: NOW,
    }),
    null,
  );
});

test("normalizes catalog chart filters into mode preferences", () => {
  assert.deepEqual(chartModesFromFilters(["singles", "Co-op", "unknown", "doubles", "singles"]), ["S", "C", "D"]);
});

function result(
  songName: string,
  mode: string,
  level: string,
  bestScore: number | null,
  latestPlayedAt: string | null = null,
): ChartSelectionEvidence {
  return {
    songName,
    mode,
    level,
    bestScore,
    latestPlayedAt,
  };
}
