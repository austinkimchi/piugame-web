import assert from "node:assert/strict";
import test from "node:test";

import { safeInternalRedirectPath } from "../src/lib/redirect-path.ts";

test("safeInternalRedirectPath preserves local paths", () => {
  assert.equal(safeInternalRedirectPath("/songs?sort=title#charts"), "/songs?sort=title#charts");
});

test("safeInternalRedirectPath rejects external redirect forms", () => {
  assert.equal(safeInternalRedirectPath("//evil.example/path"), "/");
  assert.equal(safeInternalRedirectPath("/\\evil.example/path"), "/");
  assert.equal(safeInternalRedirectPath("https://evil.example/path"), "/");
  assert.equal(safeInternalRedirectPath(null), "/");
});
