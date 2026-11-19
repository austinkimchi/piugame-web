/** Keep keyboard navigation in an open dialog and return to its invoker on close. */
export function manageDialogFocus(dialog: HTMLElement, initialFocus: HTMLElement | null) {
  const document = dialog.ownerDocument;
  const previousFocus = document.activeElement as HTMLElement | null;
  const focus = (element: HTMLElement) => element.focus({ preventScroll: true });

  // A nested/portal dialog owns its own keyboard scope. Do not pull focus back
  // into the notebook while that separate modal is open.
  function anotherModalOpen() {
    return [...document.querySelectorAll<HTMLElement>("[role='dialog'][aria-modal='true'],dialog[open]")]
      .some((modal) => !modal.contains(dialog) && modal.getClientRects().length > 0
        && !modal.closest("[hidden],[inert],[aria-hidden='true']"));
  }

  function tabStops() {
    return [...dialog.querySelectorAll<HTMLElement>("a[href],button,input,select,textarea,[tabindex]")]
      .filter((element) => element.tabIndex >= 0 && !element.matches(":disabled")
        && !element.closest("[hidden],[inert],[aria-hidden='true']") && element.getClientRects().length > 0);
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key !== "Tab" || anotherModalOpen()) return;
    const stops = tabStops();
    const first = stops[0] ?? dialog;
    const last = stops.at(-1) ?? dialog;
    const active = document.activeElement;
    if (!stops.length || !dialog.contains(active) || (event.shiftKey ? active === first : active === last)) {
      event.preventDefault();
      focus(event.shiftKey ? last : first);
    }
  }

  focus(initialFocus ?? tabStops()[0] ?? dialog);
  document.addEventListener("keydown", handleKeyDown);
  return () => {
    document.removeEventListener("keydown", handleKeyDown);
    if (!anotherModalOpen() && previousFocus?.isConnected && typeof previousFocus.focus === "function") focus(previousFocus);
  };
}
