import { describe, expect, it } from "vitest";
import { classifyElement, preserveModeFor } from "../src/shared/classification";

/**
 * A stand-in for the parts of an element the classifier reads. Real sites are
 * the reason this exists: the classifier has to work on markup built from divs
 * and roles, not only on semantic tags.
 */
interface FakeElement {
  tagName: string;
  matchesSelectors: string[];
  ancestorSelectors: string[];
  descendantSelectors: string[];
}

function element(overrides: Partial<FakeElement> = {}): Element {
  const node: FakeElement = {
    tagName: "SPAN",
    matchesSelectors: [],
    ancestorSelectors: [],
    descendantSelectors: [],
    ...overrides,
  };
  const anyOf = (selector: string, list: string[]) =>
    selector.split(",").map((part) => part.trim()).some((part) => list.includes(part));

  const fake = {
    tagName: node.tagName,
    matches: (selector: string) => anyOf(selector, node.matchesSelectors),
    querySelector: (selector: string) => (anyOf(selector, node.descendantSelectors) ? fake : null),
    closest: (selector: string) =>
      anyOf(selector, [...node.ancestorSelectors, ...node.matchesSelectors]) ? fake : null,
  };
  return fake as unknown as Element;
}

describe("component classification", () => {
  it("recognises semantic markup", () => {
    expect(classifyElement(element({ ancestorSelectors: ["nav"] }))).toBe("navigation");
    expect(classifyElement(element({ ancestorSelectors: ["td"] }))).toBe("table");
    expect(classifyElement(element({ tagName: "BUTTON" }))).toBe("button");
    expect(classifyElement(element({ tagName: "H2" }))).toBe("heading");
  });

  it("recognises a page built from roles instead of tags", () => {
    // A site made of divs exposes no table element, only ARIA roles.
    expect(classifyElement(element({ ancestorSelectors: ["[role='grid']"] }))).toBe("table");
    expect(classifyElement(element({ ancestorSelectors: ["[role='columnheader']"] }))).toBe("table");
    expect(classifyElement(element({ ancestorSelectors: ["[role='menubar']"] }))).toBe("navigation");
  });

  it("treats a plain link as navigation, which SPEC lists as MVP content", () => {
    // Without this, a site whose links sit in divs classified 80% of its
    // anchors as unknown and lost the policy that keeps their box.
    expect(classifyElement(element({ tagName: "A", matchesSelectors: ["a[href]"] }))).toBe("navigation");
    expect(classifyElement(element({ ancestorSelectors: ["[role='link']"] }))).toBe("navigation");
    expect(classifyElement(element({ ancestorSelectors: ["[role='menuitem']"] }))).toBe("navigation");
  });

  it("does not treat a link that wraps a whole card as a label", () => {
    // Pinning the box of a link that contains a heading and an image would
    // clip the card rather than preserve it.
    const cardLink = element({
      tagName: "A",
      matchesSelectors: ["a[href]"],
      descendantSelectors: ["h3", "img"],
      ancestorSelectors: ["article"],
    });
    expect(classifyElement(cardLink)).toBe("card");
  });

  it("leaves a link inside running prose to the paragraph policy", () => {
    // Pinning the box of a link in the middle of a sentence would clip a word.
    const proseLink = element({
      tagName: "A",
      matchesSelectors: ["a[href]"],
      ancestorSelectors: ["p"],
    });
    expect(classifyElement(proseLink)).toBe("paragraph");
  });

  it("keeps the policy each class maps to", () => {
    const plain = element();
    expect(preserveModeFor("navigation", plain)).toBe("hard");
    expect(preserveModeFor("table", plain)).toBe("hard");
    expect(preserveModeFor("heading", plain)).toBe("medium");
    expect(preserveModeFor("paragraph", plain)).toBe("soft");
    expect(preserveModeFor("unknown", plain)).toBe("medium");
    expect(preserveModeFor("navigation", element({ matchesSelectors: ["[data-semantic-critical='true']"] })))
      .toBe("critical");
  });
});
