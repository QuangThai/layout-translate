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
  A snapshot derived from a public third-party home page was prepared and then
  withdrawn: the repository holds no right to retain or replay another company's
  page content, so source ownership is a precondition rather than a later review
  step. The checked-in corpus stays repository-generated synthetic and pending.
  The runner itself is no longer the blocker; corpus authority and the remaining
  policy decisions are. Both are captured in
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
- [x] Make the real-corpus manifest classify content explicitly as
  `synthetic-only` or `public-sanitized`, so a snapshot derived from a real page
  cannot be mislabeled as synthetic; both classes stay approval-gated.
- [x] Rehearse the real-corpus runner end to end against a throwaway synthetic
  corpus outside the repository, proving the tooling is not the blocker.
- [x] Make live-site developer verification possible: per-origin opt-in host
  access from the popup, and an opt-in real OpenAI provider behind the existing
  backend boundary with no assumed model. Recorded in
  [`docs/decisions/0005-live-site-developer-verification.md`](../../decisions/0005-live-site-developer-verification.md)
  and operated through
  [`docs/runbooks/translate-a-live-site.md`](../../runbooks/translate-a-live-site.md).
- [x] Observe real-provider behaviour end to end with `npm run live:smoke`,
  which drives the built extension against the local Japanese fixture through a
  real provider and reports geometry, latency, and rendered samples without
  enforcing a tolerance.
- [x] Reduce real-provider translation latency. Repeated strings now collapse
  into one request item, batches are smaller, up to four are in flight at once,
  each renders as it arrives, and visible content is translated first. A failed
  batch reverts the whole pass so progressive rendering never leaves the page
  half translated.
- [x] Honour the standard `translate="no"` and `notranslate` opt-out, so a page
  can keep brand names and identifiers out of translation without the engine
  guessing which text is a proper noun.
- [x] Send a measured character budget for regions that must keep their box, so
  the provider can shorten to the space that exists.
- [ ] Give the medium policy a measured bound. Real pages show it allowing
  changes of `143px` to `269px`, which is permitted by "limited controlled
  change" only because that phrase has no number behind it.
- [ ] Reduce the remaining Vietnamese clipping. The budget did not move it: a
  control sized to two or three Japanese characters has no room for any
  accurate English or Vietnamese label, so those anchors correctly fall back to
  ellipsis plus tooltip. Closing this needs a product decision about what may
  change when no honest label fits, not a better prompt.
- [x] Observe real-site behaviour. `npm run live:site` drives the built
  extension against a real page with a real provider through Playwright and
  records translation coverage, anchor shifts, overflow, clipping, restore, and
  screenshots. This is developer evidence from one live page; it is not a gate
  and does not replace the approval-bound corpus calibration.
- [x] Fix the constrained fallback on flex and grid controls, found by that run:
  `text-overflow` does not apply to a flex container, so a clipped label lost
  both ends and showed an unreadable middle fragment with no ellipsis.
- [x] Explain and reduce the Vietnamese pass being roughly three times slower
  than English on the same live page. It was not provider latency: a page that
  mutates while a batch is in flight invalidated the pass, and the finished
  translations were discarded and bought again.
- [x] Cover the dynamic behaviours a single-screen fixture cannot show: content
  appended while scrolling, a section revealed on intersection, page-owned text
  the site keeps rewriting, recycled list rows, and a continuous animation.
  `npm run dynamic:smoke` drives all of them offline against the mock backend,
  and `--negative-control` proves the assertions can fail.
- [x] Measure what `SPEC.md` section 10 actually asks Phase 0 to measure, on
  real pages: anchor shift, sibling displacement, overflow, line changes,
  truncation, and critical breaks, reported per component policy in the shape
  section 11 defines. The engine reports its own per-anchor account in counts
  only, so the audit says which policy applied rather than guessing from markup.
- [x] Keep protected strings on the device instead of refusing the page. The
  content script now applies the same protected-content rule as the backend
  before sending anything, so a matching string never leaves the browser and one
  of them no longer costs the reader every other translation on the page. The
  popup reports how many were kept. The backend still refuses them as defence in
  depth.
- [x] Prove content revealed by a reader's action is translated: a `<dialog>`
  opened with `showModal`, a panel that loses its `hidden` attribute, and a menu
  revealed by a class change. All three were already handled, because content
  that is present but hidden is collected on the first pass; the run now proves
  it with the page's own churn stopped, so nothing else can be doing the work.
- [x] Translate same-origin frames. Each frame runs its own engine and reports
  its own state, and the background folds those reports into the single state
  the popup shows. Translation requests now carry the frame's own origin instead
  of the tab's, so a cross-origin frame cannot have its content attributed to an
  allowlisted top-level origin.
- [x] Reach text behind a shadow boundary. Every open shadow root, however
  deeply nested, is walked and observed in its own right, so web component text,
  its attributes, its slotted light DOM, and content it adds after first render
  are all translated. A closed root exposes no `shadowRoot` and stays
  unreachable; that is a platform limit, recorded rather than worked around.
- [x] Translate the visible strings that live in attributes rather than text
  nodes: `placeholder`, `alt`, `title`, and `aria-label`. Values the page also
  uses as machine data are left alone, restore returns the original values, and
  the observer watches only those four attributes so class churn on an animated
  page is not mistaken for new content.
- [x] Stop paying for the same string twice. Translations are reused locally
  within a language, cleared on restore and on any backend configuration
  change, and bounded so a long session cannot grow without limit.
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
- [x] Add transaction guards for delayed translation responses, restore,
  language switches, route/font invalidation, and incomplete batch correlation;
  delayed browser proof covers restore and EN-to-VI races without stale renders.
- [x] Make presentation restoration ownership-aware; style declarations and
  title/ARIA attributes are restored only while their current values still
  match extension-applied values, preserving page-owned mutations.
- [x] Detect Japanese source before requesting translation so non-Japanese
  records are skipped instead of sent to the backend.

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
- 2026-08-13: Treat each in-flight translation batch as a versioned
  transaction. Restore, target-language, route, font, and DOM invalidation
  discard stale results; a requested rescan runs after the current request
  settles.
- 2026-08-13: Treat presentation declarations as extension-owned only for the
  values this engine applied. Restore removes or reverts those declarations
  only when the page has not changed them, so host-page mutations remain
  authoritative.
- 2026-08-15: Render translated batches as they arrive rather than waiting for
  the whole page, and treat a failed batch as a whole-pass rollback. Progressive
  rendering is what makes a real provider usable, and the rollback keeps the
  existing guarantee that a failure never leaves partially translated output.
- 2026-08-15: Separate live-site verification from corpus calibration. Opening a
  site in a developer's own browser stores and redistributes nothing, so it is
  governed by per-origin consent rather than by the corpus approval packet.
  Committing a page snapshot into the repository remains fully gated.
- 2026-08-15: Require corpus source ownership before sanitization review. A
  page the repository has no right to retain or replay cannot become an
  approved corpus no matter how well it is sanitized, so a third-party public
  page is not an acceptable substitute for a product-owned one.

## Validation

- Focused proof: `npm test` passed; 9 test files and 45 tests passed, including
  overflow tolerance, sibling-shift helper, compact badge candidates,
  delayed-response correlation guards, source-language detection, and
  real-corpus manifest v2 content-class validation.
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
- Concurrency proof: `npm test` passed 35 tests, including fail-closed
  translation-result correlation. `npm run e2e:smoke` passed with the mock
  backend's bounded `delay-success` mode: restoring while a request was pending
  left Japanese source and restored state intact, and switching EN-to-VI while
  the English request was pending rendered Vietnamese rather than the stale
  English response. The rerun reported zero page, console, or browser-log
  errors and cleaned up its owned processes/profile.
- Presentation ownership proof: the browser smoke changed a constrained
  translated control's background color, width, title, and ARIA label while
  translation was active. Restore returned the Japanese text while preserving
  all four page-owned values; translation then resumed normally. The same
  E2E rerun passed with zero page, console, and browser-log errors, and the
  report records `presentationOwnershipVerified: true`.
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

- Real-corpus runner rehearsal: the runner was exercised end to end against a
  throwaway copy of the checked-in synthetic corpus placed outside the
  repository, with harness-only approval fields. Preflight passed, and
  `--mode=both` passed all 4 cases (baseline and translation at desktop and
  mobile) with `gateFailures: []` and `screenshotFailures: []`. Every anchor and
  sibling shift was `0px` in EN and VI at the `5px` provisional threshold, and
  `pageOverflow` was `false` everywhere. Element-level overflow offenders were
  identical before and after translation (1 on desktop, 20 on mobile), so they
  come from the fixture's own mobile table-scroll container and visually-hidden
  caption rather than from translation. This proves runner mechanics only; the
  repository corpus stays `pending-review` and no real-corpus evidence is
  claimed.

- Live-site enablement proof: `npm test` passed 11 files and 56 tests, including
  per-origin site-target scoping and the provider's fail-closed configuration,
  minimized payload, timeout, refusal, and malformed-output handling.
  `npm run typecheck` and `npm run build` passed, and the built manifest keeps
  declared `host_permissions` at the fixture hosts while listing
  `optional_host_permissions` separately. `npm run backend:smoke` and
  `npm run e2e:smoke` both still passed with zero page, console, and browser-log
  errors, so the opt-in path did not weaken the fixture proofs. No real provider
  call has been made from this repository; the provider path is covered by
  focused tests with a stubbed fetch only.

- First real-provider evidence: `npm run live:smoke -- --model=gpt-4.1-mini`
  passed against the local Japanese fixture. The backend started in provider
  mode, 62 anchors rendered in both languages, and page/console/backend error
  counts were zero. Hard regions held exactly: hero, summary card, table panel,
  and notice each moved `0px` in EN and VI, and no page overflow appeared. The
  long-form region grew `47.09px` in height in both languages, moving the footer
  down by the same amount; that is the documented soft-preserve behaviour, not a
  regression. Restore returned the Japanese source with every measured shift
  back to `0px`. Two findings came out of it: EN needed `15.0s` and VI `20.5s`
  to render because batches are sequential, and Vietnamese pushed more elements
  into the ellipsis fallback than English, including the brand label, which
  should not be translated at all. Latency and compact-candidate quality are
  now tracked as open work rather than claimed as solved.

- Latency result: on the same fixture, model, and runner, full-page rendering
  went from `15.0s` to `6.9s` in English and from `20.5s` to `8.0s` in
  Vietnamese, and the first visible text now lands well before the page
  finishes because batches render as they arrive. Geometry was unchanged by the
  optimisation: hard regions still moved `0px`, the long-form region still grew
  `47.09px`, no page overflow appeared, and restore still returned every
  measured shift to `0px`. `npm test` (12 files, 64 tests), `npm run e2e:smoke`,
  `npm run calibration:smoke` (6/6 cases), and `npm run backend:smoke` all
  passed afterwards.
- Observer regression found and fixed during that work: progressive rendering
  made the engine's own text writes look like page mutations, so the observer
  invalidated the pass that had just produced them and the status never reached
  `rendered`. Extension-owned text writes are now counted and matched against
  the mutation records they produce, so only genuine page changes invalidate a
  pass. A focused test also caught a later batch's failure replacing the first
  one's diagnostic; the first failure is now the reported one.

- Compact-budget result, including what it did not fix: the first attempt
  derived the budget from the control's current width and treated it as a hard
  limit. English clipping fell from 4 elements to 1, but the navigation label
  `概要` came back as `Sum` instead of `Overview`, because a box sized to two
  Japanese characters leaves room for roughly four Latin ones. Vietnamese got
  worse in that configuration, at 6 clipped elements. The budget is now omitted
  below 8 characters and the provider is told that correctness outranks the
  limit. With that change English returned to `Overview` and clipping settled at
  4 elements in English and 5 in Vietnamese, which is where it started. The
  honest conclusion is that the budget helps only where a control is already
  wide enough, and that narrow CJK-sized controls have no accurate short label
  to find; those anchors keep their box and expose the full text through the
  tooltip and `aria-label`, which the run confirmed.
- Opt-out proof: the representative fixture carries the same Japanese string
  twice, translated in the navigation and marked `translate="no"` in the
  tagline. `npm run e2e:smoke` passed with `translationOptOutPreserved: true`,
  so the opt-out is proven rather than a missed node.
- Regression proof after both changes: `npm test` passed 14 files and 86 tests,
  `tsc --noEmit` was clean, `npm run e2e:smoke` passed with zero page, console,
  and browser-log errors, and `npm run calibration:smoke` passed all 6 cases
  with unchanged geometry. The live provider run kept hard regions at `0px`,
  page overflow false, and full-page rendering at `6.4s` English and `6.8s`
  Vietnamese.

- First real-site evidence, on a public Japanese Nuxt page of 178 Japanese text
  nodes: 176 anchors translated, `header` and `nav` held at `0px` shift in both
  languages, and no horizontal page overflow appeared. `main` grew `342.64px` in
  English and `277.86px` in Vietnamese on a `10697px` page, moving the footer
  down by the same amount; that is the soft-preserve policy on long copy, not a
  hard-region failure. Restore returned all 178 Japanese nodes with every
  measured anchor shift back to `0px` and no scroll-height change. Page,
  console, and backend error counts were zero, and the run removed its profile,
  its temporary extension copy, and its backend.
- Defect the live page exposed and this pass fixed: navigation controls laid out
  as flex containers lost both ends of a clipped label and showed a middle
  fragment with no ellipsis, because `text-overflow` does not apply to a flex
  container. English rendered `ent Achi` and Vietnamese `ang ch` in the
  navigation. The fallback now switches a text-only intrinsic container to block
  layout and pins the original line-box height, or stops centring when the
  element has element children. The rerun renders `Devel⋯` and `Tra⋯` with the
  full text still on the tooltip and `aria-label`.
- Open finding from the same run: the Vietnamese pass took about three times as
  long as English on this page, `50.1s` against `18.8s`, which the fixture runs
  did not show. Cause is not established, so it stays open rather than being
  attributed to provider latency.
- Measurement caveat: residual Japanese after a pass varied between 2 and 15
  nodes of 178 across reruns of the same page. A live SPA keeps loading and
  re-rendering, so live-site coverage is an observation, not a stable metric.
- Cleanup defect fixed during this work: the runners spawned `taskkill` by name.
  Node passes its own `PATH` to `CreateProcess`, so a POSIX-style `PATH` from a
  Git Bash shell left Windows unable to find it, and the failed spawn emitted an
  unhandled `error` event that killed a runner mid-cleanup and left Chrome
  running. Every runner now resolves it under `%SystemRoot%`.

- Dynamic-behaviour evidence: the new fixture appends cards while scrolling,
  reveals a section on intersection, rewrites its own status text every 900ms,
  recycles three list rows every 1.2s, and runs a CSS animation throughout.
  `npm run dynamic:smoke` confirms appended and revealed content is translated,
  a recycled row never shows another row's translation, page-owned text keeps
  showing a current translation rather than a stale one, and restore returns the
  Japanese source. Running it with `--negative-control`, which withholds the
  translations, turned six assertions red and exited non-zero, so the suite is
  not vacuous.
- Cost findings from that fixture, measured over a 10-second window in which the
  reader does nothing: text the page rewrites on a timer cost `17` requests and
  `35` strings before the memo and `0` and `0` after it, because the page cycles
  through a handful of strings it has already shown. A CSS animation that
  changes no text cost nothing in both cases. Whole-session totals fell from
  `23` requests and `67` strings to `7` and `23`.
- The Vietnamese slowness recorded earlier is explained and fixed. On the same
  live page the Vietnamese pass sent `309` strings against English's `147`,
  because the page mutated while batches were in flight, the pass was
  invalidated, and finished translations were thrown away and requested again.
  Results are now remembered even when their pass is superseded, provided the
  reader has not turned translation off or changed language. The rerun sent
  `147` strings in both languages and took `17.9s` for Vietnamese against
  `46.4s` before, with English at `13.8s`.
- Behaviour change recorded rather than slipped in: reusing translations locally
  means a page can stay translated without contacting the backend. Two rules
  keep that honest. Restore clears the reuse, so the next pass starts from the
  backend. Any change to the backend configuration broadcasts an invalidation to
  every tab, so results are never served under a configuration that did not
  produce them. Both were found by existing browser proofs failing, not by
  reasoning: the authorization-failure and delayed-response scenarios went red
  until each rule was added.
- Regression proof after all of it: `npm test` passed 15 files and 92 tests,
  `tsc --noEmit` was clean, `npm run e2e:smoke` passed with zero page, console,
  and browser-log errors, `npm run calibration:smoke` passed 6 of 6 with
  unchanged geometry, `npm run backend:smoke` passed, and the live-site run kept
  every measured anchor shift at restore back to `0px`.

- SPEC-shaped measurement across three real Japanese pages, in English, with
  `gpt-4.1-mini`. The number that answers the product promise is whether an
  anchor kept its own box, not whether it stayed at the same position: anything
  below a block that grew is pushed down without its own box changing at all,
  and reporting that as a failure would have been misleading.

  | Page | Anchors | Hard box held | Medium box held | Critical breaks | Page overflow |
  | --- | --- | --- | --- | --- | --- |
  | Card issuer | 242 | 49/49 | 83/166 | 0 | none |
  | Retailer | 371 | 152/157 | 106/201 | 0 | none |
  | Broadcaster news | 521 | 309/309 | 77/147 | 0 | none |

  Hard-policy anchors held their box in 510 of 515 cases at the provisional
  `5px` target, and the largest hard-policy size change seen was `16.39px` on
  one page and `0px` on the other two. Nothing semantic-critical was shortened
  anywhere. Truncation to ellipsis plus tooltip was used 6, 8, and 19 times.
  Medium-policy anchors held their box about half the time, which is what that
  policy permits, but the largest changes were `143px`, `160px`, and `269px`,
  so "limited controlled change" has no measured bound yet.
- Two operational findings from pointing the live runner at Japanese sites other
  than the first one. A large retailer's site answered the automated browser with
  an Akamai `Access Denied` page, which the runner reported as "no Japanese
  text"; it now captures the URL, title, and a screenshot so a block page cannot
  be mistaken for an empty one. The browser advertised itself as
  `HeadlessChrome`; presenting the ordinary Chrome name got the real page, and a
  site that still refuses is left alone rather than worked around further.
- The same page then exposed a real product defect. It is a credit-card site, so
  the word クレジットカード appears throughout, matched the protected-content rule,
  and the backend refused the whole batch with `sensitive_content_blocked`. One
  ordinary marketing phrase meant nothing on the page translated at all. The
  content script now applies the same rule before sending, so protected strings
  never leave the browser and the rest of the page is unaffected. On the same
  page: 242 of 247 text nodes and 54 of 57 attributes now translate, with no
  backend errors, no page overflow, nothing newly clipped, and restore returning
  all 247. The five that stay Japanese are the protected ones.
- Reveal finding, which contradicted the expectation that motivated the work:
  content behind a modal, a `hidden` panel, or a `display: none` menu was
  already translated before the reveal, because visibility is judged per element
  and a hidden ancestor does not change a descendant's computed display. The
  reveal phase therefore had to stop the page's own ticker before asserting, or
  it would have passed on the strength of a rescan triggered by unrelated churn.
  One consequence worth noting rather than fixing here: geometry measured while
  an element is hidden is zero, so hard-region width pinning does not apply to
  content that is translated before it is ever shown.
- Fixture defect found while doing it, and worth separating from engine
  behaviour: the endless feed used a one-pixel `IntersectionObserver` sentinel
  that never reported an intersection. Reproducing it in a browser with no
  extension loaded showed the same result, so it was the fixture, not the
  engine. Making the sentinel taller and the scroll steps smaller did not fix
  it, so rather than claim an explanation the feed now appends from a scroll
  listener, which is what many endless feeds actually use. Intersection-driven
  reveal remains covered by the deferred section, which works.
- Frame proof: the dynamic fixture embeds a same-origin frame whose heading,
  body text, and input placeholder are all translated, and the popup reports the
  anchors of every frame as one number rather than whichever frame reported
  last. The aggregation prefers the state that most needs attention, so one
  non-Japanese frame cannot make a translated tab look unsupported, and it is
  covered by focused tests.
- Origin-attribution defect found while adding frames: translation requests used
  the tab's URL as the page origin. For a same-origin frame that is the same
  value, but a cross-origin frame would have had its content attributed to the
  allowlisted top-level origin and passed a check that was never granted for it.
  Requests now carry the frame's own URL.
- Shadow-boundary proof: the dynamic fixture now hosts a component whose text
  lives in an open shadow root, containing a second component with its own
  shadow root, a slotted light-DOM node, an attribute, and a paragraph the
  component appends 2.5 seconds after its first render. All five are translated
  and the late paragraph proves the shadow root is observed rather than walked
  once. A sibling component with a closed root stays unreachable, which the run
  asserts so the limit would be noticed if it ever changed. The negative control
  turns fourteen assertions red, five of them these.
- Attribute-text gap, found by measuring the live page rather than guessing: it
  carried five Japanese strings that a text-node walk cannot see, three form
  placeholders and two image `alt` values. The contact form therefore had
  translated labels above inputs still reading 株式会社◯◯◯◯◯ and 山田 太郎. The
  same measurement found no shadow roots and no iframes on that page, so those
  remain unproven gaps rather than known ones. After the change the live run
  reported `0/5` Japanese attributes remaining and the provider cost rose by
  exactly those five strings, from `147` to `152`.
- Attribute proof on the fixture: `npm run dynamic:smoke` now checks that
  placeholders, `alt`, and a page-owned `title` are translated and that restore
  returns all of them to Japanese. The negative control turns nine assertions
  red, including the three new ones.
- Boundaries chosen deliberately for attribute values: anything that looks like
  a URL, mail or tel target, path, fragment, or template token is skipped, since
  translating it would break the page rather than help a reader. Values this
  engine wrote are recognised as its own output rather than re-read as page
  source, and attribute writes it makes are excluded from the observer the same
  way its text writes already were.

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
snapshot is present in the repository. The runner is implemented and now
rehearsed end to end, so the gap is authority rather than tooling: a
third-party public page was evaluated and rejected for lack of retention
rights, and preflight stops before Chrome until a product-owned snapshot and
its translation-review authority exist. Browser-observable accessibility
validation can proceed against an approved snapshot, while screen-reader
validation is explicitly deferred from this pass.
