# MVP Translation Data and Security Boundary

Date: 2026-08-12

## Status

Accepted

Accepted in the project working session on 2026-08-12. This acceptance covers
the MVP boundary below; it does not select a provider model or close unrelated
visual-tolerance, domain-persistence, or Ask Atlas questions.

## Context

`SPEC.md` makes the company backend the translation-provider boundary, but
leaves the allowed domains, data classes, sensitive-data handling, and
retention policy decision-required. The current mock backend is intentionally
development-only: it has no authentication, persistence, rate limiting, or
production security guarantees. The extension must not send page content to a
real provider until those boundaries are explicit.

This record captures the smallest safe MVP boundary accepted for the current
implementation phase. It supersedes the corresponding security/data open
questions in `SPEC.md`; implementation still requires the controls listed in
the follow-up section.

## Decision

The MVP boundary is:

1. **Domain scope:** production translation is available only on an explicit
   organization/domain allowlist. The current `localhost` and `127.0.0.1`
   fixture scope remains a test boundary, not a production allowlist.
2. **Payload minimization:** the extension sends only the requested source
   strings and the minimum translation metadata (`anchorId`, component kind,
   and target language). It does not send the full DOM, page screenshots, or
   unrelated page state by default.
3. **Sensitive content:** password, credential, payment, secret, and other
   explicitly protected fields are denied before translation. PII or sensitive
   text must be masked or denied server-side before any provider request; an
   uncertain classification fails closed until a project policy exists.
4. **Retention:** the MVP does not persist raw source text or translated text
   in a backend cache or operational log. Request processing is transient;
   bounded in-memory reuse may be added only if it does not create durable
   content retention and is separately documented.
5. **Backend controls:** the backend owns authentication, authorization,
   request-size and batch limits, schema validation, rate/cost controls,
   provider timeout handling, and response correlation/validation. Provider
   credentials never enter the extension bundle.
6. **Provider choice:** the model name remains backend configuration until an
   EN/VI benchmark and security review select it. This record does not freeze a
   particular OpenAI model.
7. **User and browser scope:** translation remains user-initiated from the
   popup and the MVP targets Chrome/Edge Chromium. Automatic cross-domain
   persistence is not part of this boundary.

## Alternatives Considered

1. Send arbitrary visible page text to the provider and rely on prompt-level
   caution. Rejected for the MVP because it has no enforceable data boundary.
2. Call OpenAI directly from the extension. Rejected because it exposes
   credentials and bypasses organization policy enforcement.
3. Allow a persistent translation cache immediately. Deferred because cache
   ownership, deletion, and retention obligations are not approved.
4. Use an explicit allowlist, minimized payload, fail-closed sensitive-data
   handling, and no durable content retention. Selected for the MVP because
   it limits exposure while preserving a testable backend contract.

## Consequences

Positive:

- Page content has an enforceable provider boundary before real integration.
- The extension can be tested against a stable backend contract without
  deciding a model name or introducing durable content storage.
- Security review can reason about a small payload and explicit failure modes.

Tradeoffs:

- Some pages and text will not translate until an allowlist or project policy
  explicitly permits them.
- Sensitive-data masking/denial may reduce coverage and needs its own tests.
- No persistent cache means higher provider cost/latency until a separate
  retention decision is accepted.

## Follow-Up

- Implement backend authentication, validation, limits,
  masking/denial, and non-content observability tests.
- Keep the mock provider until the backend contract and security tests pass.
- Run the EN/VI model benchmark as a separate decision; do not silently update
  this record with a model name.
