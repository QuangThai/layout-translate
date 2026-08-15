import { describe, expect, it } from "vitest";
import { describeSiteTarget, formatOriginLabel } from "../src/shared/site-access";

describe("site access targets", () => {
  it("scopes the opt-in unit to a single origin", () => {
    expect(describeSiteTarget("https://example.co.jp/products/list?q=1#top")).toEqual({
      origin: "https://example.co.jp",
      pattern: "https://example.co.jp/*",
      preGranted: false,
    });
  });

  it("keeps distinct ports and subdomains separate", () => {
    expect(describeSiteTarget("https://shop.example.co.jp/")?.pattern).toBe("https://shop.example.co.jp/*");
    expect(describeSiteTarget("https://example.co.jp:8443/")?.pattern).toBe("https://example.co.jp:8443/*");
  });

  it("marks fixture hosts as already granted", () => {
    expect(describeSiteTarget("http://localhost:4173/page.html")?.preGranted).toBe(true);
    expect(describeSiteTarget("http://127.0.0.1:4173/page.html")?.preGranted).toBe(true);
    expect(describeSiteTarget("https://localhost.example.com/")?.preGranted).toBe(false);
  });

  it("rejects pages the extension must not request access for", () => {
    expect(describeSiteTarget(undefined)).toBeNull();
    expect(describeSiteTarget("chrome://extensions")).toBeNull();
    expect(describeSiteTarget("chrome-extension://abc/popup.html")).toBeNull();
    expect(describeSiteTarget("file:///C:/page.html")).toBeNull();
    expect(describeSiteTarget("not a url")).toBeNull();
  });

  it("shortens long origins without hiding the host", () => {
    expect(formatOriginLabel("https://example.co.jp")).toBe("example.co.jp");
    expect(formatOriginLabel("https://a-very-long-subdomain.example.co.jp", 16)).toBe("a-very-long-sub…");
  });
});
