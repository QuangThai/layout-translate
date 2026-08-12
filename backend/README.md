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
correlate to the request. It does not persist source or translated content.
The extension does not call it yet; this boundary exists to make the future
backend integration explicit without shipping credentials or page content.

Replay the HTTP boundary proof with:

```text
npm run backend:smoke
```
