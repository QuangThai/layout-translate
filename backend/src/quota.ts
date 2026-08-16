/**
 * Per-identity spending limits.
 *
 * The company pays for one provider key, so without a limit any single person,
 * or one runaway page, can spend the whole budget before anyone notices. The
 * limit is per identity and per day, and it is checked before a request is sent
 * rather than after it is paid for.
 */
export interface QuotaConfig {
  /** Provider tokens one identity may spend per day. */
  dailyTokenLimit: number;
  /** Requests one identity may make per minute, above the shared address limit. */
  requestsPerMinute: number;
}

export interface QuotaDecision {
  allowed: boolean;
  reason?: "daily_token_limit" | "request_rate_limit";
  spentTokens: number;
  limitTokens: number;
}

interface IdentityUsage {
  day: string;
  tokens: number;
  windowStartedAt: number;
  windowRequests: number;
}

export function readQuotaConfig(env: NodeJS.ProcessEnv = process.env): QuotaConfig {
  const dailyTokenLimit = Number(env.LAYOUT_TRANSLATE_DAILY_TOKEN_LIMIT ?? 200_000);
  const requestsPerMinute = Number(env.LAYOUT_TRANSLATE_IDENTITY_RATE_LIMIT ?? 120);
  if (!Number.isFinite(dailyTokenLimit) || dailyTokenLimit <= 0) {
    throw new Error("LAYOUT_TRANSLATE_DAILY_TOKEN_LIMIT must be a positive number of tokens");
  }
  if (!Number.isFinite(requestsPerMinute) || requestsPerMinute <= 0) {
    throw new Error("LAYOUT_TRANSLATE_IDENTITY_RATE_LIMIT must be a positive number of requests");
  }
  return { dailyTokenLimit, requestsPerMinute };
}

function dayOf(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function createQuotaLedger(config: QuotaConfig, now: () => number = Date.now) {
  const usage = new Map<string, IdentityUsage>();

  function entryFor(identity: string): IdentityUsage {
    const today = dayOf(now());
    const current = usage.get(identity);
    // A new day starts a new allowance; yesterday's spend is not carried over.
    if (!current || current.day !== today) {
      const fresh: IdentityUsage = { day: today, tokens: 0, windowStartedAt: now(), windowRequests: 0 };
      usage.set(identity, fresh);
      return fresh;
    }
    return current;
  }

  return {
    /** Asked before a request is sent, because a refused request costs nothing. */
    check(identity: string): QuotaDecision {
      const entry = entryFor(identity);
      const elapsed = now() - entry.windowStartedAt;
      if (elapsed >= 60_000) {
        entry.windowStartedAt = now();
        entry.windowRequests = 0;
      }
      if (entry.tokens >= config.dailyTokenLimit) {
        return {
          allowed: false,
          reason: "daily_token_limit",
          spentTokens: entry.tokens,
          limitTokens: config.dailyTokenLimit,
        };
      }
      if (entry.windowRequests >= config.requestsPerMinute) {
        return {
          allowed: false,
          reason: "request_rate_limit",
          spentTokens: entry.tokens,
          limitTokens: config.dailyTokenLimit,
        };
      }
      entry.windowRequests += 1;
      return { allowed: true, spentTokens: entry.tokens, limitTokens: config.dailyTokenLimit };
    },

    /** Recorded after the provider answers, since that is when the cost is known. */
    record(identity: string, tokens: number): void {
      const entry = entryFor(identity);
      entry.tokens += Number.isFinite(tokens) && tokens > 0 ? tokens : 0;
    },

    spent(identity: string): number {
      return entryFor(identity).tokens;
    },
  };
}
