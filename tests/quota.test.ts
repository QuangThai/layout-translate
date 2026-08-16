import { describe, expect, it } from "vitest";
import { createQuotaLedger, readQuotaConfig } from "../backend/src/quota";

const config = { dailyTokenLimit: 1_000, requestsPerMinute: 3 };

function clock(start = Date.UTC(2026, 7, 16, 9, 0, 0)) {
  let value = start;
  return { now: () => value, advance: (ms: number) => { value += ms; } };
}

describe("quota configuration", () => {
  it("has a limit by default rather than none", () => {
    const parsed = readQuotaConfig({});
    expect(parsed.dailyTokenLimit).toBeGreaterThan(0);
    expect(parsed.requestsPerMinute).toBeGreaterThan(0);
  });

  it("refuses a configured limit that is not a limit", () => {
    expect(() => readQuotaConfig({ LAYOUT_TRANSLATE_DAILY_TOKEN_LIMIT: "0" })).toThrow(/TOKEN_LIMIT/u);
    expect(() => readQuotaConfig({ LAYOUT_TRANSLATE_DAILY_TOKEN_LIMIT: "-5" })).toThrow(/TOKEN_LIMIT/u);
    expect(() => readQuotaConfig({ LAYOUT_TRANSLATE_IDENTITY_RATE_LIMIT: "nope" })).toThrow(/RATE_LIMIT/u);
  });
});

describe("per-identity quota", () => {
  it("stops one person spending the whole company budget", () => {
    const time = clock();
    const ledger = createQuotaLedger({ ...config, requestsPerMinute: 1_000 }, time.now);
    expect(ledger.check("hanako").allowed).toBe(true);
    ledger.record("hanako", 999);
    expect(ledger.check("hanako").allowed).toBe(true);
    ledger.record("hanako", 2);
    expect(ledger.check("hanako")).toMatchObject({ allowed: false, reason: "daily_token_limit", spentTokens: 1_001 });
  });

  it("keeps one person's spend off everyone else's allowance", () => {
    const time = clock();
    const ledger = createQuotaLedger({ ...config, requestsPerMinute: 1_000 }, time.now);
    ledger.record("hanako", 5_000);
    expect(ledger.check("hanako").allowed).toBe(false);
    expect(ledger.check("taro").allowed).toBe(true);
  });

  it("gives a new allowance the next day rather than carrying the old one", () => {
    const time = clock();
    const ledger = createQuotaLedger({ ...config, requestsPerMinute: 1_000 }, time.now);
    ledger.record("hanako", 5_000);
    expect(ledger.check("hanako").allowed).toBe(false);
    time.advance(24 * 60 * 60 * 1_000);
    expect(ledger.check("hanako")).toMatchObject({ allowed: true, spentTokens: 0 });
  });

  it("bounds how fast one identity can ask, and lets the window recover", () => {
    const time = clock();
    const ledger = createQuotaLedger(config, time.now);
    expect(ledger.check("hanako").allowed).toBe(true);
    expect(ledger.check("hanako").allowed).toBe(true);
    expect(ledger.check("hanako").allowed).toBe(true);
    expect(ledger.check("hanako")).toMatchObject({ allowed: false, reason: "request_rate_limit" });
    time.advance(61_000);
    expect(ledger.check("hanako").allowed).toBe(true);
  });

  it("ignores a nonsense token count rather than corrupting the ledger", () => {
    const time = clock();
    const ledger = createQuotaLedger(config, time.now);
    ledger.record("hanako", Number.NaN);
    ledger.record("hanako", -100);
    expect(ledger.spent("hanako")).toBe(0);
  });
});
