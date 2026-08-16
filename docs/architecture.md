# Layout-Preserving Translation Extension Architecture

Status: Draft technical boundary derived from `SPEC.md`  
Authority: [`SPEC.md`](../SPEC.md)  
Last reviewed: 2026-08-12

This document records component ownership and trust boundaries for the
technical spike. It does not freeze unresolved security, model, tolerance, or
browser policy.

## Component boundaries

### Popup UI

Owns the small user-facing controls:

- translation on/off;
- output language selection (`EN` or `VI`);
- restore-original action;
- status and error display.

The popup does not translate page DOM directly. It sends validated commands to
the extension runtime and reads durable extension state.

### Content script translation engine

Owns page-facing behavior:

- supported DOM text extraction across the document and every open shadow root,
  since a tree walker and a mutation observer both stop at a shadow boundary and
  a closed root cannot be reached at all;
- visible attribute text (`placeholder`, `alt`, `title`, `aria-label`), which a
  text-node walk cannot see and which leaves a form half translated when
  skipped;
- unsafe/non-translatable node exclusion, including the standard `translate="no"`
  opt-out and attribute values the page uses as machine data;
- withholding strings that match the protected-content rule, so they never leave
  the browser and one of them does not cost the reader the rest of the page; the
  backend applies the same rule as defence in depth;
- stable anchor IDs and original-source registry;
- component classification;
- geometry/layout snapshots and fit checks;
- batched translation requests;
- rendering and full-to-compact-to-constrained fallback;
- tooltip/popover access to constrained full text;
- MutationObserver and SPA route-change recovery.

The content script must treat page content and page messages as untrusted input.
It must not rewrite the site's structural layout by default.

### Background service worker

Owns extension runtime coordination:

- popup/content-script messaging;
- folding the per-frame reports of one tab into the single state the popup
  shows, since each frame runs its own engine and knows only about itself;
- attributing a translation request to the frame's own origin rather than the
  tab's, so a cross-origin frame cannot inherit a top-level grant;
- durable extension settings and session state;
- backend authentication/session integration;
- privileged extension operations where required.

State needed after service-worker suspension belongs in extension storage or a
backend-owned session, not only in process memory.

### Translation backend

Owns server-side translation boundaries:

- request authentication;
- payload validation and sanitization;
- optional sensitive-data masking once approved;
- project glossary and policy application;
- batching, cache behavior, and rate/cost controls once approved;
- OpenAI provider calls;
- structured-response validation;
- response correlation back to source anchor IDs.

The current boundary implements the request-side version of these
controls in [`backend/src/contract.ts`](../backend/src/contract.ts) and
`backend/src/mock-server.ts`: explicit page-origin allowlisting, bearer
authentication, bounded payloads, fail-closed protected-content checks,
rate limiting, and provider-result correlation. It is still a development
server and is not production authentication or PII classification.

The translation source behind that boundary is selectable. The default is the
offline dictionary; `LAYOUT_TRANSLATE_PROVIDER=openai` swaps in the real
provider in [`backend/src/openai-provider.ts`](../backend/src/openai-provider.ts)
for developer verification. Selection is fail-closed: provider mode requires an
explicit model ID and refuses to start otherwise, and it never falls back to
mock output. Provider results pass through the same
`validateTranslationResults` correlation check as mock results, and fixture
overrides are disabled while a real provider is active.

The OpenAI credential is backend-only and must never be bundled into the
extension.

### OpenAI provider

Is an external provider boundary. The exact model, retention, caching, and
allowed data classes remain decision-required. No implementation may treat a
provider response as trusted without schema and source-ID validation.

Provider errors are translated into contract codes (`provider_unavailable`,
`provider_rate_limited`, `provider_refused`, `provider_invalid_response`)
without echoing provider error text, because that text can contain the
submitted page content.

### Site access

Declared host permissions cover the fixture hosts only. Any other origin is
requested at popup click time through `optional_host_permissions`, one exact
origin per grant, and the popup then injects the content script into that tab.
The content script guards against double injection so a repeated grant cannot
start a second engine over the same DOM. Grants are revocable from the popup.

## Data flow

```text
Popup
  -> service worker command/state boundary
    -> content script state machine
      -> source registry + layout snapshot
        -> authenticated backend request
          -> validated structured translation response
            -> content-script rendering/measurement
              -> original page DOM remains interactive
```

The source registry is authoritative for language switching and restoration.
The translated DOM is a rendering projection, not a new translation source.

## Translation state model

The initial state model should make these transitions explicit:

```text
inactive
  -> active(source=detected, target=EN|VI)
  -> unsupported (source is not confidently Japanese)
  -> translating
  -> rendered
  -> translating       (new/changed DOM or route)
  -> active(target=EN|VI) (language switch from original source)
  -> restored           (original Japanese visible)
  -> inactive
```

Failures must preserve the original source value and surface an actionable
status instead of leaving a partially mutated value as the source of truth.
An ambiguous or non-Japanese page must remain unchanged and must not produce a
translation batch.

## Rendering policy boundary

Component policy is selected from the source element and project overrides,
not inferred from translated character count alone:

| Class | Default constraint |
|---|---|
| Navigation, button, tab, badge, table | Hard preserve; prefer compact language before layout change |
| Form label, heading, card description | Medium preserve; allow limited controlled change |
| Paragraph/article body | Soft preserve; prioritize readable meaning |
| Warning, legal, security, financial, destructive action | Semantic-critical; no ambiguous silent shortening |

The engine may use temporary measurement styles, ellipsis, line clamp, and an
isolated tooltip/popover. It should not change parent grid/flex structure,
global spacing, or apply horizontal scaling as a primary fit strategy.

## Dynamic DOM boundary

The observer must distinguish page-owned writes from extension-owned writes,
deduplicate anchors, and reapply translations idempotently after framework
re-renders. Route changes and lazy content are normal inputs to the same state
machine, not separate activation flows.

Translations are reused locally within a target language so a page that rewrites
its own text does not buy the same string repeatedly. The reuse is bounded, and
it is dropped when the reader restores the original or when the backend
configuration changes, so a reused value is always one the configured backend
produced in the current session. A result whose pass was superseded by page
mutation is still kept: it was already paid for, and only rendering has to
respect what is current.

## Proof boundary

The technical spike must prove behavior through representative fixtures and
browser-observable evidence. Static structure alone cannot prove layout
stability, visual-anchor preservation, tooltip accessibility, or framework
recovery.

Required proof surfaces are listed in
[`docs/product/overview.md`](product/overview.md) and tracked in the active
plan.

## Unresolved architecture-adjacent choices

- Backend authentication/session contract.
- Provider model and structured output schema version.
- Translation cache ownership and any retention expansion beyond the accepted
  no-durable-content MVP boundary.
- Exact geometry tolerance and measurement timing.
- Browser targets beyond Chromium MV3.
