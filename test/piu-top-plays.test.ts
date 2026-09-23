import assert from "node:assert/strict";
import test from "node:test";

import type { TopPlay, TopPlayMode } from "@austinkimchi/piugame-sdk";

import { fetchPumbilityTopPlays, rankPumbilityTopPlays } from "../src/lib/piu-top-plays.ts";

test("Phoenix 2 fetches single and double Pumbility feeds", async () => {
  const requestedModes: Array<TopPlayMode | undefined> = [];
  const client = {
    async getTopPlays(_username: string, mode?: TopPlayMode): Promise<TopPlay[]> {
      requestedModes.push(mode);
      return mode === "single"
        ? [topPlay("Single", "S", 1, 310.25)]
        : [topPlay("Double", "D", 1, 325.5)];
    },
  };

  const plays = await fetchPumbilityTopPlays(client, "player", "phoenix2");

  assert.deepEqual(requestedModes, ["single", "double"]);
  assert.deepEqual(plays.map((play) => [play.songName, play.rank, play.score]), [
    ["Double", 1, 325.5],
    ["Single", 2, 310.25],
  ]);
});

test("Phoenix keeps the legacy combined Pumbility request", async () => {
  const requestedModes: Array<TopPlayMode | undefined> = [];
  const client = {
    async getTopPlays(_username: string, mode?: TopPlayMode): Promise<TopPlay[]> {
      requestedModes.push(mode);
      return [topPlay("Legacy", "S", 1, 300)];
    },
  };

  const plays = await fetchPumbilityTopPlays(client, "player", "phoenix");

  assert.deepEqual(requestedModes, [undefined]);
  assert.equal(plays[0]?.songName, "Legacy");
});

test("combined Pumbility rankings keep missing scores last", () => {
  const plays = rankPumbilityTopPlays([
    topPlay("Unknown", "D", 1, null),
    topPlay("Lower", "S", 2, 250.25),
    topPlay("Higher", "D", 2, 250.5),
  ]);

  assert.deepEqual(plays.map((play) => [play.songName, play.rank]), [
    ["Higher", 1],
    ["Lower", 2],
    ["Unknown", 3],
  ]);
});

function topPlay(
  songName: string,
  mode: string,
  rank: number,
  score: number | null,
): TopPlay {
  return {
    rank,
    songName,
    artist: null,
    songImageUrl: null,
    mode,
    level: "20",
    grade: "ss",
    plate: "s_sg",
    score,
    playedAt: null,
  };
}
