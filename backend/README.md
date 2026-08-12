# Translation backend boundary

The production backend is intentionally not implemented in this scaffold.
`SPEC.md` requires server-side credentials, authentication, payload validation,
optional sensitive-data masking, batching, structured response validation, and
an approved data-retention policy before real provider calls are enabled.

## Local mock server

`src/mock-server.ts` exposes a development-only endpoint:

```text
POST http://127.0.0.1:8787/v1/translate
Content-Type: application/json

{
  "targetLanguage": "en",
  "items": [
    { "anchorId": "anchor-1", "source": "会社情報", "component": "navigation" }
  ]
}
```

The response is deterministic and uses the same mock dictionary as the
fixture adapter. It has no authentication, persistence, rate limiting, or
production security guarantees. The extension does not call it yet; this
boundary exists to make the future backend integration explicit without
shipping credentials or page content.
