import assert from "node:assert/strict";
import test from "node:test";

import {
  browserSyncSuccessMessage,
  parseExtensionReady,
  parseExtensionSyncResult,
} from "../src/lib/browser-extension-sync.ts";

test("accepts semantic extension readiness versions", () => {
  assert.deepEqual(parseExtensionReady({ version: "0.2.0" }), { version: "0.2.0" });
  assert.deepEqual(parseExtensionReady({ version: "1.2.3.4" }), { version: "1.2.3.4" });
  assert.equal(parseExtensionReady({ version: "dev" }), null);
  assert.equal(parseExtensionReady({ version: "1.02.3" }), null);
  assert.equal(parseExtensionReady({ version: "1.2.65536" }), null);
});

test("normalizes successful sync counts and formats the result", () => {
  const result = parseExtensionSyncResult({
    ok: true,
    importedRecentPlays: 1,
    duplicateRecentPlays: 3,
    duplicateRequest: false,
  });
  assert.deepEqual(result, {
    ok: true,
    importedRecentPlays: 1,
    duplicateRecentPlays: 3,
    duplicateRequest: false,
  });
  assert.equal(result?.ok && browserSyncSuccessMessage(result), "1 new play, 3 already saved.");
});

test("rejects malformed success details instead of displaying zero counts", () => {
  assert.equal(parseExtensionSyncResult({ ok: true }), null);
  assert.equal(parseExtensionSyncResult({
    ok: true,
    importedRecentPlays: -1,
    duplicateRecentPlays: 0,
    duplicateRequest: false,
  }), null);
  assert.equal(parseExtensionSyncResult({
    ok: true,
    importedRecentPlays: 1,
    duplicateRecentPlays: 0,
    duplicateRequest: "false",
  }), null);
});

test("allows recovery links only on MyPIU and PIUGAME HTTPS origins", () => {
  assert.deepEqual(parseExtensionSyncResult({
    ok: false,
    error: "Sign in",
    recovery: { kind: "piugame", url: "https://www.piugame.com/bbs/login.php" },
  }), {
    ok: false,
    error: "Sign in",
    recovery: { kind: "piugame", url: "https://www.piugame.com/bbs/login.php" },
  });

  const rejected = parseExtensionSyncResult({
    ok: false,
    error: "Sign in",
    recovery: { kind: "mypiu", url: "https://example.com/phish" },
  });
  assert.deepEqual(rejected, { ok: false, error: "Sign in", recovery: null });

  const mismatchedKind = parseExtensionSyncResult({
    ok: false,
    error: "Sign in",
    recovery: { kind: "mypiu", url: "https://www.piugame.com/bbs/login.php" },
  });
  assert.deepEqual(mismatchedKind, { ok: false, error: "Sign in", recovery: null });

  const credentials = parseExtensionSyncResult({
    ok: false,
    error: "Sign in",
    recovery: { kind: "piugame", url: "https://user:password@www.piugame.com/bbs/login.php" },
  });
  assert.deepEqual(credentials, { ok: false, error: "Sign in", recovery: null });
});
