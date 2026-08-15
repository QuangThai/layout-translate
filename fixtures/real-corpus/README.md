# Real-corpus snapshot template

This directory is reserved for a **product-approved, sanitized snapshot** of
one representative company page. It currently contains a candidate snapshot
derived from the public `nativeai.io` home page. The candidate keeps the
observed section/layout structure and selected Japanese copy, but removes
tracking, external assets, configuration, addresses, personal/customer names,
and form actions so it can replay offline. It remains `pending-review`; the
directory is not a runnable real corpus until the product owner and maintainer
approve the actual files.

## Expected layout

```text
fixtures/real-corpus/
├── manifest.json
├── page.html
├── styles.css
└── assets/
```

`page.html` and `styles.css` are required for calibration. The manifest uses
`layout-translate/real-corpus-manifest/v2` and records `sanitization.contentClass`
as either `synthetic-only` or `public-sanitized`; the latter is the class used by
the current NativeAI-derived candidate. The manifest also declares
`calibration.targets`, each with an anchor selector, sibling selector,
and explicit desktop hard-gate flag. Each viewport also records whether
horizontal page overflow is a hard gate or measurement-only; mobile policy
must not be inferred by the runner. Translation calibration additionally
requires `calibration.translationCases` (selector plus expected source/EN/VI
strings) and a separate human-review record in
`calibration.translationReview`. These strings are test references, not a
provider response or a production translation policy. The current candidate
uses only local HTML/CSS and sanitized Japanese labels; it contains no external
requests, scripts, credentials, or private data. `assets/` may contain only the
static assets needed to reproduce the captured layout. Webfonts and baseline
screenshots are optional and must be explicitly listed in the manifest.

## Sanitization checklist

Before committing a snapshot, confirm every item in `manifest.json`:

- [ ] No credentials, tokens, cookies, authorization headers, or secrets.
- [ ] No real personal data, customer data, payment data, or private messages.
- [ ] URLs, identifiers, analytics payloads, and tracking values are removed or
      replaced with stable placeholders.
- [ ] Forms, editable values, hidden fields, and protected content are removed
      or replaced with synthetic values.
- [ ] External requests are removed or vendored as local assets; the page is
      replayable offline from this directory.
- [ ] HTML/CSS/assets contain no executable behavior that is not required to
      reproduce layout. Do not include application credentials or service
      workers.
- [ ] Fonts and screenshots, if included, have an approved redistribution
      status and contain no page data outside the sanitized snapshot.
- [ ] The snapshot source, capture date, viewport, and allowed use are recorded
      in `manifest.json`.

## Approval gate

A maintainer must review the content and set:

```json
"status": "approved"
```

Only then should a calibration runner consume this directory. Until approval,
this template is documentation scaffolding and must not be used as evidence for
production tolerance or the technical-spike exit gate.

Run `npm run real-corpus:preflight -- --mode=baseline` after filling the
geometry contract, or `npm run real-corpus:preflight -- --mode=both` when the
translation references have also been reviewed. The command is offline and
fail-closed: it checks approval, required files, viewport facts, offline replay,
translation-review facts, and common external-request/credential markers
without starting Chrome. A passing preflight does not replace product review
or calibration evidence. Once approved, run
`npm run real-corpus:calibration -- --mode=baseline|translation|both` to produce
the browser evidence report.

## Required manifest facts

`manifest.json` must describe facts that were actually reviewed. Do not invent
provenance or approval. The current candidate records the public source and
capture date, but its human sanitization review, product-owner,
translation-review, and maintainer approval fields are intentionally empty.
Complete those fields from the actual review before running calibration.
