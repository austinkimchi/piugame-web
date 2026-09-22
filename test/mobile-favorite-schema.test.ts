import assert from "node:assert/strict";
import test from "node:test";

import {
  MobileFavoriteValidationError,
  parseMobileFavoriteUpdate,
} from "../src/lib/mobile-favorite-schema.ts";

test("parses a versioned mobile favorite update", () => {
  assert.deepEqual(parseMobileFavoriteUpdate({ saved: true, version: "phoenix2" }), {
    saved: true,
    version: "phoenix2",
  });
  assert.deepEqual(parseMobileFavoriteUpdate({ saved: false, version: "phoenix" }), {
    saved: false,
    version: "phoenix",
  });
});

test("rejects ambiguous mobile favorite updates", () => {
  const invalid = [
    null,
    [],
    {},
    { saved: 1, version: "phoenix2" },
    { saved: true },
    { saved: true, version: "xx" },
  ];

  for (const value of invalid) {
    assert.throws(() => parseMobileFavoriteUpdate(value), MobileFavoriteValidationError);
  }
});
