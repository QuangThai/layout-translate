# Translation backend boundary

The production provider is intentionally not implemented in this scaffold.
`SPEC.md` requires server-side credentials, authentication, payload validation,
fail-closed sensitive-data handling, batching, structured response validation,
rate/cost controls, and an approved data-retention policy before real provider
calls are enabled. The accepted MVP boundary is recorded in
[`docs/decisions/0001-mvp-translation-data-security-boundary.md`](../docs/decisions/0001-mvp-translation-data-security-boundary.md).

## Local mock server

`src/mock-server.ts` exposes a development-only endpoint that exercises the
request boundary and deterministic provider-response validation without
sending content to OpenAI:

```text
POST http://127.0.0.1:8787/v1/translate
Authorization: Bearer <LAYOUT_TRANSLATE_MOCK_AUTH_TOKEN>
Content-Type: application/json

{
  "pageOrigin": "http://127.0.0.1:4173",
  "targetLanguage": "en",
  "items": [
    {
      "anchorId": "anchor-1",
      "source": "ä¼šç¤¾æƒ…å ±",
      "component": "navigation",
      "dataClass": "normal"
    }
  ]
}
```

For local use, configure the boundary explicitly before starting the server:

```powershell
$env:LAYOUT_TRANSLATE_MOCK_AUTH_TOKEN = "dev-only-token"
$env:LAYOUT_TRANSLATE_ALLOWED_ORIGINS = "http://127.0.0.1:4173"
npm run backend:mock
```

The server rejects missing/invalid authorization, non-allowlisted page
origins, unsupported fields, oversized batches/bodies, duplicate anchors,
protected or uncertain data classes, and provider responses that do not
correlate to the request. It fails fast when the auth token or page-origin
allowlist is not configured, and it does not persist source or translated
content. Every HTTP response carries a non-content `x-request-id` for
correlating client-side failures with backend observations. The extension
client includes that opaque ID in diagnostics when the backend returns one;
smoke reports retain IDs only, never request content. The synthetic
failure-mode endpoint is test-only and activates only when
`LAYOUT_TRANSLATE_ALLOW_TEST_FAILURE_MODE=true`; it must never be enabled on a
shared or production backend. The local endpoint also supports a bounded
`delay-success` response for deterministic stale-request and language-switch
race tests.
For an approved offline calibration replay only, the runner may set
`LAYOUT_TRANSLATE_MOCK_TRANSLATION_OVERRIDES` to a temporary JSON object mapping
source strings to reviewed `{ en, vi, compact? }` values. This is a deterministic
test adapter; it never calls a provider and the file is created under the
runner's temporary profile. The extension chunks larger DOM scans to the
contract's maximum batch size before sending them.

Replay the HTTP boundary proof with:

```text
npm run backend:smoke
```

The smoke output covers an authorized `200`, missing-auth `401`, disallowed
page-origin `403`, protected-content `422`, and rate-limit `429` response.
