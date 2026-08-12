# Layout Translate

Fixture-first technical spike for a Chromium MV3 extension that translates
Japanese DOM text into English or Vietnamese while preserving the original
visual anchor.

## Current scope

- WXT + TypeScript + React popup.
- MV3 background service worker and content script.
- Localhost-only host permissions for the representative fixture.
- Deterministic in-process mock translation adapter.
- No OpenAI call, credentials, page-data upload, or production backend yet.
- Mock backend contract available at `backend/src/mock-server.ts`.

The product contract and unresolved policy choices live in
[`docs/product/overview.md`](docs/product/overview.md). The technical
boundaries live in [`docs/architecture.md`](docs/architecture.md).

## Development

```bash
npm install
npm run dev
```

Serve the fixture from the repository root in a separate terminal, for example
with any local static file server, then open `fixtures/representative.html` on
`localhost`. The extension intentionally does not request access to arbitrary
websites during this spike.

## Checks

```bash
npm run typecheck
npm test
npm run build
```

These commands are defined but have not been run in the scaffold phase.

## Mock backend

```bash
npm run backend:mock
```

The mock server listens on `http://127.0.0.1:8787` and accepts the structured
translation request described in `backend/README.md`. It is development-only;
it has no authentication, persistence, rate limit, or sensitive-data policy.
