/** Keyboard navigation and dismissal for the open catalog-version menu. */
export function manageVersionMenu(menu: HTMLElement, trigger: HTMLElement, close: () => void) {
  const document = menu.ownerDocument;
  const focus = (element: HTMLElement) => element.focus({ preventScroll: true });
  const items = () => [...menu.querySelectorAll<HTMLElement>("[role='menuitemradio']:not(:disabled)")];
  const contains = (target: EventTarget | null) => menu.contains(target as Node) || trigger.contains(target as Node);

  function keyDown(event: KeyboardEvent) {
    if (!contains(event.target)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      focus(trigger);
    } else if (event.key === "Tab") {
      // Let the browser move to the next/previous control outside the menu.
      // Start from the trigger so unmounting the active option cannot lose focus.
      focus(trigger);
      close();
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const options = items();
      if (!options.length) return;
      const current = options.indexOf(document.activeElement as HTMLElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
        : event.key === "ArrowDown" ? (current + 1) % options.length
          : (current < 0 ? options.length - 1 : (current + options.length - 1) % options.length);
      focus(options[next]);
    }
  }
  function dismissOutside(event: Event) {
    if (!contains(event.target)) close();
  }

  const options = items();
  focus(options.find((item) => item.getAttribute("aria-checked") === "true") ?? options[0] ?? trigger);
  document.addEventListener("keydown", keyDown);
  document.addEventListener("pointerdown", dismissOutside);
  document.addEventListener("focusin", dismissOutside);
  return () => {
    document.removeEventListener("keydown", keyDown);
    document.removeEventListener("pointerdown", dismissOutside);
    document.removeEventListener("focusin", dismissOutside);
  };
}
