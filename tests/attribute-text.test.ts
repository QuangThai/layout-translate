import { describe, expect, it } from "vitest";
import {
  isTranslatableAttributeValue,
  TRANSLATABLE_ATTRIBUTES,
  TRANSLATABLE_ATTRIBUTE_SELECTOR,
} from "../src/shared/attribute-text";

describe("translatable attribute values", () => {
  it("covers the attributes a reader actually sees", () => {
    expect([...TRANSLATABLE_ATTRIBUTES]).toEqual(["placeholder", "alt", "title", "aria-label"]);
    expect(TRANSLATABLE_ATTRIBUTE_SELECTOR).toBe("[placeholder],[alt],[title],[aria-label]");
  });

  it("accepts the Japanese strings a form or image shows", () => {
    expect(isTranslatableAttributeValue("株式会社◯◯◯◯◯")).toBe(true);
    expect(isTranslatableAttributeValue("山田 太郎")).toBe(true);
    expect(isTranslatableAttributeValue("  会社のロゴ  ")).toBe(true);
  });

  it("leaves values that are not prose alone", () => {
    expect(isTranslatableAttributeValue("Company name")).toBe(false);
    expect(isTranslatableAttributeValue("")).toBe(false);
    expect(isTranslatableAttributeValue("   ")).toBe(false);
    expect(isTranslatableAttributeValue(null)).toBe(false);
    expect(isTranslatableAttributeValue(undefined)).toBe(false);
  });

  it("leaves values the page also uses as machine data", () => {
    // Translating any of these would break the page rather than help a reader.
    expect(isTranslatableAttributeValue("https://example.co.jp/会社")).toBe(false);
    expect(isTranslatableAttributeValue("mailto:担当@example.co.jp")).toBe(false);
    expect(isTranslatableAttributeValue("tel:0312345678")).toBe(false);
    expect(isTranslatableAttributeValue("/画像/logo.png")).toBe(false);
    expect(isTranslatableAttributeValue("#会社情報")).toBe(false);
    expect(isTranslatableAttributeValue("{{ 会社名 }}")).toBe(false);
    expect(isTranslatableAttributeValue("${会社名}")).toBe(false);
    expect(isTranslatableAttributeValue(`data:text/plain,会社`)).toBe(false);
  });

  it("refuses values too long to be a label", () => {
    expect(isTranslatableAttributeValue(`会社${"あ".repeat(2_100)}`)).toBe(false);
  });
});
