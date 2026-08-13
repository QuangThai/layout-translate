# Layout-Preserving Translation Extension

Status: Draft MVP contract derived from `SPEC.md`  
Authority: [`SPEC.md`](../../SPEC.md)  
Last reviewed: 2026-08-12

## Product purpose

Provide a Chromium browser extension that translates Japanese web
applications into English or Vietnamese in place while preserving the spatial
relationship between translated content and its original visual region.

The product optimizes for semantic understanding under visual constraints. It
does not promise zero-pixel layout change on every website.

## MVP user flow

1. The user opens a supported Japanese website.
2. The user selects `EN` or `VI` and turns translation on from the popup.
3. Visible supported DOM text is translated in place.
4. Full text is rendered when it fits the original region.
5. A compact semantic variant is attempted when the full text does not fit.
6. Constrained text with full-text tooltip/popover is used as the final UI
   fallback.
7. SPA routes, dialogs, lazy content, and supported dynamically inserted text
   continue translating while the feature remains active.
8. The user can switch output language or restore the original Japanese.

## Supported MVP content

- Header and navigation labels.
- Buttons, tabs, badges, and form labels.
- Headings and card/grid content.
- Table headers and cells.
- Paragraphs and ordinary visible DOM text.
- Dynamically inserted content and same-tab SPA route changes.

## Behavioral invariants

- Original source text and source metadata remain the source of truth.
- Source language must be confidently detected as Japanese before a translation
  batch is sent; ambiguous or non-Japanese pages remain unchanged.
- Language switching never translates from an already translated DOM value.
- Translation preserves the original visual anchor as closely as practical.
- Compact UI uses component-aware hard-preserve constraints.
- Long-form content uses soft-preserve constraints that prioritize readability.
- Critical meaning must not be silently shortened into ambiguity.
- Structural grid/flex layout is not rewritten by default.
- Extension-owned DOM writes are idempotent and must not create observer loops.
- OpenAI credentials are never shipped in the extension bundle.
- Full meaning remains accessible when in-place text is constrained.

## Official fallback order

```text
full translation
  -> compact semantic translation
    -> constrained text in the original region
      -> full translation through tooltip/popover
```

## MVP proof obligations

The technical spike must produce repeatable evidence for:

- stable header/navigation siblings;
- Vietnamese expansion without critical component breakage;
- constrained table cells;
- coherent card/grid geometry;
- idempotent handling of framework-style re-rendering;
- automatic translation after SPA route changes;
- fail-closed source-language detection with no batch for non-Japanese pages;
- deterministic full-to-compact-to-tooltip fallback;
- reproducible geometry metrics and screenshots.

## Explicit non-goals

- OCR, image text, canvas/WebGL text, and PDF translation.
- Inaccessible cross-origin iframe content.
- Automatic modification of application business logic.
- Universal perfect rendering or zero-pixel layout stability.
- Output languages beyond English and Vietnamese in the MVP.
- Ask Atlas until its product meaning is explicitly defined.
- A customer-facing general website translation CLI.

## Remaining decisions before implementation policy is frozen

The table below tracks the remaining policy gates and must not be filled by an
implementation default. The accepted MVP data/security boundary is recorded in
[`docs/decisions/0001-mvp-translation-data-security-boundary.md`](../decisions/0001-mvp-translation-data-security-boundary.md).

| Topic | Current status |
|---|---|
| Exact visual tolerance | Decision required; calibrate with representative fixtures |
| Constrained fallback accessibility | Proposed spike contract; validate assistive-tech, touch, click, and Escape behavior before acceptance |
| Allowed domains and data sent to the backend | Decided for MVP; explicit allowlist and minimized payload |
| PII/sensitive-data masking | Decided for MVP; mask or deny server-side, fail closed when uncertain |
| Persistent backend caching and retention | Decided for MVP; no durable source/translation content retention |
| Exact OpenAI model | Decision required; benchmark first |
| Browser targets beyond Chrome/Edge Chromium | Decision required; MVP is Chrome/Edge Chromium |
| Domain-level persistence | Optional later; no MVP policy beyond same tab/session |
| Ask Atlas behavior | Not in MVP; separate product definition required |
