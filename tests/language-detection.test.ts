import { describe, expect, it } from "vitest";
import { detectSourceLanguage } from "../src/shared/language-detection";

describe("source language detection", () => {
  it("detects kana-rich Japanese text", () => {
    expect(detectSourceLanguage("お問い合わせはこちら")).toBe("ja");
  });

  it("uses a Japanese document hint for kanji-only labels", () => {
    expect(detectSourceLanguage("会社情報", "ja")).toBe("ja");
  });

  it("rejects a CJK-only sample without enough Japanese evidence", () => {
    expect(detectSourceLanguage("中文页面")).toBe("unknown");
  });

  it("detects a sufficiently long Latin sample as non-Japanese", () => {
    expect(detectSourceLanguage("Contact our support team")).toBe("non-ja");
  });

  it.each(["", "123", "A", "!?", "Hello 会社"]) (
    "fails closed for an ambiguous sample: %s",
    (sample) => {
      expect(detectSourceLanguage(sample)).toBe("unknown");
    },
  );

  it("requires a meaningful Japanese ratio in mixed content", () => {
    expect(detectSourceLanguage("English text and お問い合わせはこちら")).toBe("ja");
    expect(detectSourceLanguage("English text repeated many times 会社")).toBe("unknown");
  });
});
