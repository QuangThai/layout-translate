# 0005 Live-Site Developer Verification With A Real Provider

Date: 2026-08-15

## Status

Accepted for developer verification only. This is not a production release
policy and does not close any open product decision.

## Context

Until now the extension could only run on `localhost` and `127.0.0.1`, and the
only translation source was an offline dictionary of ten fixed strings that
returns unknown input unchanged. Together these made the central product
question unanswerable: on a real Japanese page, does in-place translation keep
the layout intact?

The repository's real-corpus machinery answers a different question — repeatable
pixel-shift measurement in CI — and is blocked on corpus authority per
`0004-real-corpus-calibration-approval.md`. That blocker does not apply to a
developer opening a site in their own browser: nothing is stored, committed, or
redistributed.

The product owner authorised using a real OpenAI provider for this loop on
2026-08-15.

## Decision

1. **Per-origin opt-in site access.** Declared host permissions stay limited to
   the fixture hosts. Every other origin is requested at popup click time
   through `optional_host_permissions`, one exact origin at a time, and can be
   revoked from the popup or Chrome's settings. The extension holds no standing
   access to pages the user has not enabled.
2. **Real provider behind the existing backend boundary.** The backend gains an
   opt-in `LAYOUT_TRANSLATE_PROVIDER=openai` mode. The provider credential stays
   in the backend process; the extension never receives it. The default remains
   the offline dictionary.
3. **No assumed model.** The backend refuses to start in provider mode without
   an explicitly configured model ID. No model is selected, defaulted, or
   endorsed by this decision.
4. **Fail closed, not degraded.** Incomplete provider configuration is a startup
   error rather than a silent fall back to mock output, and deterministic
   fixture overrides never rewrite what a real provider returned.
5. **All existing controls still apply.** Page-origin allowlist, bounded batch
   and payload size, protected-content denial, rate limiting, minimized payload,
   and no durable content logging are unchanged from
   `0001-mvp-translation-data-security-boundary.md`. Provider failures surface
   as status codes with no page content echoed into error messages.

## Alternatives Considered

- **Broad `<all_urls>` host permission.** Simpler, but it grants standing access
  to every page the user visits to answer a question that needs one site at a
  time.
- **Pseudo-translation instead of a real provider.** Cheaper and fully offline,
  and it would expose length-driven layout breakage. Rejected as the primary
  path because it cannot show translation quality, which is half of the
  question being asked. It remains available as a future addition.
- **Waiting for the real-corpus approval packet.** Rejected: that gate exists to
  govern committing someone else's page content into the repository, and
  applying it to live browsing would block the work for a risk that browsing
  does not create.

## Consequences

- A developer can now observe real translation and real layout behaviour on a
  site they choose, following `docs/runbooks/translate-a-live-site.md`.
- Real page content leaves the machine when provider mode is enabled. That is
  the operator's explicit choice per session, bounded by the origin allowlist
  and the protected-content denial rules.
- Observations from this loop are manual evidence. They do not produce a
  geometry gate, do not close the technical-spike exit gate, and must not be
  reported as calibration results.
- Model quality, latency, and cost remain unmeasured; the benchmark contract in
  `0003-translation-model-benchmark-contract.md` is still the authority for
  selecting a model.

## Follow-Up

- Record real-site observations as manual findings in the active plan, keeping
  them separate from measured fixture evidence.
- Revisit whether a pseudo-translation mode should be added for offline
  length-stress testing across many sites without provider cost.
- Production domain policy, caching, and audit retention remain open.
