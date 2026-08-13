# 0003 Translation Model Benchmark Contract

Date: 2026-08-12

## Status

Proposed

## Context

`SPEC.md` requires an EN/VI model benchmark before selecting a provider model,
but the repository currently has no approved real-corpus snapshot and no
provider integration. Choosing a model from implementation defaults or from a
synthetic fixture would create unsupported product policy.

The project needs a safe, replayable benchmark contract that can validate the
case set and evaluator shape now, while reserving model quality, latency, cost,
and structured-output conclusions for an explicitly authorized provider run.

## Decision

For the current technical-spike phase:

1. Maintain a versioned synthetic case set at
   `benchmarks/translation-cases.json` covering navigation, buttons, tables,
   headings, paragraphs, critical warnings, interpolation tokens, and dates.
2. Require both EN and VI references for every case, with compact references
   where the UI policy needs them.
3. Mark cases with semantic-critical and layout constraints so a later provider
   benchmark can evaluate meaning and fit separately.
4. Run `npm run benchmark:translation` only as an offline reference-set
   validation. It must not use network access, credentials, or page content.
5. Keep `model` and `provider` unset in the offline report. No model is
   selected by this record.
6. Require human semantic review and an approved corpus/provider authority
   before treating benchmark scores as a model-selection decision.
7. Candidate model IDs are supplied at runtime through
   `LAYOUT_TRANSLATE_BENCHMARK_MODELS`; no model is a repository default.
8. A provider run must use an approved backend endpoint and backend-owned
   credentials. The extension and benchmark source never receive provider
   credentials. The provider runner fails closed and performs no network call
   until its gateway client is explicitly implemented and approved.

## Alternatives Considered

1. Call a provider immediately with the synthetic set; rejected because no
   provider/model or runtime data handling authority has been selected.
2. Select the model with the best synthetic exact-match score; rejected because
   reference matching is not semantic quality proof.
3. Add more layout fixtures first; deferred because local geometry proof already
   exists and does not resolve model quality, latency, or cost.

## Consequences

Positive:

- The benchmark input and evaluation boundary are reviewable and replayable.
- The project can detect malformed or incomplete benchmark cases without
  external calls.
- The implementation does not accidentally freeze a model or provider policy.

Tradeoffs:

- The current report does not measure translation quality, latency, cost, or
  structured-output reliability.
- Reference strings are evaluator guidance and require human review.
- Real model selection remains blocked until provider access, corpus authority,
  and review ownership are available.

## Follow-Up

- Add approved real-corpus cases only after sanitization and product review.
- Define the provider-run report fields for latency, cost, response validity,
  candidate quality, semantic-critical failures, and human review outcomes.
- Run the benchmark against candidate models through the server-side backend;
  never expose provider credentials in the extension. The current provider
  command is intentionally a fail-closed gateway placeholder.
- Use OpenAI Responses Structured Outputs with a strict schema when the backend
  gateway is implemented; validate refusal/incomplete responses and correlate
  every returned anchor before scoring. This follows the official Structured
  Outputs contract, but does not select a model here.
- Record the selected model in a separate accepted decision after review.
