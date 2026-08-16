# Application Runbook: Translate A Live Site

Date: 2026-08-15

## Scope

Run the built extension against a real website with a real translation
provider, so a developer can observe whether in-place Japanese translation and
layout preservation behave as intended outside the fixtures.

This is a developer verification loop, not a product release path. It grants no
standing access to any site and adds no snapshot to the repository.

## Prerequisites

- Node 22 or newer (`package.json` `engines`).
- Chrome or Chrome for Testing.
- An OpenAI API key held by the operator, never committed and never placed in
  extension code or storage.
- A model ID chosen by the operator. The backend assumes no default model and
  refuses to start without one.

## Start

Build the extension:

```bash
npm run build
```

Start the backend with the real provider:

```bash
npm run backend:live -- --model=<model-id> --site=https://example.co.jp
```

- The key is read from `.env` (`OPENAI_API_KEY`) or the environment. It stays in
  the backend process; the extension never receives it.
- `--model` is required. No model is assumed, selected, or endorsed.
- `--site` is the page-origin allowlist from
  `docs/decisions/0001-mvp-translation-data-security-boundary.md`, and is also
  required. A page whose origin you did not list is rejected with
  `403 origin_not_allowed` rather than silently translated. Repeat the flag for
  more origins; a bare hostname is read as `https://`.
- Optional: `--port` (defaults to `8787`) and `--token` (defaults to
  `dev-only-token`, and only ever travels over `127.0.0.1`).
- The command prints the exact `chrome.storage.local.set` line to paste, with
  the port and token already filled in.
- The server binds `127.0.0.1` only.

`npm run backend:mock` still starts the same server on the offline dictionary
with no provider. Both accept the raw environment variables directly
(`LAYOUT_TRANSLATE_PROVIDER`, `LAYOUT_TRANSLATE_PROVIDER_MODEL`,
`LAYOUT_TRANSLATE_ALLOWED_ORIGINS`, `LAYOUT_TRANSLATE_PROVIDER_BASE_URL`,
`LAYOUT_TRANSLATE_PROVIDER_TIMEOUT_MS`, `LAYOUT_TRANSLATE_RATE_LIMIT`) when you
need something the flags do not cover.

## Readiness

The backend prints the configuration line to paste, then its listening line
followed by a single JSON line:

```json
{"event":"backend_started","provider":"openai","model":"<model-id>","allowedPageOrigins":["https://example.co.jp"]}
```

`provider` must read `openai`. If it reads `mock`, the provider environment was
incomplete and the offline dictionary is active instead.

## Deterministic State

1. Load `.output/chrome-mv3` as an unpacked extension in `chrome://extensions`
   with Developer mode on.
2. Open that extension's **service worker** link and paste the
   `chrome.storage.local.set` line the start command printed. This is stored per
   profile, so it survives restarts and only needs redoing if you change the
   port or token. `timeoutMs` defaults to `10000`, which is tuned for the
   fixture dictionary and is usually too short for a real provider batch.
3. Open the target page in a normal tab.

## Interface

1. Open the popup. It shows the current origin and an **Enable on this site**
   button for any origin that is not a fixture host.
2. Press it. Chrome asks for host access for that single origin; the popup then
   injects the content script into the active tab.
3. Toggle **Translate page** ON and choose EN or VI.
4. **Restore original Japanese** returns the current page source.
5. **Remove access** revokes the origin grant. Chrome also lists every granted
   site under the extension's *Site access* settings.

Granting is per origin: `https://example.co.jp` does not cover
`https://shop.example.co.jp` or a different port.

## Runtime Evidence

- Backend: one JSON line per response with `event`, `requestId`, `method`,
  `path`, and `status`. Page text and translations are never logged.
- Extension: the popup status line shows the current phase, or the backend
  error code for a failed batch. Errors carry the backend `x-request-id` so a
  popup error can be correlated with the backend line that produced it.
- Failure codes you should expect to see rather than treat as bugs:
  `origin_not_allowed` (page origin missing from the allowlist),
  `sensitive_content_blocked` (protected content pattern matched),
  `rate_limited`, `provider_rate_limited`, `provider_unavailable`,
  `provider_refused`, `provider_invalid_response`.
- A failed batch leaves the Japanese source in place and applies no partial
  presentation change.

## Ownership And Cleanup

- Stop the backend process this run started; it holds no durable state.
- Remove the site grant from the popup or from Chrome's extension settings.
- Remove the unpacked extension when finished.
- No snapshot, screenshot, or page content is written to the repository by this
  runbook. Anything you capture manually is yours to handle under the retention
  decision in `docs/decisions/0004-real-corpus-calibration-approval.md`.

## Automated run

```bash
npm run live:site
```

Drives the same journey with Playwright and writes measurements instead of
requiring a person to watch: how much of the page was translated, anchor shifts
against a pre-translation baseline, horizontal overflow, newly clipped elements,
scroll-height change, rendered samples, screenshots, and restore.

It reads `LAYOUT_TRANSLATE_PROVIDER_MODEL` and the first entry of
`LAYOUT_TRANSLATE_SITES` from `.env`; `--model=` and `--site=` override them, and
`--language=en|vi|both` selects the passes.

Two things to know about how it differs from the manual flow:

- Chrome's per-site permission bubble cannot be driven, so the runner copies the
  build to `.output/live-site-extension` and declares the target origin in the
  copy. That is the same grant the popup asks a person for. The shipped build
  still declares only the fixture hosts, and the copy is deleted on exit.
- It still injects the content script through `chrome.scripting`, exactly as the
  popup does after a real grant, rather than relying on a declared content
  script match.

The report at `.output/live-site-report.json` and the screenshots under
`.output/live-site/` contain real page text. `.output/` is gitignored; treat
those files as the site's content, not as repository artefacts.

## Validation

- `npm test`, `npm run typecheck`, and `npm run build` cover the contract and
  build.
- `npm run backend:smoke` proves the authorization, allowlist, protected
  content, and rate-limit behavior against the offline dictionary.
- `npm run e2e:smoke` proves the fixture journey end to end.
- This runbook itself is validated by the observed journey on a real site; that
  observation is not automated and must be reported as manual evidence.

## Unknowns

- No model is selected or endorsed. Model choice, quality, latency, and cost
  remain open per `docs/decisions/0003-translation-model-benchmark-contract.md`.
- Production domain policy, caching, and audit retention remain open. The
  allowlist here is an operator-supplied development value, not a product
  domain policy.
- Layout tolerance on real pages is not gated by this runbook. It renders and
  reports; it does not measure anchor shift.
