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

- supported DOM text extraction;
- unsafe/non-translatable node exclusion;
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

The OpenAI credential is backend-only and must never be bundled into the
extension.

### OpenAI provider

Is an external provider boundary. The exact model, retention, caching, and
allowed data classes remain decision-required. No implementation may treat a
provider response as trusted without schema and source-ID validation.

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
  -> translating
  -> rendered
  -> translating       (new/changed DOM or route)
  -> active(target=EN|VI) (language switch from original source)
  -> restored           (original Japanese visible)
  -> inactive
```

Failures must preserve the original source value and surface an actionable
status instead of leaving a partially mutated value as the source of truth.

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
- Domain allowlist and data-class policy.
- Mandatory masking rules for sensitive text.
- Provider model and structured output schema version.
- Translation cache ownership and retention.
- Exact geometry tolerance and measurement timing.
- Browser targets beyond Chromium MV3.

