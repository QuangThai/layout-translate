import { describe, expect, it } from "vitest";
import { hasOverflow, siblingShift, type GeometrySnapshot } from "../src/shared/geometry";

const snapshot = (overrides: Partial<GeometrySnapshot> = {}): GeometrySnapshot => ({
  left: 0,
  top: 0,
  documentLeft: 0,
  documentTop: 0,
  width: 320,
  height: 48,
  scrollWidth: 320,
  clientWidth: 320,
  scrollHeight: 48,
  clientHeight: 48,
  ...overrides,
});

describe("geometry proof helpers", () => {
  it("accepts a region that fits within its measured box", () => {
    expect(hasOverflow(snapshot())).toBe(false);
  });

  it("detects horizontal overflow beyond the tolerance", () => {
    expect(hasOverflow(snapshot({ scrollWidth: 322 }))).toBe(true);
  });

  it("measures the Euclidean shift of a sibling", () => {
    expect(siblingShift(snapshot(), snapshot({ left: 3, top: 4 }))).toBe(5);
  });
});
