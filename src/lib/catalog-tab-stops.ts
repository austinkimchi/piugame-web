/** CSS-hidden chart chips and disabled previews must not become tab boundaries. */
export function catalogTabStops(container: ParentNode, style: (element: Element) => Pick<CSSStyleDeclaration, "visibility"> = getComputedStyle): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("a[href],button,[tabindex]")].filter((element) => {
    if (element.tabIndex < 0 || element.matches(":disabled") || element.closest("[inert]") || element.getClientRects().length === 0) return false;
    const visibility = style(element).visibility;
    return visibility !== "hidden" && visibility !== "collapse";
  });
}
