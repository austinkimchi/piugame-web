import assert from "node:assert/strict";
import test from "node:test";

import {
  MobileSyncValidationError,
  parseMobilePerformanceImport,
} from "../src/lib/mobile-sync-schema.ts";

const NOW = new Date("2026-09-22T02:00:00.000Z");

test("normalizes a device-owned performance payload", () => {
  const parsed = parseMobilePerformanceImport(validPayload(), NOW);

  assert.equal(parsed.source, "ios");
  assert.equal(parsed.generatedAt, "2026-09-22T01:55:00.000Z");
  assert.equal(parsed.profile.username, "fixture_user");
  assert.equal(parsed.profile.displayName, "PLAYER # 1234");
  assert.deepEqual(parsed.profile.plateCounts, { rg: 12 });
  assert.equal(parsed.recentPlays[0].mode, "S");
  assert.equal(parsed.recentPlays[0].score, 954_848);
  assert.equal(parsed.recentPlays[0].judgments.perfect, 1_234);
});

test("minimal extension payload receives safe nullable defaults", () => {
  const payload = validPayload();
  delete payload.appVersion;
  delete payload.profile.plateCounts;
  delete payload.recentPlays[0].judgments;
  payload.source = "browser-extension";

  const parsed = parseMobilePerformanceImport(payload, NOW);
  assert.equal(parsed.appVersion, null);
  assert.deepEqual(parsed.profile.plateCounts, {});
  assert.deepEqual(parsed.recentPlays[0].judgments, {
    perfect: null,
    great: null,
    good: null,
    bad: null,
    miss: null,
  });
});

test("rejects PIUGAME credentials and raw HTML anywhere in the payload", () => {
  const withPassword = validPayload();
  withPassword.profile.password = "do-not-upload";
  assert.throws(
    () => parseMobilePerformanceImport(withPassword, NOW),
    (error: unknown) => error instanceof MobileSyncValidationError && error.field === "password",
  );

  const withHtml = validPayload();
  withHtml.recentPlays[0].rawHtml = "<div>private page</div>";
  assert.throws(
    () => parseMobilePerformanceImport(withHtml, NOW),
    (error: unknown) => error instanceof MobileSyncValidationError && error.field === "rawHtml",
  );
});

test("rejects unsupported versions, invalid charts, and future snapshots", () => {
  const wrongSchema = validPayload();
  wrongSchema.schemaVersion = 2;
  assert.throws(() => parseMobilePerformanceImport(wrongSchema, NOW), MobileSyncValidationError);

  const invalidChart = validPayload();
  invalidChart.recentPlays[0].level = "S19";
  assert.throws(() => parseMobilePerformanceImport(invalidChart, NOW), MobileSyncValidationError);

  const future = validPayload();
  future.generatedAt = "2026-09-22T02:11:00.000Z";
  assert.throws(() => parseMobilePerformanceImport(future, NOW), MobileSyncValidationError);
});

interface TestPayload extends Record<string, unknown> {
  schemaVersion: number;
  source: string;
  appVersion?: string;
  generatedAt: string;
  profile: Record<string, unknown>;
  recentPlays: Array<Record<string, unknown>>;
}

function validPayload(): TestPayload {
  return {
    schemaVersion: 1,
    idempotencyKey: "ios:fixture-install:2026-09-22T01:55:00Z",
    installationId: "fixture-install",
    source: "ios",
    appVersion: "0.1.0",
    piuVersion: "phoenix2",
    generatedAt: "2026-09-22T01:55:00.000Z",
    profile: {
      username: " fixture_user ",
      displayName: " PLAYER   #   1234 ",
      titleName: "CONRAD FOLLOWER",
      gameId: "PLAYER",
      pumpTag: "PLAYER#1234",
      avatarUrl: "https://www.piugame.com/avatar.png",
      pumbilityScore: 15_770.43,
      pp: null,
      rating: 18_318,
      playCount: 1_200,
      clearCount: 640,
      totalCharts: 3_900,
      progressPercent: 16,
      plateCounts: { RG: 12 },
      recentArcade: "ROUND1",
      lastAccess: "2026-09-22 10:55:00",
    },
    recentPlays: [
      {
        songName: "BATTLE NO.1",
        mode: "s",
        level: "19",
        score: 954_848,
        grade: "S",
        plate: "RG",
        stageBreak: false,
        judgments: {
          perfect: 1_234,
          great: 20,
          good: 4,
          bad: 0,
          miss: 1,
        },
        playedAt: "2026-09-22 10:55:00 (GMT+9)",
      },
    ],
  };
}
