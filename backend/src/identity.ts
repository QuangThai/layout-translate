import { createPublicKey, createVerify } from "node:crypto";

/**
 * Verifies who is asking for a translation.
 *
 * A single shared token cannot answer that: everyone holding it is the same
 * caller, so a quota cannot be attributed, an abuse cannot be traced, and
 * revoking one person means rotating everyone. This verifies an OIDC ID token
 * against the issuer's published keys instead, which gives the backend a real
 * identity to attribute usage to.
 *
 * Verification is done here rather than trusted from a header, because a header
 * a client controls is not evidence of anything.
 */
export interface VerifiedIdentity {
  subject: string;
  email?: string;
  issuer: string;
  expiresAt: number;
}

export interface IdentityConfig {
  issuer: string;
  audience: string;
  jwksUri: string;
  /** Only these domains may sign in, so a personal account cannot use a company quota. */
  allowedEmailDomains: readonly string[];
  clockSkewSeconds: number;
}

export class IdentityError extends Error {
  constructor(message: string, readonly code = "unauthorized") {
    super(message);
    this.name = "IdentityError";
  }
}

const JWKS_CACHE_MS = 10 * 60 * 1000;

function decodeSegment(segment: string): unknown {
  return JSON.parse(Buffer.from(segment.replace(/-/gu, "+").replace(/_/gu, "/"), "base64").toString("utf8"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readIdentityConfig(env: NodeJS.ProcessEnv = process.env): IdentityConfig {
  const issuer = env.LAYOUT_TRANSLATE_OIDC_ISSUER?.trim();
  const audience = env.LAYOUT_TRANSLATE_OIDC_AUDIENCE?.trim();
  const jwksUri = env.LAYOUT_TRANSLATE_OIDC_JWKS_URI?.trim();
  if (!issuer) throw new Error("LAYOUT_TRANSLATE_OIDC_ISSUER must be configured for identity mode");
  if (!audience) throw new Error("LAYOUT_TRANSLATE_OIDC_AUDIENCE must be configured for identity mode");
  if (!jwksUri) throw new Error("LAYOUT_TRANSLATE_OIDC_JWKS_URI must be configured for identity mode");

  const domains = (env.LAYOUT_TRANSLATE_OIDC_EMAIL_DOMAINS ?? "")
    .split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (domains.length === 0) {
    throw new Error("LAYOUT_TRANSLATE_OIDC_EMAIL_DOMAINS must list the domains allowed to sign in");
  }
  return {
    issuer,
    audience,
    jwksUri,
    allowedEmailDomains: domains,
    clockSkewSeconds: Number(env.LAYOUT_TRANSLATE_OIDC_CLOCK_SKEW_SECONDS ?? 60),
  };
}

export function createIdentityVerifier(
  config: IdentityConfig,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
) {
  let keysByKid = new Map<string, ReturnType<typeof createPublicKey>>();
  let fetchedAt = 0;

  async function keyFor(kid: string) {
    // Issuers rotate keys, so an unknown key id refreshes the set once rather
    // than failing a caller whose token is signed with a newer key.
    if (!keysByKid.has(kid) || now() - fetchedAt > JWKS_CACHE_MS) {
      const response = await fetchImpl(config.jwksUri).catch(() => undefined);
      if (!response?.ok) throw new IdentityError("Could not reach the identity provider", "identity_unavailable");
      const body = await response.json().catch(() => undefined);
      const keys = isRecord(body) && Array.isArray(body.keys) ? body.keys : [];
      const next = new Map<string, ReturnType<typeof createPublicKey>>();
      for (const jwk of keys) {
        if (!isRecord(jwk) || typeof jwk.kid !== "string") continue;
        try {
          next.set(jwk.kid, createPublicKey({ key: jwk as never, format: "jwk" }));
        } catch {
          // A key this runtime cannot represent is skipped rather than fatal.
        }
      }
      keysByKid = next;
      fetchedAt = now();
    }
    const key = keysByKid.get(kid);
    if (!key) throw new IdentityError("Token was signed with an unknown key");
    return key;
  }

  return async function verify(authorization: string | undefined): Promise<VerifiedIdentity> {
    const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
    if (!token) throw new IdentityError("An identity token is required");

    const [headerSegment, payloadSegment, signatureSegment] = token.split(".");
    if (!headerSegment || !payloadSegment || !signatureSegment) throw new IdentityError("Malformed identity token");

    let header: unknown;
    let payload: unknown;
    try {
      header = decodeSegment(headerSegment);
      payload = decodeSegment(payloadSegment);
    } catch {
      throw new IdentityError("Malformed identity token");
    }
    if (!isRecord(header) || !isRecord(payload)) throw new IdentityError("Malformed identity token");
    // Only asymmetric signatures: "none" or an HMAC would let anyone who reads
    // this configuration mint a token.
    if (header.alg !== "RS256") throw new IdentityError("Unsupported token signature algorithm");
    if (typeof header.kid !== "string") throw new IdentityError("Token does not name its signing key");

    const key = await keyFor(header.kid);
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${headerSegment}.${payloadSegment}`);
    verifier.end();
    if (!verifier.verify(key, Buffer.from(signatureSegment.replace(/-/gu, "+").replace(/_/gu, "/"), "base64"))) {
      throw new IdentityError("Identity token signature does not verify");
    }

    if (payload.iss !== config.issuer) throw new IdentityError("Identity token was issued by another provider");
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(config.audience)) throw new IdentityError("Identity token was issued for another audience");

    const seconds = Math.floor(now() / 1000);
    const skew = config.clockSkewSeconds;
    if (typeof payload.exp !== "number" || payload.exp + skew < seconds) throw new IdentityError("Identity token has expired");
    if (typeof payload.nbf === "number" && payload.nbf - skew > seconds) throw new IdentityError("Identity token is not valid yet");
    if (typeof payload.sub !== "string" || !payload.sub) throw new IdentityError("Identity token has no subject");

    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : undefined;
    const domain = email?.split("@")[1];
    if (!domain || !config.allowedEmailDomains.includes(domain)) {
      throw new IdentityError("This account is not allowed to use this backend", "identity_not_allowed");
    }
    if (payload.email_verified === false) {
      throw new IdentityError("This account's email is not verified", "identity_not_allowed");
    }

    return { subject: payload.sub, email, issuer: config.issuer, expiresAt: payload.exp * 1000 };
  };
}
