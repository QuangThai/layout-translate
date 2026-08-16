export interface GeometrySnapshot {
  left: number;
  top: number;
  /**
   * Document-relative position. Viewport coordinates cannot be compared across
   * a scroll, and the baseline for an anchor is taken long before the page is
   * audited.
   */
  documentLeft: number;
  documentTop: number;
  width: number;
  height: number;
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
}

export function measureElement(element: HTMLElement): GeometrySnapshot {
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    documentLeft: rect.left + window.scrollX,
    documentTop: rect.top + window.scrollY,
    width: rect.width,
    height: rect.height,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  };
}

export function hasOverflow(snapshot: GeometrySnapshot): boolean {
  return (
    snapshot.scrollWidth > snapshot.clientWidth + 1 ||
    snapshot.scrollHeight > snapshot.clientHeight + 1
  );
}

export function siblingShift(before: GeometrySnapshot, after: GeometrySnapshot): number {
  return Math.hypot(after.left - before.left, after.top - before.top);
}
