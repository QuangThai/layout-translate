import { describe, expect, it } from "vitest";
import {
  estimateCharacterBudget,
  MAX_COMPACT_BUDGET,
  MIN_COMPACT_BUDGET,
  narrowestBudget,
  needsCompactBudget,
} from "../src/shared/text-fit";

describe("compact character budget", () => {
  it("converts available width into characters the provider can count", () => {
    expect(estimateCharacterBudget(120, 8)).toBe(15);
    expect(estimateCharacterBudget(119, 8)).toBe(14);
  });

  it("sends no budget when the box is too narrow for an honest label", () => {
    // A control sized to dense Japanese can be narrower than any accurate
    // translation; asking for that width produced wrong words, so the
    // compact-then-ellipsis fallback handles those instead.
    expect(estimateCharacterBudget(4, 8)).toBeNull();
    expect(estimateCharacterBudget((MIN_COMPACT_BUDGET - 1) * 8, 8)).toBeNull();
    expect(estimateCharacterBudget(MIN_COMPACT_BUDGET * 8, 8)).toBe(MIN_COMPACT_BUDGET);
  });

  it("stops sending a budget once the box is wide enough not to need one", () => {
    expect(estimateCharacterBudget(MAX_COMPACT_BUDGET * 8 + 100, 8)).toBeNull();
  });

  it("returns nothing when the measurement is unusable", () => {
    expect(estimateCharacterBudget(0, 8)).toBeNull();
    expect(estimateCharacterBudget(120, 0)).toBeNull();
    expect(estimateCharacterBudget(Number.NaN, 8)).toBeNull();
    expect(estimateCharacterBudget(120, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("budgets only the regions that must keep their box", () => {
    expect(needsCompactBudget("hard")).toBe(true);
    expect(needsCompactBudget("critical")).toBe(true);
    expect(needsCompactBudget("medium")).toBe(false);
    expect(needsCompactBudget("soft")).toBe(false);
  });

  it("fits a shared translation to the tightest box that uses it", () => {
    expect(narrowestBudget([20, 8, 14])).toBe(8);
    expect(narrowestBudget([undefined, 12])).toBe(12);
    expect(narrowestBudget([undefined, undefined])).toBeUndefined();
    expect(narrowestBudget([])).toBeUndefined();
  });
});
