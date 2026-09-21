import assert from "node:assert/strict";
import test from "node:test";

import { rankChartRecommendations, recommendationCandidatesFromCatalog, type PopulationChartEvidence } from "../src/lib/song-recommendation.ts";
import type { ChartSelectionEvidence } from "../src/lib/chart-recommendation.ts";

const userEvidence: ChartSelectionEvidence[] = [
  result("Played A", "16", 960_000),
  result("Played B", "16", 950_000),
  result("Played C", "17", 940_000),
  result("Played D", "17", 930_000),
  result("Played E", "17", 920_000),
  result("Played F", "18", 910_000),
  result("Played G", "18", 900_000),
];

test("ranks popular, passable charts near the player's demonstrated level", () => {
  const ranked = rankChartRecommendations({
    userEvidence,
    preferredModes: ["S"],
    candidates: [
      candidate("Good Fit", "17", 100, 78),
      candidate("Too Hard", "22", 500, 450),
      candidate("Poor Passability", "17", 100, 4),
      candidate("Less Popular Fit", "17", 10, 8),
    ],
  });

  assert.equal(ranked[0]?.songName, "Good Fit");
  assert.equal(ranked[0]?.chartToken, "S17");
  assert.equal(ranked.some((item) => item.songName === "Too Hard"), false);
});

test("excludes songs the player has already attempted and respects mode preferences", () => {
  const ranked = rankChartRecommendations({
    userEvidence,
    preferredModes: ["S"],
    candidates: [
      candidate("Played A", "17", 100, 90),
      candidate("Double Pick", "17", 100, 90, "Double"),
      candidate("New Pick", "17", 20, 15),
    ],
  });

  assert.deepEqual(ranked.map((item) => item.songName), ["New Pick"]);
});

test("keeps catalog charts eligible before population evidence exists", () => {
  const ranked = rankChartRecommendations({
    userEvidence,
    preferredModes: ["S"],
    candidates: [candidate("Cold Start Pick", "17", 0, 0)],
  });

  assert.equal(ranked[0]?.songName, "Cold Start Pick");
});

test("uses a stable exploration seed instead of alphabetical cold-start ordering", () => {
  const candidates = ["Alpha", "Bravo", "Charlie", "Delta"].map((songName) => candidate(songName, "17", 0, 0));
  const first = rankChartRecommendations({ candidates, userEvidence, preferredModes: ["S"], explorationSeed: "player:2026-09-21" });
  const second = rankChartRecommendations({ candidates, userEvidence, preferredModes: ["S"], explorationSeed: "player:2026-09-21" });

  assert.deepEqual(first, second);
  assert.notDeepEqual(first.map((item) => item.songName), ["Alpha", "Bravo", "Charlie", "Delta"]);
});

test("applies level filters before choosing one chart per song", () => {
  const ranked = rankChartRecommendations({
    userEvidence,
    preferredModes: ["S"],
    levels: ["16"],
    candidates: [
      candidate("Multi-chart Pick", "16", 20, 15),
      candidate("Multi-chart Pick", "17", 100, 90),
    ],
  });

  assert.equal(ranked[0]?.songName, "Multi-chart Pick");
  assert.equal(ranked[0]?.chartToken, "S16");
});

test("preserves suffixed charts in the catalog cold-start pool", () => {
  const candidates = recommendationCandidatesFromCatalog([
    { title: "Suffix Pick", chartSummary: ["S20-", "D18+", "C2"] },
  ]);

  assert.deepEqual(candidates.map((item) => `${item.mode}${item.level}`), ["S20-", "D18+"]);
});

test("maps suffixed and level 28 charts to the catalog plus-level filter", () => {
  const suffixed = rankChartRecommendations({
    userEvidence: userEvidence.map((evidence) => ({ ...evidence, level: "20" })),
    preferredModes: ["S"],
    levels: ["+"],
    candidates: [candidate("Minus Pick", "20-", 0, 0)],
  });
  const level28 = rankChartRecommendations({
    userEvidence: userEvidence.map((evidence) => ({ ...evidence, level: "27" })),
    preferredModes: ["S"],
    levels: ["+"],
    candidates: [candidate("Level 28 Pick", "28", 0, 0)],
  });

  assert.equal(suffixed[0]?.chartToken, "S20-");
  assert.equal(level28[0]?.chartToken, "S28");
});

function result(songName: string, level: string, bestScore: number): ChartSelectionEvidence {
  return { songName, mode: "Single", level, bestScore, latestPlayedAt: null };
}

function candidate(songName: string, level: string, attempts: number, clears: number, mode = "Single"): PopulationChartEvidence {
  return { songName, mode, level, attempts, clears };
}
