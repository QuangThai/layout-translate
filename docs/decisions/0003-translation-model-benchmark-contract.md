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

## Provider Run, Implemented 2026-08-16

`npm run benchmark:translation:provider` now runs the case set against candidate
models through the backend, so provider credentials stay in the backend process
and never reach the benchmark script or the extension. Models come from
`LAYOUT_TRANSLATE_BENCHMARK_MODELS`; there is still no repository default.

It scores what holds whatever wording a model chooses, because item 2 of the
alternatives above rejects scoring on reference matching: remaining Japanese, a
compact longer than its full form, a compact over the budget the case declares,
a lost interpolation token, and a lost number or date. Reference agreement,
latency, and token counts are reported beside those, not scored on.

A compact budget now lives on each case rather than in the runner, so a reviewer
can see and argue with the number the models are judged against.

The first run measured this, on 12 cases in both languages:

| Model | Objective failures | Reference agreement | Total latency | Completion tokens |
| --- | --- | --- | --- | --- |
| `gpt-4.1` | 0 | 11 of 24 | 3.3s | 501 |
| `gpt-4.1-mini` | 1 | 12 of 24 | 6.0s | 500 |
| `gpt-5-mini` | 0 | 12 of 24 | 53.2s | 6261 |

The single failure was `gpt-4.1-mini` returning a Vietnamese compact longer than
its own full form, which the engine tolerates by using the full text.

Two things this run demonstrated about the method rather than the models. A
first version penalised every model for shortening a critical string's compact
variant, which the engine never displays, so it measured something no reader
ever sees. And reference disagreement turned out to be dominated by reference
quality: the `paragraph-long` reference was decorative fixture copy rather than
a translation of its source, so every model was scored against text the source
never said. It has been corrected and the reason recorded in the dataset.

No model is selected by this record. Selection still needs the human semantic
review required above, and that review should start from the recorded outputs
where models disagree with a reference, since most of those disagreements are
defensible translations rather than errors.

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
