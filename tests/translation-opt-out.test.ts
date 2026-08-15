import { describe, expect, it } from "vitest";
import { isTranslationOptedOut } from "../src/shared/classification";

interface FakeElement {
  parentElement: FakeElement | null;
  classList: { contains(name: string): boolean };
  getAttribute(name: string): string | null;
}

function element(
  attributes: Record<string, string> = {},
  classes: string[] = [],
  parent: FakeElement | null = null,
): FakeElement {
  return {
    parentElement: parent,
    classList: { contains: (name: string) => classes.includes(name) },
    getAttribute: (name: string) => attributes[name] ?? null,
  };
}

function optedOut(target: FakeElement): boolean {
  return isTranslationOptedOut(target as unknown as Element);
}

describe("standard translation opt-out", () => {
  it("translates ordinary content", () => {
    expect(optedOut(element())).toBe(false);
  });

  it("honours translate=no on the element itself", () => {
    expect(optedOut(element({ translate: "no" }))).toBe(true);
    expect(optedOut(element({ translate: "NO" }))).toBe(true);
    expect(optedOut(element({ translate: " no " }))).toBe(true);
  });

  it("inherits the opt-out from an ancestor, as the HTML attribute does", () => {
    const brand = element({}, [], element({ translate: "no" }, [], element()));
    expect(optedOut(brand)).toBe(true);
  });

  it("lets the nearest declaration opt back in", () => {
    const inner = element({ translate: "yes" }, [], element({ translate: "no" }));
    expect(optedOut(inner)).toBe(false);
    const child = element({}, [], inner);
    expect(optedOut(child)).toBe(false);
  });

  it("honours the notranslate class used by existing translation tools", () => {
    expect(optedOut(element({}, ["notranslate"]))).toBe(true);
    expect(optedOut(element({}, [], element({}, ["notranslate"])))).toBe(true);
  });

  it("ignores values that are not part of the standard", () => {
    expect(optedOut(element({ translate: "maybe" }))).toBe(false);
    expect(optedOut(element({ translate: "" }))).toBe(false);
  });
});
