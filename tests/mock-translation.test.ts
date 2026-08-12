import { describe, expect, it } from "vitest";
import { mockTranslateBatch } from "../src/shared/mock-translation";

describe("mock translation adapter", () => {
  it("returns full and compact English candidates from the source", async () => {
    const result = (await mockTranslateBatch(
      [{ anchorId: "anchor-1", source: "お問い合わせはこちら", component: "navigation" }],
      "en",
    ))[0]!;

    expect(result).toEqual({
      anchorId: "anchor-1",
      full: "Contact us",
      compact: "Contact",
    });
  });

  it("keeps unknown fixture text deterministic until a glossary exists", async () => {
    const result = (await mockTranslateBatch(
      [{ anchorId: "anchor-2", source: "未登録の文字列", component: "paragraph" }],
      "vi",
    ))[0]!;

    expect(result.full).toBe("未登録の文字列");
    expect(result.compact).toBe(result.full);
  });
});
