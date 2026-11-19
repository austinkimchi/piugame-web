import assert from "node:assert/strict";
import test from "node:test";
import { isLatestReleaseSong, LATEST_CATALOG_RELEASE } from "../src/lib/catalog-release.ts";
import type { PublicSong, SongCatalogHistoryEvent } from "../src/lib/types.ts";

const added = (date: string, version: SongCatalogHistoryEvent["version"] = "phoenix2"): SongCatalogHistoryEvent => ({ date, version, type: "added", note: "" });
const song = (history: SongCatalogHistoryEvent[]): Pick<PublicSong, "history" | "supportedVersions" | "removedFromVersions"> => ({ history, supportedVersions: ["phoenix2"], removedFromVersions: [] });

test("NEW identifies the verified current release additions", () => {
  assert.equal(LATEST_CATALOG_RELEASE.patch, "v1.02.0");
  assert.equal(isLatestReleaseSong(song([added("2026-10-15")])), true);
  // Notes are editorial text, not the release identity.
  assert.equal(isLatestReleaseSong(song([{ ...added("2026-10-15"), note: "Steam Link exclusive." }])), true);
});

test("earlier Phoenix 2 releases, unknown history and future teasers are not NEW", () => {
  for (const history of [[], [added("2026-07-09")], [added("2026-08-27")], [added("2026-11-24")]]) {
    assert.equal(isLatestReleaseSong(song(history)), false);
  }
});

test("chart-only changes, other versions and removed songs are not NEW", () => {
  assert.equal(isLatestReleaseSong(song([added("2026-07-09"), { ...added("2026-10-15"), type: "changed" }])), false);
  assert.equal(isLatestReleaseSong(song([added("2026-10-15", "phoenix")])), false);
  assert.equal(isLatestReleaseSong({ ...song([added("2026-10-15")]), supportedVersions: ["phoenix"] }), false);
  assert.equal(isLatestReleaseSong({ ...song([added("2026-10-15")]), removedFromVersions: ["phoenix2"] }), false);
});
