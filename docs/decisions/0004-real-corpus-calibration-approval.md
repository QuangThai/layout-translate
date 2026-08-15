# 0004 Real-Corpus Calibration Approval Packet

Date: 2026-08-13

## Status

Proposed

## Context

The synthetic calibration corpus and replayable browser evidence are passing,
but the technical-spike exit gate requires calibration against a representative
company page. This packet requests the decisions and artifact needed before the
runner may consume a real corpus or produce real-corpus evidence.

A candidate snapshot derived from a public third-party home page was prepared
and then withdrawn. Automated marker checks passed, but the repository holds no
right to retain, replay, or redistribute another company's page content, so the
candidate could not become an approved corpus regardless of sanitization
quality. Source ownership is therefore a precondition, not a later review step:
an acceptable snapshot must come from a page the product owner owns or is
licensed to use. The checked-in corpus stays repository-generated synthetic and
remains `pending-review`.

This is an approval packet, not an accepted product policy. Blank fields and
unresolved alternatives must remain unresolved until the product owner signs
off.

The repository now has an offline `npm run real-corpus:preflight` command and a
separate `npm run real-corpus:calibration` runner. Both fail closed against the
current pending template; preflight does not start Chrome, and calibration
does not bypass product approval.

## Requested Decisions

| Decision | Choice to record | Current state |
| --- | --- | --- |
| Corpus owner and source | Named product owner, source kind/reference, and allowed use | Open; a third-party public page was evaluated and rejected for lack of retention/redistribution rights |
| Calibration purpose | Geometry-only evidence, or geometry plus human-reviewed EN/VI references | Both modes implemented; real-corpus choice remains open |
| Representative page | One sanitized page and the layout risks it represents | Open |
| Measurement targets | Named anchor/sibling selectors and which targets are desktop hard gates | Open for a real corpus; the synthetic sample only carries examples |
| Viewports | Exact desktop/mobile widths and heights plus page-overflow policy per viewport | Open |
| Desktop tolerance | Keep the provisional `<= 5px` spike target, or replace it with an approved target | Provisional `<= 5px` only |
| Mobile tolerance | Numeric gate, qualitative review, or measured-but-ungated | Open |
| Screenshot evidence | Optional artifact evidence, or required complete screenshot set | Open |
| Accessibility scope | Keyboard/focus, touch, screen-reader, and popover requirements | Open |
| Retention and redistribution | Who may access the snapshot, screenshots, fonts, and reports, and for how long | Open |

The existing visual/accessibility decision remains `Proposed`; no choice in
this table should be inferred from a configurable default.

## Artifact Contract

After approval, place the snapshot under `fixtures/real-corpus/` with:

- `page.html` and `styles.css` as the required entry files;
- only local assets/fonts needed for offline replay;
- no credentials, cookies, private data, tracking identifiers, external
  requests, or unnecessary executable behavior;
- `sanitization.contentClass` set to either `synthetic-only` or
  `public-sanitized`; a snapshot derived from any real page uses the latter and
  additionally requires a recorded right to keep and replay that content;
- a completed `manifest.json` containing the real snapshot ID, source,
  capture date, allowed use, viewports, calibration targets, file list,
  sanitization review, and product owner approval;
- `status: "approved"` only after the product owner and maintainer review the
  actual files;
- any baseline screenshots or fonts explicitly listed with their redistribution
  status.

The manifest must describe facts that were actually reviewed. Do not invent
provenance, approval, or `offlineReplay` claims.

The content-class discriminator is part of manifest schema v2. It prevents a
publicly derived sanitized snapshot from being mislabeled as synthetic-only
while keeping both classes subject to the same human review and approval gate.
Declaring `public-sanitized` does not by itself grant the right to keep the
content; that right is part of the corpus-owner decision above.

`calibration.targets` is a measurement contract, not a production tolerance:
each target names the anchor and sibling selectors the runner will measure and
whether the desktop spike gate applies. Real-corpus selectors must be reviewed
against the actual sanitized page before approval.

Each `viewports[]` entry also carries `pageOverflowPolicy: "hard"` or
`"measure-only"`. This prevents the runner from inventing a mobile overflow
gate while the product accessibility/touch policy is still being decided.

For translation mode, `calibration.translationCases` must name each selector,
source string, expected English string, and expected Vietnamese string. The
separate `calibration.translationReview` record must identify the human reviewer
and date. The runner uses those references only to drive an offline deterministic
mock-backend replay; it does not imply provider quality or product translation
approval.

## Implemented Runner Boundary (Approval-Gated)

The separate real-corpus calibration command is now implemented rather than
changing the synthetic runner's fixed fixtures. It:

1. fail closed when the manifest is not approved, required files are missing, or
   external requests are detected;
2. serve only the approved snapshot from an isolated local fixture server;
3. keep provider credentials and network translation calls out of the browser;
4. record the chosen manifest ID, viewport, provisional threshold, and
   non-content geometry evidence in its report; and
5. keep screenshot, accessibility, retention, and mobile policy explicit,
   without silently converting provisional spike evidence into a production SLA.

The real-corpus report and screenshots may still contain sanitized page layout
content. Their handling must follow the retention/redistribution decision above;
they are not interchangeable with the content-free synthetic trace reports.

## Validation Sequence After Approval

- Validate the manifest and offline replay before starting Chrome.
- Run the approved viewport matrix once for baseline evidence.
- Repeat the same command after any runner or fixture change; use repeated runs
  to distinguish screenshot flakiness from geometry findings.
- Review geometry, screenshots, accessibility observations, and cleanup as one
  evidence packet.
- Record the product decision separately before changing the visual contract or
  closing the technical-spike exit gate.

## Sign-Off

| Role | Name | Decision/date | Notes |
| --- | --- | --- | --- |
| Product owner |  |  |  |
| Sanitization reviewer |  |  |  |
| Maintainer |  |  |  |

## Follow-Up

- Supply a representative page the product owner owns or is licensed to use,
  then fill this packet from that actual approved snapshot. Do not substitute a
  third-party page; that route was already evaluated and rejected.
- Run and review the separate fail-closed real-corpus runner only after the
  artifact and policy fields above are complete; its implementation is present
  but the checked-in pending synthetic sample must remain blocked.
- The runner mechanics are already rehearsed end to end against a throwaway
  synthetic corpus outside the repository, so the remaining blocker is corpus
  authority and policy, not tooling.
- Keep provider benchmark/model selection blocked until its independent backend,
  provider, and human-review authority is accepted.
