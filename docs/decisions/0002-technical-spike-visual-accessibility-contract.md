# 0002 Technical-Spike Visual And Accessibility Contract

Date: 2026-08-12

## Status

Proposed

## Context

`SPEC.md` defines visual-anchor preservation without a zero-pixel guarantee and
gives a provisional hard-preserve target of approximately 3–5px. The spike
needs a repeatable measurement contract without silently freezing a production
tolerance before real company pages are calibrated. Constrained translations
also need a browser-observable accessibility contract that does not reflow the
host application.

## Decision

For the technical spike only:

- Use an upper-bound hard-preserve target of `<= 5px` for representative
  desktop anchor/sibling displacement.
- Treat zero critical overlap, no unexpected horizontal page overflow, no
  forbidden hard-region line increase, and full-text access when constrained as
  hard requirements.
- Measure after `document.fonts.ready` where font-sensitive layout is present,
  and record the threshold and observed shift in the non-content E2E report.
- Keep constrained content in the native tab order, retain the native `title`
  hover/focus affordance, and expose the full translated value through the
  element's accessible name without injecting a reflowing host-page layer.
- Keep this record `Proposed`; the exact production tolerance and a dedicated
  click/popover interaction still require real company-page and assistive-tech
  calibration.

## Alternatives Considered

1. Freeze a strict `3px` production tolerance now; rejected because the source
   specification calls for calibration against real pages first.
2. Use no numeric target and rely on screenshots; rejected because screenshots
   alone do not provide a reproducible displacement gate.
3. Inject a global tooltip/popover layer immediately; deferred because its
   focus, touch, stacking, and host-page interaction contract needs real
   component evidence.

## Consequences

Positive:

- The spike has an explicit, conservative, machine-checkable visual target.
- Screen-reader users receive the full constrained translation without changing
  the host page's layout structure.
- The report distinguishes provisional evidence from an accepted product SLA.

Tradeoffs:

- A 5px pass is not a production guarantee and may be tightened after
  calibration.
- Native `title` behavior is limited on touch devices; a dedicated popover is
  still a follow-up requirement. The calibration screenshot runner also treats
  screenshot capture as optional artifact proof: geometry gates remain
  independent, and capture timeouts are recorded rather than hiding cleanup or
  failing to report the measured case. Each capture now has at most two bounded
  retries with a short backoff and clears its owned output before retrying.

## Follow-Up

- Exercise React/Vue rerenders and real Vietnamese/Japanese webfonts in the
  browser proof.
- Calibrate anchor/sibling tolerance on representative company pages.
- For the immediate validation pass, use a product-approved sanitized
  HTML/CSS/font snapshot and validate keyboard, focus, click, Escape, and touch
  behavior through browser-observable proof. The local fixture now passes these
  interactions; screen-reader validation remains deferred until an approved
  assistive-technology environment is available.
- Screenshot stability follow-up: three sequential official
  `npm run calibration:smoke` runs passed all 6 cases with
  `artifactStatus: "complete"` and every cleanup flag true. One run needed the
  third capture attempt for a Vietnamese screenshot, confirming the retry path
  was exercised without changing the geometry gate.
- Validate keyboard, screen-reader, touch, click, and Escape behavior before
  changing this record to `Accepted`.
