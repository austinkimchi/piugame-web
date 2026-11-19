import assert from "node:assert/strict";
import test from "node:test";
import { manageDialogFocus } from "../src/lib/dialog-focus.ts";

class FocusDocument extends EventTarget {
  activeElement: FocusElement | null = null;
  modals: FocusElement[] = [];
  querySelectorAll() { return this.modals; }
}
class FocusElement {
  tagName = "button";
  tabIndex = 0;
  disabled = false;
  hidden = false;
  visible = true;
  isConnected = true;
  focusCount = 0;
  children: FocusElement[] = [];
  readonly ownerDocument: FocusDocument;
  constructor(ownerDocument: FocusDocument) { this.ownerDocument = ownerDocument; }
  focus(options: FocusOptions) {
    assert.equal(options.preventScroll, true, "Opening/closing must retain the catalog scroll position");
    this.ownerDocument.activeElement = this;
    this.focusCount += 1;
  }
  matches() { return this.disabled; }
  closest() { return this.hidden ? this : null; }
  getClientRects() { return this.visible ? [{}] : []; }
  querySelectorAll(selector: string) {
    return this.children.filter((child) => selector.split(",").includes(child.tagName));
  }
  contains(element: FocusElement | null) { return element === this || this.children.includes(element!); }
  asHTMLElement() { return this as unknown as HTMLElement; }
}
function key(document: FocusDocument, value = "Tab", shiftKey = false) {
  const event = Object.assign(new Event("keydown", { cancelable: true }), { key: value, shiftKey });
  document.dispatchEvent(event);
  return event;
}
function focusIn(document: FocusDocument, element: FocusElement) {
  document.activeElement = element;
  document.dispatchEvent(Object.defineProperty(new Event("focusin"), "target", { value: element }));
}
function fixture() {
  const document = new FocusDocument();
  const trigger = new FocusElement(document);
  const dialog = new FocusElement(document);
  dialog.tabIndex = -1;
  const [first, close, last] = Array.from({ length: 3 }, () => new FocusElement(document));
  dialog.children = [first, close, last];
  document.activeElement = trigger;
  return { document, trigger, dialog, first, close, last };
}

test("dialog focuses close without scrolling, traps both Tab boundaries, and restores its invoker", () => {
  const f = fixture();
  const cleanup = manageDialogFocus(f.dialog.asHTMLElement(), f.close.asHTMLElement());
  assert.equal(f.document.activeElement, f.close);
  assert.equal(key(f.document).defaultPrevented, false, "Interior Tab keeps native order");
  f.document.activeElement = f.last;
  assert.equal(key(f.document).defaultPrevented, true);
  assert.equal(f.document.activeElement, f.first);
  assert.equal(key(f.document, "Tab", true).defaultPrevented, true);
  assert.equal(f.document.activeElement, f.last);
  assert.equal(key(f.document, "Escape").defaultPrevented, false, "The existing modal close handler owns Escape");
  cleanup();
  assert.equal(f.document.activeElement, f.trigger);
  assert.equal(key(f.document).defaultPrevented, false, "Closed dialog must not retain keyboard handlers");
});

test("Tab reevaluates current enabled and visible controls instead of retaining stale async content", () => {
  const f = fixture();
  const cleanup = manageDialogFocus(f.dialog.asHTMLElement(), f.close.asHTMLElement());
  f.first.disabled = true;
  f.last.hidden = true;
  const hiddenPanel = new FocusElement(f.document);
  hiddenPanel.visible = false;
  f.dialog.children.push(hiddenPanel);
  assert.equal(key(f.document).defaultPrevented, true);
  assert.equal(f.document.activeElement, f.close);
  const newLast = new FocusElement(f.document);
  f.dialog.children.push(newLast);
  f.document.activeElement = newLast;
  key(f.document);
  assert.equal(f.document.activeElement, f.close);
  f.document.activeElement = f.trigger;
  key(f.document, "Tab", true);
  assert.equal(f.document.activeElement, newLast, "An escaped focus is brought inside the active dialog");
  cleanup();
});

test("rapid close/reopen uses the new invoker and does not revive the prior keyboard scope", () => {
  const f = fixture();
  const cleanup = manageDialogFocus(f.dialog.asHTMLElement(), f.close.asHTMLElement());
  cleanup();
  const nextTrigger = new FocusElement(f.document);
  f.document.activeElement = nextTrigger;
  const nextDialog = new FocusElement(f.document);
  nextDialog.tabIndex = -1;
  const close = new FocusElement(f.document);
  nextDialog.children = [close];
  const cleanupNext = manageDialogFocus(nextDialog.asHTMLElement(), close.asHTMLElement());
  key(f.document);
  assert.equal(f.document.activeElement, close);
  cleanupNext();
  assert.equal(f.document.activeElement, nextTrigger);
  assert.equal(f.trigger.focusCount, 1);
});

test("empty dialog uses its focusable container and never restores a disconnected invoker", () => {
  const f = fixture();
  f.dialog.children = [];
  const cleanup = manageDialogFocus(f.dialog.asHTMLElement(), null);
  assert.equal(f.document.activeElement, f.dialog);
  assert.equal(key(f.document).defaultPrevented, true);
  f.trigger.isConnected = false;
  cleanup();
  assert.equal(f.trigger.focusCount, 0);
  assert.equal(key(f.document).defaultPrevented, false);
});

test("a separate modal keeps keyboard and focus ownership until it closes", () => {
  const f = fixture();
  const cleanup = manageDialogFocus(f.dialog.asHTMLElement(), f.close.asHTMLElement());
  const portal = new FocusElement(f.document);
  const field = new FocusElement(f.document);
  portal.children = [field];
  f.document.modals = [f.dialog, portal];
  f.document.activeElement = field;
  assert.equal(key(f.document).defaultPrevented, false);
  assert.equal(f.document.activeElement, field);
  portal.visible = false;
  assert.equal(key(f.document).defaultPrevented, true, "Hidden popups do not disable the notebook scope");
  assert.equal(f.document.activeElement, f.first);
  portal.visible = true;
  f.document.activeElement = field;
  cleanup();
  assert.equal(f.document.activeElement, field, "Notebook cleanup must not steal a live popup's focus");
});

test("native tag disclosures and video frames remain in the keyboard boundaries", () => {
  const f = fixture();
  const summary = new FocusElement(f.document);
  summary.tagName = "summary";
  const frame = new FocusElement(f.document);
  frame.tagName = "iframe";
  f.dialog.children.push(summary, frame);
  const cleanup = manageDialogFocus(f.dialog.asHTMLElement(), f.close.asHTMLElement());
  f.document.activeElement = f.last;
  assert.equal(key(f.document).defaultPrevented, false, "The preceding button must reach the native disclosure");
  f.document.activeElement = summary;
  assert.equal(key(f.document).defaultPrevented, false, "The disclosure must reach the video frame");
  f.document.activeElement = frame;
  assert.equal(key(f.document).defaultPrevented, true);
  assert.equal(f.document.activeElement, f.first);
  key(f.document, "Tab", true);
  assert.equal(f.document.activeElement, frame, "Reverse wrapping includes the last native control");
  frame.hidden = true;
  f.document.activeElement = f.first;
  key(f.document, "Tab", true);
  assert.equal(f.document.activeElement, summary, "Hidden frames do not hide the preceding disclosure boundary");
  cleanup();
});

test("focus leaving a final iframe is contained without trapping another modal or the restored invoker", () => {
  const f = fixture();
  const cleanup = manageDialogFocus(f.dialog.asHTMLElement(), f.close.asHTMLElement());
  focusIn(f.document, f.trigger);
  assert.equal(f.document.activeElement, f.first, "Iframe key events need not reach the parent document");
  focusIn(f.document, f.last);
  assert.equal(f.document.activeElement, f.last, "Internal focus retains its native position");
  const portal = new FocusElement(f.document);
  f.document.modals = [f.dialog, portal];
  focusIn(f.document, portal);
  assert.equal(f.document.activeElement, portal);
  portal.visible = false;
  // Simulate a synchronous focus event during redirection, as in a real DOM.
  const focus = f.first.focus.bind(f.first);
  f.first.focus = (options) => { focus(options); focusIn(f.document, f.first); };
  focusIn(f.document, f.trigger);
  assert.equal(f.document.activeElement, f.first);
  cleanup();
  focusIn(f.document, f.trigger);
  assert.equal(f.document.activeElement, f.trigger, "Cleanup removes focus containment before restoring the card");
});
