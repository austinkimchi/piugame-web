import assert from "node:assert/strict";
import test from "node:test";

import type { TitleEntry, TitleRequirementMetric } from "@austinkimchi/piugame-sdk";

import { selectNextTitleObjective } from "../src/lib/piu-next-title.ts";

function title(
  name: string,
  metric: TitleRequirementMetric,
  current: number,
  target: number,
  owned = false,
): TitleEntry {
  return {
    name,
    description: null,
    setToken: null,
    className: owned ? "have" : "not",
    owned,
    locked: !owned,
    inUse: false,
    settable: owned,
    unlockable: false,
    statusText: owned ? "Set" : "Not achieving the unlock condition",
    requirement: { metric, current, target },
  };
}

test("selects the first locked title in the current single ladder", () => {
  const result = selectNextTitleObjective([
    title("[S] ADVANCED LV.4", "single_pumbility", 15_828.94, 15_750, true),
    title("[S] ADVANCED LV.5", "single_pumbility", 15_828.94, 16_000),
    title("[S] ADVANCED LV.6", "single_pumbility", 15_828.94, 16_250),
    title("[D] INTERMEDIATE LV.2", "double_pumbility", 3_192.96, 6_000),
  ], "[S] ADVANCED LV.4");

  assert.deepEqual(result, {
    name: "[S] ADVANCED LV.5",
    metric: "single_pumbility",
    current: 15_828.94,
    target: 16_000,
  });
});

test("uses the closest named Pumbility objective when the current title is unrelated", () => {
  const result = selectNextTitleObjective([
    title("[S] ADVANCED LV.5", "single_pumbility", 15_828.94, 16_000),
    title("[D] INTERMEDIATE LV.2", "double_pumbility", 3_192.96, 6_000),
    title("???", "total_pumbility", 15_828.94, 16_000),
  ], "CONRAD FOLLOWER");

  assert.equal(result?.name, "[S] ADVANCED LV.5");
});
