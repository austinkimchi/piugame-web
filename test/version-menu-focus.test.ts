import assert from "node:assert/strict";
import test from "node:test";
import { manageVersionMenu } from "../src/lib/version-menu-focus.ts";

class MenuDocument extends EventTarget {
  activeElement: MenuElement | null = null;
}
class MenuElement {
  children: MenuElement[] = [];
  disabled = false;
  checked = false;
  readonly ownerDocument: MenuDocument;
  constructor(ownerDocument: MenuDocument) { this.ownerDocument = ownerDocument; }
  contains(element: MenuElement) { return element === this || this.children.includes(element); }
  querySelectorAll() { return this.children.filter((item) => !item.disabled); }
  getAttribute() { return String(this.checked); }
  focus(options: FocusOptions) {
    assert.equal(options.preventScroll, true);
    this.ownerDocument.activeElement = this;
  }
  html() { return this as unknown as HTMLElement; }
}
function fixture(disabled = false) {
  const document = new MenuDocument();
  const trigger = new MenuElement(document);
  const menu = new MenuElement(document);
  const first = new MenuElement(document);
  const selected = new MenuElement(document);
  const outside = new MenuElement(document);
  selected.checked = true;
  first.disabled = selected.disabled = disabled;
  menu.children = [first, selected];
  let closes = 0;
  const cleanup = manageVersionMenu(menu.html(), trigger.html(), () => { closes++; });
  function event(type: string, target = document.activeElement, key?: string) {
    const value = Object.assign(new Event(type, { cancelable: true }), { key });
    Object.defineProperty(value, "target", { value: target });
    document.dispatchEvent(value);
    return value;
  }
  return { document, trigger, menu, first, selected, outside, cleanup, event, closes: () => closes };
}

test("menu focuses the selected version, wraps arrows, and supports Home/End without saving", () => {
  const f = fixture();
  assert.equal(f.document.activeElement, f.selected);
  assert.equal(f.event("keydown", f.selected, "ArrowDown").defaultPrevented, true);
  assert.equal(f.document.activeElement, f.first);
  f.event("keydown", f.first, "ArrowUp");
  assert.equal(f.document.activeElement, f.selected);
  f.event("keydown", f.selected, "Home");
  assert.equal(f.document.activeElement, f.first);
  f.event("keydown", f.first, "End");
  assert.equal(f.document.activeElement, f.selected);
  assert.equal(f.closes(), 0);
  f.cleanup();
});

test("Escape closes and restores the trigger, while Tab keeps native navigation", () => {
  for (const key of ["Escape", "Tab"]) {
    const f = fixture();
    const event = f.event("keydown", f.selected, key);
    assert.equal(event.defaultPrevented, key === "Escape");
    assert.equal(f.closes(), 1);
    assert.equal(f.document.activeElement, f.trigger);
    f.cleanup();
  }
});

test("outside pointer/focus dismisses without stealing focus; trigger and options remain inside", () => {
  const f = fixture();
  f.event("pointerdown", f.trigger);
  f.event("focusin", f.first);
  assert.equal(f.closes(), 0);
  f.document.activeElement = f.outside;
  f.event("focusin", f.outside);
  f.event("pointerdown", f.outside);
  assert.equal(f.closes(), 2);
  assert.equal(f.document.activeElement, f.outside);
  assert.equal(f.event("keydown", f.outside, "Escape").defaultPrevented, false);
  assert.equal(f.closes(), 2);
  f.cleanup();
});

test("disabled versions stay unfocusable and dynamic disabled items are skipped", () => {
  const empty = fixture(true);
  assert.equal(empty.document.activeElement, empty.trigger);
  empty.event("keydown", empty.trigger, "ArrowDown");
  assert.equal(empty.document.activeElement, empty.trigger);
  empty.cleanup();
  const f = fixture();
  f.first.disabled = true;
  f.event("keydown", f.selected, "ArrowDown");
  assert.equal(f.document.activeElement, f.selected);
  f.cleanup();
});

test("closing removes every listener before the next menu instance", () => {
  const f = fixture();
  f.cleanup();
  f.event("keydown", f.selected, "Escape");
  f.event("pointerdown", f.outside);
  f.event("focusin", f.outside);
  assert.equal(f.closes(), 0);
});
