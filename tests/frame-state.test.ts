import { describe, expect, it } from "vitest";
import { aggregateFrameStates } from "../src/shared/frame-state";

describe("frame state aggregation", () => {
  it("adds up the anchors a reader sees across frames", () => {
    expect(aggregateFrameStates([
      { status: "rendered", translatedAnchors: 12 },
      { status: "rendered", translatedAnchors: 5 },
    ])).toEqual({ status: "rendered", translatedAnchors: 17, withheldAnchors: 0 });
  });

  it("shows the state that most needs attention, not the last to report", () => {
    expect(aggregateFrameStates([
      { status: "rendered", translatedAnchors: 10 },
      { status: "translating", translatedAnchors: 0 },
    ]).status).toBe("translating");

    expect(aggregateFrameStates([
      { status: "translating", translatedAnchors: 0 },
      { status: "error", translatedAnchors: 0, lastError: "unauthorized" },
    ])).toMatchObject({ status: "error", lastError: "unauthorized" });
  });

  it("does not let one non-Japanese frame make the whole tab unsupported", () => {
    expect(aggregateFrameStates([
      { status: "unsupported", translatedAnchors: 0 },
      { status: "rendered", translatedAnchors: 8 },
    ])).toEqual({ status: "rendered", translatedAnchors: 8, withheldAnchors: 0 });
  });

  it("reports unsupported only when no frame had anything to translate", () => {
    expect(aggregateFrameStates([
      { status: "unsupported", translatedAnchors: 0 },
      { status: "unsupported", translatedAnchors: 0 },
    ]).status).toBe("unsupported");
  });

  it("keeps the first error rather than the last frame's", () => {
    expect(aggregateFrameStates([
      { status: "error", translatedAnchors: 0, lastError: "first" },
      { status: "error", translatedAnchors: 0, lastError: "second" },
    ]).lastError).toBe("first");
  });

  it("falls back to inactive for a tab with no frames reporting", () => {
    expect(aggregateFrameStates([])).toEqual({ status: "inactive", translatedAnchors: 0, withheldAnchors: 0 });
  });

  it("adds up the strings each frame kept on the device", () => {
    expect(aggregateFrameStates([
      { status: "rendered", translatedAnchors: 10, withheldAnchors: 2 },
      { status: "rendered", translatedAnchors: 4, withheldAnchors: 3 },
      { status: "rendered", translatedAnchors: 1 },
    ])).toMatchObject({ translatedAnchors: 15, withheldAnchors: 5 });
  });

  it("ignores a frame that reported a nonsense count", () => {
    expect(aggregateFrameStates([
      { status: "rendered", translatedAnchors: Number.NaN },
      { status: "rendered", translatedAnchors: 3 },
    ]).translatedAnchors).toBe(3);
  });
});
