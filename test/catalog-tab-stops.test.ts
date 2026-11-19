import assert from "node:assert/strict";
import test from "node:test";
import { catalogTabStops } from "../src/lib/catalog-tab-stops.ts";

function control(name: string, options: { tabIndex?: number; displayed?: boolean; disabled?: boolean; inert?: boolean; visibility?: string } = {}) {
  return {
    name, visibility: options.visibility ?? "visible", tabIndex: options.tabIndex ?? 0,
    getClientRects: () => options.displayed === false ? [] : [{}],
    matches: () => Boolean(options.disabled),
    closest: () => options.inert ? {} : null,
  };
}
function stops(controls: ReturnType<typeof control>[]) {
  const container = { querySelectorAll: () => controls } as unknown as ParentNode;
  return catalogTabStops(container, (element) => ({ visibility: (element as unknown as ReturnType<typeof control>).visibility }));
}

test("phone-width forward and reverse boundaries exclude CSS-hidden chart chips", () => {
  const link = control("song link");
  const hiddenChart = control("S18", { displayed: false });
  const mutedPreview = control("preview", { disabled: true });
  assert.deepEqual(stops([link, mutedPreview, hiddenChart]), [link]);
  const preview = control("preview");
  const visible = stops([link, preview, hiddenChart]);
  assert.equal(visible[0], link, "reverse traversal can reach the visible song link");
  assert.equal(visible.at(-1), preview, "forward traversal uses the last visible enabled control");
});

test("visibility, negative tabindex, inherited disabled state and inert ancestry exclude candidates", () => {
  const link = control("song link");
  assert.deepEqual(stops([
    link, control("hidden", { visibility: "hidden" }), control("collapsed", { visibility: "collapse" }),
    control("programmatic only", { tabIndex: -1 }), control("disabled fieldset", { disabled: true }), control("inert", { inert: true }),
  ]), [link]);
});
