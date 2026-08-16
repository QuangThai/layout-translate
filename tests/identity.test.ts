import { generateKeyPairSync, createSign, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createIdentityVerifier, IdentityError, readIdentityConfig } from "../backend/src/identity";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KEY_ID = randomUUID();
const NOW = 1_800_000_000_000;

const config = {
  issuer: "https://accounts.example.com",
  audience: "layout-translate-backend",
  jwksUri: "https://accounts.example.com/jwks",
  allowedEmailDomains: ["example.co.jp"],
  clockSkewSeconds: 60,
};

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64").replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function signToken(payload: Record<string, unknown>, header: Record<string, unknown> = {}): string {
  const head = base64url(JSON.stringify({ alg: "RS256", kid: KEY_ID, ...header }));
  const body = base64url(JSON.stringify(payload));
  const signer = createSign("RSA-SHA256");
  signer.update(`${head}.${body}`);
  signer.end();
  return `${head}.${body}.${base64url(signer.sign(privateKey))}`;
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    iss: config.issuer,
    aud: config.audience,
    sub: "user-1",
    email: "hanako@example.co.jp",
    email_verified: true,
    exp: Math.floor(NOW / 1000) + 3_600,
    ...overrides,
  };
}

const jwks = { keys: [{ ...publicKey.export({ format: "jwk" }), kid: KEY_ID, alg: "RS256", use: "sig" }] };
const fetchJwks = async () => new Response(JSON.stringify(jwks), { status: 200 });

function verifier(fetchImpl: typeof fetch = fetchJwks as unknown as typeof fetch) {
  return createIdentityVerifier(config, fetchImpl, () => NOW);
}

describe("identity configuration", () => {
  it("refuses to run in identity mode without an issuer, audience, keys, and allowed domains", () => {
    expect(() => readIdentityConfig({})).toThrow(/ISSUER/u);
    expect(() => readIdentityConfig({ LAYOUT_TRANSLATE_OIDC_ISSUER: "x" })).toThrow(/AUDIENCE/u);
    expect(() => readIdentityConfig({
      LAYOUT_TRANSLATE_OIDC_ISSUER: "x",
      LAYOUT_TRANSLATE_OIDC_AUDIENCE: "y",
    })).toThrow(/JWKS/u);
    // Without a domain list, any account at any provider could spend the quota.
    expect(() => readIdentityConfig({
      LAYOUT_TRANSLATE_OIDC_ISSUER: "x",
      LAYOUT_TRANSLATE_OIDC_AUDIENCE: "y",
      LAYOUT_TRANSLATE_OIDC_JWKS_URI: "z",
    })).toThrow(/EMAIL_DOMAINS/u);
  });
});

describe("identity verification", () => {
  it("accepts a token the configured provider signed for this backend", async () => {
    const identity = await verifier()(`Bearer ${signToken(validPayload())}`);
    expect(identity).toMatchObject({ subject: "user-1", email: "hanako@example.co.jp", issuer: config.issuer });
  });

  it("rejects a token with no signature to check", async () => {
    // A token this backend would accept unsigned is a token anyone can mint.
    const head = base64url(JSON.stringify({ alg: "none", kid: KEY_ID }));
    const body = base64url(JSON.stringify(validPayload()));
    await expect(verifier()(`Bearer ${head}.${body}.`)).rejects.toBeInstanceOf(IdentityError);
  });

  it("rejects a token signed by someone else", async () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const head = base64url(JSON.stringify({ alg: "RS256", kid: KEY_ID }));
    const body = base64url(JSON.stringify(validPayload()));
    const signer = createSign("RSA-SHA256");
    signer.update(`${head}.${body}`);
    signer.end();
    const forged = `${head}.${body}.${base64url(signer.sign(other.privateKey))}`;
    await expect(verifier()(`Bearer ${forged}`)).rejects.toThrow(/signature/u);
  });

  it("rejects tokens meant for another audience or issuer", async () => {
    await expect(verifier()(`Bearer ${signToken(validPayload({ aud: "another-app" }))}`))
      .rejects.toThrow(/audience/u);
    await expect(verifier()(`Bearer ${signToken(validPayload({ iss: "https://evil.example" }))}`))
      .rejects.toThrow(/provider/u);
  });

  it("rejects an expired token but allows the configured clock skew", async () => {
    await expect(verifier()(`Bearer ${signToken(validPayload({ exp: Math.floor(NOW / 1000) - 3_600 }))}`))
      .rejects.toThrow(/expired/u);
    const justExpired = signToken(validPayload({ exp: Math.floor(NOW / 1000) - 30 }));
    await expect(verifier()(`Bearer ${justExpired}`)).resolves.toMatchObject({ subject: "user-1" });
  });

  it("keeps a personal account off a company quota", async () => {
    await expect(verifier()(`Bearer ${signToken(validPayload({ email: "someone@gmail.com" }))}`))
      .rejects.toMatchObject({ code: "identity_not_allowed" });
    await expect(verifier()(`Bearer ${signToken(validPayload({ email_verified: false }))}`))
      .rejects.toMatchObject({ code: "identity_not_allowed" });
  });

  it("reports an unreachable provider separately from a bad token", async () => {
    const offline = (async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    await expect(verifier(offline)(`Bearer ${signToken(validPayload())}`))
      .rejects.toMatchObject({ code: "identity_unavailable" });
  });

  it("requires an authorization header at all", async () => {
    await expect(verifier()(undefined)).rejects.toThrow(/required/u);
    await expect(verifier()("Basic abc")).rejects.toThrow(/required/u);
    await expect(verifier()("Bearer not-a-token")).rejects.toThrow(/Malformed/u);
  });
});
