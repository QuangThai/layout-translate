# Harness Improvement: Trace Metadata For Browser Smoke Reports

Date: 2026-08-12

## Status

Completed

## Representative Job

Improve the repository's replayable browser evidence so a later agent can
identify which source revision, command, and browser produced an E2E or
calibration report. The fixed worker is the repository smoke runner using Node
24.11.1, npm 11.6.2, the local Chrome for Testing installation, and the
existing `npm run e2e:smoke` / `npm run calibration:smoke` commands.

Baseline revision: `ae50e2df56df9fd499810509b8e824e71aebc61c` on `main`.
The working tree was already dirty with the current layout-translation spike
implementation, fixture, documentation, test, and CI changes; those changes
are unrelated and must be preserved. No external service or credentials are
used. Stop conditions are unchanged: do not add content-bearing trace data,
do not widen the product policy, and do not change the existing behavior gates.

## Baseline

The latest `.output/e2e-smoke-report.json` passed with zero page, console, and
browser-log errors and confirmed profile cleanup, but its `commit` field was
`null` outside CI. The calibration report similarly recorded Node, corpus,
viewport, geometry, and cleanup data but no repository revision or command.
The reports therefore proved observed behavior without reliably identifying the
source tree or invocation that produced the evidence. The human audit surfaced
this as reusable trace friction; no retry or recovery was required.

Known limitations: generated reports are local artifacts, the working tree is
dirty, and no persisted session transcript or trace log exists beyond the JSON
reports and Git history. The existing reports contain non-content geometry and
error evidence; this experiment must remain non-content.

## Earliest Gap

**Proof/context boundary:** the report schema omitted reproducibility metadata
needed to correlate an observation with its source revision and execution
environment. This is not a product-domain or provider-policy gap.

## Correct Owner

Consumer repository: `scripts/e2e-smoke.mjs` and
`scripts/calibration-smoke.mjs` own the report format and can collect local Git,
command, and browser metadata without changing the generic Harness.

## Intervention

If the two browser smoke runners add a non-content `trace` object containing
the Git revision/branch/dirty state, exact Node command, Node version, and
Chrome executable/version, then a fresh agent will be able to correlate a
report with its source tree and invocation instead of receiving an anonymous
`commit: null` result, because the runners already own report emission and CDP
exposes the browser version.

Evidence that would weaken this: a fresh report still lacks the revision,
command, or browser metadata; the fields are unavailable when the runner fails;
or the metadata introduces page/content data or makes the reports too brittle
for CI.

Maintenance owner: repository maintainers of the two smoke runners.
Removal condition: remove or revise the fields if they duplicate a repository
standard trace envelope, leak sensitive environment data, or fail to improve
fresh-run correlation.

## Native Validation

Run `git diff --check`, `npm run typecheck`, `npm test`, `npm run build`,
`npm run framework:build`, `npm run backend:smoke`, and the affected browser
smokes. Confirm generated reports contain only non-content trace metadata and
preserve the existing result/metrics/cleanup assertions.

## Fresh Rerun

An equivalent fresh process rerun was completed after the intervention:
`npm run e2e:smoke` and `npm run calibration:smoke` both passed. The reports
included the revision, `main` branch, dirty-tree state, the exact Node command,
Node 24.11.1, npm 11.6.2, Chrome 151.0.7922.138, and the Chrome revision.
Existing geometry, translation, accessibility, error, and cleanup proof
remained unchanged.

On 2026-08-13, a separate fresh agent retrieved the representative E2E report
and exercised the intervention with `npm run e2e:smoke`. It observed a passing
report at revision `ae50e2df56df9fd499810509b8e824e71aebc61c`, with 40 status
entries, 17 opaque backend request IDs, no raw browser/page diagnostic text,
and `profileRemoved`, `browserStopped`, `backendStopped`,
`fixtureServerClosed`, and `staleArtifactsRemoved` all true. The fresh agent
used the report directly without human relay.

## Decision

Keep

## Result

Completed. Native validation, equivalent smoke reruns, and the separate
fresh-agent retrieval/exercise all support keeping the intervention. The
remaining real-corpus, visual/accessibility, and provider benchmark items are
product or evidence backlogs outside this trace-boundary change.

## Approved Follow-Up Intervention

2026-08-13: The human approved the audit findings for a bounded follow-up at
the consumer-owned smoke/report boundary. If the runners emit only content-free
diagnostics, capture opaque backend request IDs, fingerprint the dirty source
tree and generated artifacts, remove stale owned artifacts before each run, and
record process/artifact cleanup status, then a later agent can correlate a
report without page-text leakage or stale screenshots, because the runners own
their report emission and process lifecycle. The benchmark reports will reuse
the same content-free provenance envelope. Product policy, provider selection,
and real-corpus approval remain outside this intervention.

Evidence that would weaken this: a fresh report still contains page text or
raw browser diagnostics, a failed screenshot leaves a stale owned artifact,
backend request IDs cannot be matched, or the extra metadata changes an
existing behavior gate.

Maintenance owner: maintainers of the smoke runners and report scripts.
Removal condition: remove or revise the added metadata if a repository-wide
trace envelope supersedes it, if it leaks content, or if it makes the runners
less reliable without improving correlation.

## Follow-Up Validation

2026-08-13: `npm test` passed with 6 files and 21 tests; `npm run typecheck`,
`npm run build`, `npm run framework:build`, `npm run backend:smoke`,
`npm run benchmark:translation`, `npm run e2e:smoke`, and
`npm run calibration:smoke` passed. The E2E report recorded npm 11.6.2,
tracked/untracked counts, a working-tree SHA-256, package-lock and build
artifact hashes, 17 backend response IDs, zero raw browser diagnostics, and
`browserStopped`, `backendStopped`, `fixtureServerClosed`, and
`profileRemoved` all true. Calibration passed all six geometry cases; one
optional screenshot timed out and was recorded as `errorCode: "timeout"`, with
the prior owned screenshot absent rather than reused. The provider benchmark
remains intentionally `not-run` and now also records content-free provenance.

The follow-up was exercised by this session and by the separate fresh agent;
the fresh-agent gate is complete.
