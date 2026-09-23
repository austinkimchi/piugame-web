import assert from "node:assert/strict";
import test from "node:test";

import { buildSongPerformanceCarousel } from "../src/lib/song-performance-carousel.ts";

const judgments = { perfect: 100, great: 1, good: 0, bad: 0, miss: 0 };

test("starts with the latest attempt after a failed play and removes duplicate history entries", () => {
  const latest = { score: 700000, grade: "x_a", plate: null, playedAt: "2026-08-18T12:00:00.000Z", stageBreak: true, judgments };
  const older = { score: 900000, grade: "aaa", plate: null, playedAt: "2026-08-17T12:00:00.000Z", stageBreak: false, judgments };

  const carousel = buildSongPerformanceCarousel({
    bestGrade: "aaa",
    bestPlate: null,
    bestScore: 900000,
    history: [older, latest],
    latestPlay: latest,
  });

  assert.equal(carousel.primaryKind, "latest");
  assert.deepEqual(carousel.entries.map((play) => play.score), [700000, 900000]);
});

test("treats every x_-prefixed grade as a failed attempt", () => {
  const latest = { score: 892813, grade: "x_a_p", plate: null, playedAt: "2026-08-18T12:00:00.000Z", stageBreak: false, judgments };
  const older = { score: 900000, grade: "aaa", plate: null, playedAt: "2026-08-17T12:00:00.000Z", stageBreak: false, judgments };

  const carousel = buildSongPerformanceCarousel({
    bestGrade: "aaa",
    bestPlate: null,
    bestScore: 900000,
    history: [older, latest],
    latestPlay: latest,
  });

  assert.equal(carousel.primaryKind, "latest");
  assert.deepEqual(carousel.entries.map((play) => play.score), [892813, 900000]);
});

test("starts with the recorded best after a completed play and preserves prior attempts", () => {
  const best = { score: 950000, grade: "sss", plate: null, playedAt: "2026-08-17T12:00:00.000Z", stageBreak: false, judgments };
  const previous = { score: 900000, grade: "aaa", plate: null, playedAt: "2026-08-16T12:00:00.000Z", stageBreak: false, judgments };
  const latest = { score: 920000, grade: "aaa", plate: null, playedAt: "2026-08-18T12:00:00.000Z", stageBreak: false, judgments };

  const carousel = buildSongPerformanceCarousel({
    bestGrade: "sss",
    bestPlate: null,
    bestScore: 950000,
    history: [previous, best, latest],
    latestPlay: latest,
  });

  assert.equal(carousel.primaryKind, "best");
  assert.deepEqual(carousel.entries.map((play) => play.score), [950000, 900000]);
});

test("shows the stored chart best when it falls outside recent attempt history", () => {
  const latest = { score: 920000, grade: "aaa", plate: "fg", playedAt: "2026-08-18T12:00:00.000Z", stageBreak: false, judgments };

  const carousel = buildSongPerformanceCarousel({
    bestGrade: "sss",
    bestPlate: "rg",
    bestScore: 980000,
    history: [latest],
    latestPlay: latest,
  });

  assert.equal(carousel.primaryKind, "best");
  assert.deepEqual(carousel.entries.map((play) => play.score), [980000, 920000]);
  assert.equal(carousel.entries[0]?.grade, "sss");
  assert.equal(carousel.entries[0]?.plate, "rg");
});
