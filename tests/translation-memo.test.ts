import { describe, expect, it } from "vitest";
import { TranslationMemo, translationMemoKey } from "../src/shared/translation-memo";

const request = { source: "更新中", component: "badge" as const };
const result = { anchorId: "anchor-1", full: "Updating", compact: "Updating" };

describe("translation memo", () => {
  it("serves text the page has already shown without asking again", () => {
    const memo = new TranslationMemo();
    memo.useLanguage("en");
    expect(memo.get(request)).toBeUndefined();
    memo.remember(request, result);
    expect(memo.get(request)).toEqual({ full: "Updating", compact: "Updating" });
  });

  it("keeps a narrow control's shortening separate from a wide one's", () => {
    const memo = new TranslationMemo();
    memo.useLanguage("en");
    memo.remember({ ...request, compactMaxChars: 8 }, result);
    expect(memo.get({ ...request, compactMaxChars: 8 })).toBeDefined();
    expect(memo.get({ ...request, compactMaxChars: 20 })).toBeUndefined();
    expect(memo.get(request)).toBeUndefined();
  });

  it("keeps the same words separate when the component policy differs", () => {
    expect(translationMemoKey({ source: "詳細", component: "navigation" }))
      .not.toBe(translationMemoKey({ source: "詳細", component: "table" }));
  });

  it("never serves one language's text for another", () => {
    const memo = new TranslationMemo();
    memo.useLanguage("en");
    memo.remember(request, result);
    memo.useLanguage("vi");
    expect(memo.get(request)).toBeUndefined();
    memo.remember(request, { ...result, full: "Đang cập nhật", compact: "Đang cập nhật" });
    expect(memo.get(request)?.full).toBe("Đang cập nhật");
    memo.useLanguage("vi");
    expect(memo.get(request)?.full).toBe("Đang cập nhật");
  });

  it("stays bounded so a long session cannot grow without limit", () => {
    const memo = new TranslationMemo(3);
    memo.useLanguage("en");
    for (let index = 0; index < 10; index += 1) {
      memo.remember({ source: `文${index}`, component: "paragraph" }, { ...result, full: `Text ${index}` });
    }
    expect(memo.size).toBe(3);
    expect(memo.get({ source: "文0", component: "paragraph" })).toBeUndefined();
    expect(memo.get({ source: "文9", component: "paragraph" })?.full).toBe("Text 9");
  });

  it("evicts what was written least recently, not what was seen first", () => {
    const memo = new TranslationMemo(2);
    memo.useLanguage("en");
    memo.remember({ source: "A", component: "badge" }, { ...result, full: "A" });
    memo.remember({ source: "B", component: "badge" }, { ...result, full: "B" });
    memo.remember({ source: "A", component: "badge" }, { ...result, full: "A" });
    memo.remember({ source: "C", component: "badge" }, { ...result, full: "C" });
    expect(memo.get({ source: "A", component: "badge" })?.full).toBe("A");
    expect(memo.get({ source: "B", component: "badge" })).toBeUndefined();
  });
});
