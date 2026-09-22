import assert from "node:assert/strict";
import test from "node:test";

import {
  browserSyncSuccessMessage,
  extensionSupportsCorrelatedSync,
  parseExtensionReady,
  parseExtensionSyncResult,
  serverSyncSuccessMessage,
} from "../src/lib/browser-extension-sync.ts";

test("accepts semantic extension readiness versions", () => {
  assert.deepEqual(parseExtensionReady({ version: "0.2.0" }), { version: "0.2.0" });
  assert.deepEqual(parseExtensionReady({ version: "1.2.3.4" }), { version: "1.2.3.4" });
  assert.equal(parseExtensionReady({ version: "dev" }), null);
  assert.equal(parseExtensionReady({ version: "1.02.3" }), null);
  assert.equal(parseExtensionReady({ version: "1.2.65536" }), null);
});

test("requires a browser extension version with request correlation", () => {
  assert.equal(extensionSupportsCorrelatedSync("0.2.0"), false);
  assert.equal(extensionSupportsCorrelatedSync("0.2.1"), true);
  assert.equal(extensionSupportsCorrelatedSync("0.2.1.0"), true);
  assert.equal(extensionSupportsCorrelatedSync("0.3.0"), true);
  assert.equal(extensionSupportsCorrelatedSync("1.0.0"), true);
  assert.equal(extensionSupportsCorrelatedSync("dev"), false);
});

test("normalizes successful sync counts and formats the result", () => {
  const requestId = "d62d2ddc-3262-44e2-8f3b-dde40ff37760";
  const result = parseExtensionSyncResult({
    requestId,
    ok: true,
    importedRecentPlays: 1,
    duplicateRecentPlays: 3,
    duplicateRequest: false,
  }, requestId);
  assert.deepEqual(result, {
    ok: true,
    importedRecentPlays: 1,
    duplicateRecentPlays: 3,
    duplicateRequest: false,
  });
  assert.equal(result?.ok && browserSyncSuccessMessage(result), "1 new play, 3 already saved.");
});

test("rejects malformed success details instead of displaying zero counts", () => {
  const requestId = "d62d2ddc-3262-44e2-8f3b-dde40ff37760";
  assert.equal(parseExtensionSyncResult({ requestId, ok: true }, requestId), null);
  assert.equal(parseExtensionSyncResult({
    requestId,
    ok: true,
    importedRecentPlays: -1,
    duplicateRecentPlays: 0,
    duplicateRequest: false,
  }, requestId), null);
  assert.equal(parseExtensionSyncResult({
    requestId,
    ok: true,
    importedRecentPlays: 1,
    duplicateRecentPlays: 0,
    duplicateRequest: "false",
  }, requestId), null);
});

test("ignores a valid result from an earlier browser sync request", () => {
  assert.equal(parseExtensionSyncResult({
    requestId: "1133b35e-edb2-4dc4-9321-484907d9bea0",
    ok: true,
    importedRecentPlays: 1,
    duplicateRecentPlays: 0,
    duplicateRequest: false,
  }, "d62d2ddc-3262-44e2-8f3b-dde40ff37760"), null);
});

test("allows recovery links only on MyPIU and PIUGAME HTTPS origins", () => {
  const requestId = "d62d2ddc-3262-44e2-8f3b-dde40ff37760";
  assert.deepEqual(parseExtensionSyncResult({
    requestId,
    ok: false,
    error: "Sign in",
    recovery: { kind: "piugame", url: "https://www.piugame.com/bbs/login.php" },
  }, requestId), {
    ok: false,
    error: "Sign in",
    recovery: { kind: "piugame", url: "https://www.piugame.com/bbs/login.php" },
  });

  const rejected = parseExtensionSyncResult({
    requestId,
    ok: false,
    error: "Sign in",
    recovery: { kind: "mypiu", url: "https://example.com/phish" },
  }, requestId);
  assert.deepEqual(rejected, { ok: false, error: "Sign in", recovery: null });

  const mismatchedKind = parseExtensionSyncResult({
    requestId,
    ok: false,
    error: "Sign in",
    recovery: { kind: "mypiu", url: "https://www.piugame.com/bbs/login.php" },
  }, requestId);
  assert.deepEqual(mismatchedKind, { ok: false, error: "Sign in", recovery: null });

  const credentials = parseExtensionSyncResult({
    requestId,
    ok: false,
    error: "Sign in",
    recovery: { kind: "piugame", url: "https://user:password@www.piugame.com/bbs/login.php" },
  }, requestId);
  assert.deepEqual(credentials, { ok: false, error: "Sign in", recovery: null });
});

test("does not describe a throttled server retry as current data", () => {
  assert.equal(serverSyncSuccessMessage(false), "Server refresh complete.");
  assert.equal(
    serverSyncSuccessMessage(true),
    "A server refresh was recently requested. Retry in a few seconds if data is still stale.",
  );
});
