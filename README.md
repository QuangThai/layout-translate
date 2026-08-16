# Layout Translate

Fixture-first technical spike for a Chromium MV3 extension that translates
Japanese DOM text into English or Vietnamese while preserving the original
visual anchor.

## Current scope

- WXT + TypeScript + React popup.
- MV3 background service worker and content script.
- Localhost-only declared host permissions for the representative fixture, plus
  per-origin opt-in access for live-site verification.
- Deterministic mock backend translation adapter for browser proof.
- Opt-in real OpenAI provider behind the backend for developer verification;
  the offline dictionary remains the default and no model is selected.
- The extension vertical slice uses the local mock backend through the service
  worker; backend contract is available at `backend/src/mock-server.ts`.

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
`localhost`.

To watch the extension work on a real page instead of a fixture, follow
[`docs/runbooks/translate-a-live-site.md`](docs/runbooks/translate-a-live-site.md).
The extension never holds standing access to arbitrary websites: each origin is
requested from the popup at click time and can be revoked there.

## Checks

```bash
npm run typecheck
npm test
npm run build
npm run e2e:smoke
npm run calibration:smoke
```

`npm run e2e:smoke` rebuilds the extension, starts an isolated fixture server,
launches Chrome for Testing with the unpacked MV3 bundle, and exercises popup
ON, English/Vietnamese switching, hard-region geometry, constrained tooltips,
keyboard focus, delayed-font readiness, framework-style DOM replacement, SPA
content replacement, screenshots, and restore. Run `agent-browser install` once
to install the managed browser, or set `LAYOUT_TRANSLATE_CHROME` to an
equivalent Chrome for Testing binary. The runner builds a small real React 19
and Vue 3 fixture bundle before launching Chrome. It uses Node's built-in
WebSocket client and therefore requires Node 22 or newer. It writes a
non-content report to `.output/e2e-smoke-report.json` and screenshots to
`.output/e2e-english.png` and `.output/e2e-vietnamese.png`; set
`LAYOUT_TRANSLATE_E2E_REPORT` or `LAYOUT_TRANSLATE_E2E_ARTIFACT_DIR` to choose
different CI artifact paths. Before the run, the runner removes only its
owned report/screenshots. The report records content-free source/artifact
fingerprints, opaque backend request IDs, and process/server/profile cleanup;
browser diagnostics are counts/codes rather than raw page messages.

The repository CI workflow runs typecheck, unit/contract tests, the extension
build, the React/Vue fixture build, backend contract smoke, and the offline
translation benchmark contract. A second job runs the browser proofs: the
fixture journey, the dynamic-page suite with its negative control, and the
calibration gate. Those need a browser and nothing else, since all three drive
the offline mock backend. Stable Chrome now ignores `--load-extension` without
reporting it, so CI uses the Chromium build Playwright manages and runs headful
under Xvfb; set `LAYOUT_TRANSLATE_HEADFUL=1` to reproduce that locally.

`npm run calibration:smoke` runs three local layout archetypes (intrinsic flex,
grid/table, and long-form content) at desktop and mobile viewports. It records
non-content geometry/error metrics in `.output/calibration-report.json` and
per-case screenshots under `.output/calibration/`. The `5px` hard-shift gate is
applied only to the desktop calibration cases and remains a provisional spike
target, not a production SLA. Real company-page calibration still requires a
reviewed corpus supplied by the product team. Each run removes only its owned
report/screenshots first and records content-free provenance, artifact status,
diagnostic counts/codes, and cleanup status. Each screenshot capture has up to
two bounded retries with a short backoff and removes its owned path before each
attempt; `artifactStatus: "complete"` means every requested screenshot was
captured in that run. Screenshot capture remains optional artifact proof, so a
transient partial artifact report does not weaken the geometry gate. A non-zero
exit means the audit
found a real provisional-gate violation; it must not be “fixed” by raising the
threshold without a documented product decision.

`npm run dynamic:smoke` drives the behaviours a single-screen fixture cannot
show: content appended while scrolling, a section revealed on intersection, page
text the site keeps rewriting, recycled list rows, and a continuous animation.
It runs offline against the mock backend with fixed translations, so it costs
nothing and repeats deterministically. It also reports what the page's own churn
costs in provider requests, which is how the local translation reuse is
measured. Run it with `--negative-control` to withhold the translations and
confirm its assertions can still fail.

`npm run real-corpus:preflight` validates the approved snapshot contract
without starting Chrome or making network calls. It intentionally fails while
`fixtures/real-corpus/manifest.json` is `pending-review` or required snapshot
files are absent. Use `--mode=baseline` for geometry-only validation, or
`--mode=translation`/`--mode=both` when the manifest also contains
human-reviewed `calibration.translationCases` and `calibration.translationReview`.
The manifest's named measurement targets provide anchor/sibling selectors and
an explicit desktop hard-gate flag; each viewport also declares whether page
overflow is a hard gate or measurement-only. These contracts do not choose a
production tolerance by themselves.

`npm run real-corpus:calibration -- --mode=baseline` runs the approved snapshot
through a local-only browser replay and records geometry plus screenshots. Use
`--mode=translation` to run the extension against the local deterministic mock
backend with the manifest's reviewed EN/VI references, or `--mode=both` to run
both passes. The command always runs preflight first and writes a fail-closed
report to `.output/real-corpus-calibration-report.json`; the checked-in sample
therefore stops before Chrome because it has no product approval. Translation
overrides are generated in a temporary profile and are never sent to a real
provider.

## Mock backend

Configure the local boundary explicitly before starting the development-only
server:

```powershell
$env:LAYOUT_TRANSLATE_MOCK_AUTH_TOKEN = "dev-only-token"
$env:LAYOUT_TRANSLATE_ALLOWED_ORIGINS = "http://127.0.0.1:4173"
npm run backend:mock
```

The mock server listens on `http://127.0.0.1:8787` and accepts the structured
translation request described in `backend/README.md`. It is development-only,
but its request boundary exercises bearer authentication, origin allowlisting,
bounded payloads, rate limiting, protected-content denial, and response
correlation. It provides no production security guarantees. Replay the boundary
proof with `npm run backend:smoke`.

## Real provider mode

To translate a real page, start the backend with a real provider and follow
[`docs/runbooks/translate-a-live-site.md`](docs/runbooks/translate-a-live-site.md):

```bash
npm run backend:live -- --model=<model-id> --site=https://example.co.jp
```

It reads `OPENAI_API_KEY` from `.env`, requires an explicit model and page-origin
allowlist, and prints the extension configuration to paste. Configure the model,
site list, port, and token once in `.env` and the flags become optional.

```bash
npm run live:site
```

drives the same journey against a real site with Playwright and writes
translation coverage, anchor shifts, overflow, clipping, restore, and
screenshots to `.output/live-site-report.json` and `.output/live-site/`. Those
artefacts contain real page text and stay out of the repository.

The same server can also be started directly with the raw environment variables:

```powershell
$env:LAYOUT_TRANSLATE_PROVIDER = "openai"
$env:OPENAI_API_KEY = "sk-..."
$env:LAYOUT_TRANSLATE_PROVIDER_MODEL = "<model-id>"
npm run backend:mock
```

Replay the real-provider journey end to end with:

```bash
npm run live:smoke -- --model=<model-id>
```

It reads `OPENAI_API_KEY` from `.env` or the environment, starts the backend in
provider mode, serves the local Japanese fixture, drives the built extension
through EN, VI, and restore, and writes geometry, latency, rendered samples, and
screenshots to `.output/live-provider-report.json` and `.output/live-provider/`.
It is developer verification, not a gate: it asserts the journey completes and
reports what happened, rather than enforcing a tolerance.

To compare candidate models on evidence rather than on speed:

```bash
LAYOUT_TRANSLATE_BENCHMARK_MODELS=gpt-4.1-mini,gpt-4.1 npm run benchmark:translation:provider
```

It runs the case set through the backend, so the credential stays there. It
scores what holds whatever wording a model chooses — remaining Japanese, a
compact longer than its full form or over the budget the case declares, a lost
interpolation token, a lost number — and reports reference agreement, latency,
and token counts beside those rather than scoring on them. It selects no model;
[`docs/decisions/0003-translation-model-benchmark-contract.md`](docs/decisions/0003-translation-model-benchmark-contract.md)
requires human semantic review for that, and carries the first run's results.

There is no default model: provider mode refuses to start without an explicit
model ID, and incomplete configuration is a startup error rather than a silent
fall back to mock output. Deterministic fixture overrides are ignored in this
mode so they cannot rewrite real provider results. The startup log records the
provider and model but never page content. Selecting a model remains open under
[`docs/decisions/0003-translation-model-benchmark-contract.md`](docs/decisions/0003-translation-model-benchmark-contract.md);
this mode is authorised for developer verification only, per
[`docs/decisions/0005-live-site-developer-verification.md`](docs/decisions/0005-live-site-developer-verification.md).
