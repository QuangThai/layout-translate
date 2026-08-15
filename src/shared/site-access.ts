// Fixture origins ship as declared host permissions so the replayable browser
// proofs keep working without a user gesture. Every other origin is opt-in.
const preGrantedHosts = new Set(["localhost", "127.0.0.1"]);

export interface SiteTarget {
  origin: string;
  pattern: string;
  preGranted: boolean;
}

/**
 * Describes the opt-in unit for a page URL: one origin, never a broader host
 * pattern, so granting access to one site cannot widen to its siblings.
 */
export function describeSiteTarget(url: string | undefined): SiteTarget | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!/^https?:$/u.test(parsed.protocol)) return null;
  return {
    origin: parsed.origin,
    pattern: `${parsed.origin}/*`,
    preGranted: preGrantedHosts.has(parsed.hostname),
  };
}

/** Shortens an origin for display without hiding which site is being granted. */
export function formatOriginLabel(origin: string, maxLength = 32): string {
  const withoutScheme = origin.replace(/^https?:\/\//u, "");
  if (withoutScheme.length <= maxLength) return withoutScheme;
  return `${withoutScheme.slice(0, maxLength - 1)}…`;
}
