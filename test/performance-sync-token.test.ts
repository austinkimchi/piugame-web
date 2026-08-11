import assert from "node:assert/strict";
import test from "node:test";

import { createPerformanceSyncTokenWithSecret, verifyPerformanceSyncTokenWithSecret } from "../src/lib/performance-sync-token-core.ts";

const SECRET = "test-performance-sync-token-secret";

test("verifies a freshly created performance sync token", () => {
  const token = createPerformanceSyncTokenWithSecret("64b8b8b8b8b8b8b8b8b8b8b8", SECRET);
  assert.equal(verifyPerformanceSyncTokenWithSecret(token, SECRET), "64b8b8b8b8b8b8b8b8b8b8b8");
});

test("rejects tampered performance sync tokens", () => {
  const token = createPerformanceSyncTokenWithSecret("64b8b8b8b8b8b8b8b8b8b8b8", SECRET);
  assert.equal(verifyPerformanceSyncTokenWithSecret(`${token}x`, SECRET), null);
});
