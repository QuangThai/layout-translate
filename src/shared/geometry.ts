export interface GeometrySnapshot {
  left: number;
  top: number;
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
