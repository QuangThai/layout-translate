# Execution Plan: Layout-Preserving Translation Technical Spike

Date: 2026-08-12

## Status

Active

## Outcome

Produce a runnable, repeatable technical spike that demonstrates Japanese to
English/Vietnamese in-place translation with visual-anchor preservation for the
MVP component set, while keeping unresolved product and security policy
choices explicit.

## Context

- Product authority: [`SPEC.md`](../../../SPEC.md).
- Derived MVP contract: [`docs/product/overview.md`](../../product/overview.md).
- Repository workflow: [`docs/WORKFLOW.md`](../../WORKFLOW.md).
- The repository now contains the fixture-first extension scaffold, focused
  tests, mock backend boundary, and a replayable browser smoke command.

## Scope

In scope:

- Establish product and architecture authority derived from `SPEC.md`.
- Resolve or explicitly escalate visual, security, model, and browser decisions.
- Scaffold WXT, TypeScript, Manifest V3, popup, content script, and service
  worker boundaries.
- Build representative layout fixtures and executable geometry proof.
- Implement the smallest translation/rendering path that exercises the
  documented fallback order.
- Add backend boundary and OpenAI integration behind server-side credentials.
- Validate dynamic DOM, SPA navigation, restore, and language switching.

Out of scope:

- OCR, canvas/WebGL, PDF, or inaccessible iframe translation.
- Ask Atlas.
- Universal site support or zero-pixel layout guarantees.
- Domain-specific policy before the required human decisions are accepted.

## Approach

1. Convert the stable portions of `SPEC.md` into product and architecture
   documents without inventing open policy.
2. Record accepted decisions for tolerance, data handling, model, and browser
   scope; stop at any unresolved materially different choice.
3. Scaffold the extension and backend boundaries.
4. Create representative fixtures for navigation, controls, tables, cards,
   paragraphs, framework re-rendering, and SPA routes.
5. Implement source registry, extraction/classification, batch boundary,
   rendering policy, measurement, and observer recovery incrementally.
6. Add focused tests and browser-level evidence for the MVP proof obligations.
7. Run security and proof-debt review before calling the spike validated.

## Risks And Recovery

- Do not send internal or sensitive page content to an external model until the
  data policy is explicitly approved.
- Keep original source text authoritative so a failed translation or language
  switch can restore deterministically.
- Keep extension-owned mutations identifiable and idempotent to avoid observer
  loops and framework overwrite races.
- If a visual policy cannot be validated against fixtures, leave it open rather
  than claiming layout stability.

## Progress

- [x] Read `AGENTS.md`, `SPEC.md`, and repository workflow.
- [x] Map the initial repository and confirm application code was absent at
  spike start.
- [x] Inventory installed skills and available development tools.
- [x] Create the derived MVP product contract.
- [x] Establish architecture boundary document.
- [ ] Resolve remaining decision-required product policy (visual tolerance,
  provider model, and future domain/cache behavior).
  Synthetic benchmark contract is proposed; no provider model is selected.
- [x] Scaffold fixture-only extension and mock backend boundary.
- [x] Add representative fixtures and deterministic mock-adapter proof.
- [x] Add browser-level geometry, tooltip, dynamic DOM, and SPA proof.
- [x] Make the browser proof replayable with `npm run e2e:smoke`.
- [x] Preserve semantic-critical full text and prune disconnected DOM records.
- [x] Draft the proposed MVP translation data/security boundary decision record.
- [x] Accept the MVP translation data/security boundary decision record.
- [x] Add mock-backend contract validation for auth, allowlist, bounded
  payloads, protected-content denial, rate limiting, and response correlation.
- [x] Add non-content E2E trace output, page/console error assertions, and
  process-tree/profile cleanup retry.
- [x] Add the repository CI baseline and Node 22 engine requirement.
- [x] Add fixture-level framework rerender, delayed-font, keyboard-focus,
  geometry, and screenshot evidence.
- [x] Add real React 19 and Vue 3 rerender fixtures with idempotent recovery
  assertions.
- [x] Add additive accessible full-text semantics for constrained critical
  content and restore-proof coverage.
- [x] Add a local calibration corpus across flex, grid/table, long-form, and
  desktop/mobile viewport cases.
- [x] Resolve the desktop flex-intrinsic and grid/table displacement findings
  without widening the provisional hard-shift target.
- [ ] Validate the technical-spike exit gate.
- [ ] Run real-corpus calibration from a product-approved sanitized snapshot.
  A repository-generated synthetic `page.html`/`styles.css` sample now exists
  for offline tooling, but the approved real snapshot, assets, and completed
  approval fields are still missing. The open decisions and handoff fields are captured in
  [`docs/decisions/0004-real-corpus-calibration-approval.md`](../../decisions/0004-real-corpus-calibration-approval.md).
- [x] Add the offline fail-closed `npm run real-corpus:preflight` preparation
  check; it rejects the pending template without starting Chrome or making
  network calls.
- [x] Add a manifest measurement-target contract for anchor/sibling selectors
  and explicit desktop hard-gate flags; real-corpus target choices remain
  product-review input.
- [x] Add separate fail-closed real-corpus `baseline` and `translation` browser
  modes, with `both` running the two passes and translation references gated by
  explicit human-review metadata. The checked-in synthetic corpus remains
  pending, so no approval or real-corpus evidence is claimed.
- [x] Run browser-observable accessibility validation for constrained fallback;
  screen-reader support remains outside this pass. The E2E smoke now proves
  keyboard focus/native tab order, mouse activation, Escape preservation, and
  touch activation on the local fixture.
- [x] Add an offline synthetic EN/VI benchmark case set and reference validation
  harness; provider quality/latency/cost benchmark remains blocked on approved
  provider access and review authority.
- [x] Add a fail-closed backend-only provider benchmark contract; candidate
  models remain runtime configuration and no provider call is implemented.
- [x] Route extension translation through the local mock backend vertical slice;
  content script requests pass through the service worker and validated backend
  responses, with fail-closed errors preserving the source registry.
- [x] Add browser failure proof for invalid backend authorization; 401-style
  failure is surfaced as status error, Japanese source remains unchanged, no
  presentation fallback is applied, and recovery succeeds after config restore.
- [x] Complete browser failure matrix for synthetic 422 rejection, 502
  provider-invalid response, and request timeout; every mode preserves source
  and avoids partial presentation mutation.

## Decisions

- 2026-08-12: Treat `SPEC.md` as the only current product authority and mark
  its open questions as decision-required rather than choosing implementation
  defaults.
- 2026-08-12: Start the implementation phase documentation-only so no
  application behavior is implied before the architecture and policy boundary
  are explicit; later fixture-only behavior is tracked by executable proof.
- 2026-08-12: Limit extension host permissions to localhost fixture pages for
  the spike; this is a test boundary, not a product domain allowlist.
- 2026-08-12: Preserve heading regions and card regions when the card
  participates in flex/grid sizing, and use component-provided compact
  candidates for constrained card copy and badges. This keeps the source
  region stable while retaining the documented full-to-compact-to-tooltip
  fallback order.
- 2026-08-12: The next validation pass is authorized to use a product-approved
  sanitized HTML/CSS/font snapshot and browser-observable accessibility checks.
  The repository currently contains no such real-corpus snapshot; do not
  substitute an unapproved company page or infer a production tolerance.

## Validation

- Focused proof: `npm test` passed; 3 test files and 13 tests passed, including
  overflow tolerance, sibling-shift helper, and compact badge candidate
  assertions.
- Type proof: `npm run typecheck` passed after WXT generated its types.
- Build proof: `npm run build` passed and produced the Chrome MV3 bundle with
  background, popup, and translate content-script outputs.
- Browser E2E: fixture served on an ephemeral `127.0.0.1` port and exercised in Chromium
  with the built extension. EN and VI text rendering, popup ON/OFF routing,
  EN-to-VI switching, and page restoration were observed. No page errors or
  console errors were reported.
- Superseded initial browser attempt (before the replayable runner fix): the
  navigation group changed from `270px` to `193.4px` in EN and `335.6px` in VI;
  the first navigation anchor shifted by about `76.6px` and `65.6px`, and the
  dynamic SPA replacement was incorrectly treated as the old source. This is
  retained as historical evidence, not the current result.
- Repository-required checks: `.github/workflows/check.yml` now runs typecheck,
  unit tests, extension build, framework-fixture build, and backend contract
  smoke; browser E2E remains a separate environment-dependent smoke command.
- Replayable smoke: `npm run e2e:smoke` passed with Chrome for Testing. It
  measured `navWidth=270` in EN and VI, rendered constrained tooltip titles,
  translated the SPA replacement, and restored the current Japanese source.
- Critical/pruning regression proof: the constrained `data-semantic-critical`
  action kept full EN (`Review and send`) and VI (`Xem lại và gửi`) text while
  exposing each through a tooltip; removing that action after translation
  reduced the reported translated-anchor count by one.
- Policy gate: baseline recorded in
  [`docs/decisions/0001-mvp-translation-data-security-boundary.md`](../../decisions/0001-mvp-translation-data-security-boundary.md).
  It is now `Accepted` for MVP; real provider integration remains blocked on
  implementation of the listed backend controls and the separate model
  benchmark.
- Backend contract proof: `npm test` covers nine contract/runtime assertions;
  replayable `npm run backend:smoke` returned `200` for an authorized
  allowlisted request, `401` without authorization, `403` for a disallowed
  page origin, `422` for protected content, and `429` after the configured rate
  limit; each response exposed a unique non-content `x-request-id`. No
  provider call or durable content storage was introduced.
- Smoke harness reliability: the runner explicitly activates the fixture tab
  before using the popup so background active-tab routing is deterministic;
  `npm run e2e:smoke` passed after that change.
- Latest replayable browser rerun: EN and VI both kept the navigation group at
  `270px` with the first anchor at `x=805.5px`; constrained strings exposed
  tooltip titles; a fresh-load SPA transition translated the current dynamic
  source in both languages; restore returned the current Japanese source; and
  the runner emitted a non-content JSON trace report.
- Character-data regression proof: changing the existing dynamic text node in
  place with `node.data = "新しい通知"` translated it to `New notification`,
  and restore returned that current source to Japanese.
- Baseline after calibration-runner fix: `npm run e2e:smoke`,
  `npm run backend:smoke`, and `npm run benchmark:translation` passed after the
  calibration rerun; E2E retained zero page/console/log errors and confirmed
  cleanup.
- Browser-observable accessibility interaction evidence: `npm run e2e:smoke`
  passed keyboard focus/native tab order, full-text title and aria-label
  preservation, mouse activation, Escape preservation without a reflowing host
  overlay, and touch activation. This remains browser-observable evidence only;
  it does not prove screen-reader output or real-device touch behavior.
- Latest exit-gate evidence: the fixture replaced a framework-style DOM region
  and translated the new node in both target languages; a delayed `FontFace`
  reached `document.fonts.ready` while the translated font-sensitive node stayed
  stable; the critical action remained in the native tab order and retained its
  full-text tooltip; the two-card grid and fixed-layout table reported no page
  or table overflow; and EN/VI screenshots were written alongside the report.
  The report schema remains `layout-translate/e2e-report/v1`, with page,
  console, and browser-log error counts at zero and temporary browser profile
  cleanup confirmed. The fixture server returns `204` for the browser's
  automatic favicon probe so expected infrastructure noise does not mask real
  page failures.
- React/Vue proof: a production-built React 19 `StrictMode` fixture and Vue 3
  runtime fixture both translated their initial Japanese nodes, survived state
  rerenders, switched to Vietnamese, and restored the current Japanese source.
  The report records only booleans and geometry, not page text.
- Accessibility proof: constrained semantic-critical controls now expose the
  full translated value through `aria-label` while retaining native focus and
  `title` behavior; restore removes the extension-owned label and title. The
  visual/accessibility contract is recorded as `Proposed` in
  [`docs/decisions/0002-technical-spike-visual-accessibility-contract.md`](../../decisions/0002-technical-spike-visual-accessibility-contract.md)
  and is not yet a production SLA.
- Backend failure proof: E2E intentionally swapped the runtime token to an
  invalid value, observed `status: error` with an unauthorized diagnostic, and
  confirmed the Japanese navigation/source and presentation metadata were
  unchanged. It then exercised isolated mock modes for 422 rejection, 502
  provider-invalid response, and timeout; each preserved the Japanese source,
  applied no title/ARIA presentation fallback, and recovered after returning
  to normal mode. The test-only mode endpoint is enabled only by an explicit
  environment flag and is not part of the normal backend surface.
- Mock-backend vertical slice: E2E and calibration now start an isolated mock
  backend, configure its URL/token in extension storage, and exercise content
  script → service worker → HTTP backend → validated correlated response → DOM
  rendering. The extension no longer uses the in-process dictionary in browser
  proof. Backend failures return an error without applying partial translations;
  focused backend-client tests cover minimized payloads, auth errors, incomplete
  responses, and anchor correlation.
- Offline translation benchmark: `npm run benchmark:translation` passed the
  synthetic case-set validator with 12 cases and 24 EN/VI evaluations. The
  report records `model: null`, `provider: null`, `networkUsed: false`, and
  `contentSentExternally: false`; it is input/evaluator validation only, not
  model-quality or selection evidence.
- Provider benchmark boundary: `npm run benchmark:translation:provider` is a
  fail-closed backend-only placeholder. Without explicit provider mode,
  approved backend URL, runtime model IDs, and backend auth it writes a
  `not-run` report and performs no network call. No model was selected.
- Calibration runner reliability: the prior timeout was isolated to
  `Page.captureScreenshot` during later cases, after earlier cases had already
  passed; cleanup then did not run before the outer command timeout. The runner
  now applies bounded CDP call timeouts, bounded cleanup, avoids capture-beyond-
  viewport screenshots, retries each capture twice with a short backoff, and
  records non-gating screenshot failures. Persistent failures are removed before
  the next run rather than reused as evidence.
- Screenshot stability follow-up: three sequential official
  `npm run calibration:smoke` runs passed all 6 cases with
  `artifactStatus: "complete"` and every cleanup flag true. One run needed the
  third capture attempt for a Vietnamese screenshot, confirming the retry path
  was exercised without changing the geometry gate.
- Calibration resolution: `npm run calibration:smoke` now passes all 6 local
  cases (flex/intrinsic, grid/table, and long-form at desktop and mobile).
  Desktop EN/VI anchor shifts are `0px`; the grid card and table-card height
  deltas are also `0px`, with no page overflow or browser errors. The original
  grid `8px` displacement was traced to an inline badge entering the ellipsis
  fallback: `overflow: hidden` changed its inline-block baseline and pushed the
  following card content. The fixture now supplies a compact badge candidate,
  so the engine keeps the hard region without that baseline mutation. Mobile
  remains measured but intentionally ungated; the latest maximum vertical
  anchor shift is `57.59375px`, so no mobile tolerance is being inferred.

## Result

Active. The fixture-only extension and mock-backend scaffold passes typecheck,
unit tests, production build, backend contract smoke, the replayable browser
smoke, and the local calibration gate. Browser E2E now proves basic EN/VI
rendering, hard-region preservation, constrained fallback, framework-style and
in-place dynamic source replacement, font-readiness recovery, keyboard
focus/tooltip/accessibility behavior, geometry/no-overflow metrics, restore
semantics, screenshots, and controls. The local desktop displacement findings
are resolved without changing the provisional threshold. The MVP data/security
boundary is accepted; real provider integration remains blocked on the listed
production controls and model benchmark. The technical-spike exit gate remains
open for a representative real webfont/company-page corpus, the accepted
visual-tolerance policy, and real assistive-tech/touch interaction calibration.
The provider benchmark is authorized only for synthetic cases through an
approved backend; the gateway client and candidate model list remain pending.
The immediate blocker is that no product-approved sanitized real-corpus
snapshot is present in the repository; the new runner is implemented but
preflight stops before Chrome until that snapshot and its translation-review
authority exist. Browser-observable accessibility validation can proceed
against an approved snapshot, while screen-reader validation is explicitly
deferred from this pass.
