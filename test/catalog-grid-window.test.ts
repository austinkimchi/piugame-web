import assert from "node:assert/strict";
import test from "node:test";
import { catalogGridWindow } from "../src/lib/catalog-grid-window.ts";

test("675 songs retain bounded mobile and desktop windows without clipping the last row", () => {
  for (const columns of [3, 4, 5]) {
    const initial = catalogGridWindow({ count: 675, columns, rowHeight: 200, viewportTop: 0, viewportHeight: 844 });
    assert.equal(initial[0], 0);
    assert.ok(initial.length <= 45);
    const bottom = catalogGridWindow({ count: 675, columns, rowHeight: 200, viewportTop: Math.ceil(675 / columns) * 200 - 844, viewportHeight: 844 });
    assert.equal(bottom.at(-1), 674);
    assert.ok(bottom.length <= 45);
    assert.equal(new Set(bottom).size, bottom.length);
  }
});

test("keeps an offscreen focused row mounted while scrolling and supports adjacent keyboard focus", () => {
  const view = { count: 675, columns: 3, rowHeight: 200, viewportTop: 10_000, viewportHeight: 844 };
  const focused = catalogGridWindow({ ...view, focusedIndex: 1 });
  assert.ok(focused.includes(1));
  assert.ok(focused.includes(0));
  assert.ok(focused.length < 40);
  const initial = catalogGridWindow({ ...view, viewportTop: 0 });
  const next = initial.at(-1)! + 1;
  assert.ok(catalogGridWindow({ ...view, viewportTop: 0, focusedIndex: next }).includes(next));
});

test("empty and newly narrowed results do not produce invalid indexes", () => {
  assert.deepEqual(catalogGridWindow({ count: 0, columns: 3, rowHeight: 200, viewportTop: 10_000, viewportHeight: 844 }), []);
  assert.deepEqual(catalogGridWindow({ count: 2, columns: 3, rowHeight: 200, viewportTop: 10_000, viewportHeight: 844, focusedIndex: 500 }), [0, 1]);
});
