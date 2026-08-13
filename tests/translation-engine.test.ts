import { describe, expect, it } from "vitest";
import { correlateTranslationResults } from "../src/content/translation-engine";
import type { TranslationResult } from "../src/shared/contracts";

function result(anchorId: string): TranslationResult {
  return { anchorId, full: `${anchorId}-full`, compact: `${anchorId}-compact` };
}

describe("translation result correlation", () => {
  it("maps a complete response batch back to its requested anchors", () => {
    const correlated = correlateTranslationResults(
      ["anchor-1", "anchor-2"],
      [result("anchor-2"), result("anchor-1")],
    );

    expect([...correlated.keys()]).toEqual(["anchor-2", "anchor-1"]);
    expect(correlated.get("anchor-1")?.full).toBe("anchor-1-full");
  });

  it.each([
    ["a response with a missing anchor", [result("anchor-1")]],
    ["a response with an unknown anchor", [result("anchor-1"), result("anchor-3")]],
    ["a response with a duplicate anchor", [result("anchor-1"), result("anchor-1")]],
  ])("fails closed for %s", (_description, response) => {
    expect(() => correlateTranslationResults(["anchor-1", "anchor-2"], response)).toThrow(
      "incomplete or mismatched response",
    );
  });
});
