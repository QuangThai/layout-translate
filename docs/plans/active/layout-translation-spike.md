# Execution Plan: Layout-Preserving Translation Technical Spike

Date: 2026-08-12

## Status

Active

## Outcome

Produce a runnable, repeatable technical spike that demonstrates Japanese to
English/Vietnamese in-place translation with visual-anchor preservation for the
MVP component set, while keeping unresolved product and security policy
choices explicit.

## Context

- Product authority: [`SPEC.md`](../../../SPEC.md).
- Derived MVP contract: [`docs/product/overview.md`](../../product/overview.md).
- Repository workflow: [`docs/WORKFLOW.md`](../../WORKFLOW.md).
- The repository now contains the fixture-first extension scaffold, focused
  tests, mock backend boundary, and a replayable browser smoke command.

## Scope

In scope:

- Establish product and architecture authority derived from `SPEC.md`.
- Resolve or explicitly escalate visual, security, model, and browser decisions.
- Scaffold WXT, TypeScript, Manifest V3, popup, content script, and service
  worker boundaries.
- Build representative layout fixtures and executable geometry proof.
- Implement the smallest translation/rendering path that exercises the
  documented fallback order.
- Add backend boundary and OpenAI integration behind server-side credentials.
- Validate dynamic DOM, SPA navigation, restore, and language switching.

Out of scope:

- OCR, canvas/WebGL, PDF, or inaccessible iframe translation.
- Ask Atlas.
- Universal site support or zero-pixel layout guarantees.
- Domain-specific policy before the required human decisions are accepted.

## Approach

1. Convert the stable portions of `SPEC.md` into product and architecture
   documents without inventing open policy.
2. Record accepted decisions for tolerance, data handling, model, and browser
   scope; stop at any unresolved materially different choice.
3. Scaffold the extension and backend boundaries.
4. Create representative fixtures for navigation, controls, tables, cards,
   paragraphs, framework re-rendering, and SPA routes.
5. Implement source registry, extraction/classification, batch boundary,
   rendering policy, measurement, and observer recovery incrementally.
6. Add focused tests and browser-level evidence for the MVP proof obligations.
7. Run security and proof-debt review before calling the spike validated.

## Risks And Recovery

- Do not send internal or sensitive page content to an external model until the
  data policy is explicitly approved.
- Keep original source text authoritative so a failed translation or language
  switch can restore deterministically.
- Keep extension-owned mutations identifiable and idempotent to avoid observer
  loops and framework overwrite races.
- If a visual policy cannot be validated against fixtures, leave it open rather
  than claiming layout stability.

## Progress

- [x] Read `AGENTS.md`, `SPEC.md`, and repository workflow.
- [x] Map current repository and confirm application code is absent.
- [x] Inventory installed skills and available development tools.
- [x] Create the derived MVP product contract.
- [x] Establish architecture boundary document.
- [ ] Resolve decision-required product and security policy.
- [x] Scaffold fixture-only extension and mock backend boundary.
- [x] Add representative fixtures and deterministic mock-adapter proof.
- [x] Add browser-level geometry, tooltip, dynamic DOM, and SPA proof.
- [x] Make the browser proof replayable with `npm run e2e:smoke`.
- [ ] Validate the technical-spike exit gate.

## Decisions

- 2026-08-12: Treat `SPEC.md` as the only current product authority and mark
  its open questions as decision-required rather than choosing implementation
  defaults.
- 2026-08-12: Keep the first implementation phase documentation-only so no
  application behavior is implied before the architecture and policy boundary
  are explicit.
- 2026-08-12: Limit extension host permissions to localhost fixture pages for
  the spike; this is a test boundary, not a product domain allowlist.

## Validation

- Focused proof: `npm test` passed; 1 test file and 2 tests passed.
- Type proof: `npm run typecheck` passed after WXT generated its types.
- Build proof: `npm run build` passed and produced the Chrome MV3 bundle with
  background, popup, and translate content-script outputs.
- Browser E2E: fixture served on `127.0.0.1:4173` and exercised in Chromium
  with the built extension. EN and VI text rendering, popup ON/OFF routing,
  EN-to-VI switching, and page restoration were observed. No page errors or
  console errors were reported.
- Browser E2E failures: the navigation group changed from `270px` to
  `193.4px` in EN and `335.6px` in VI; the first navigation anchor shifted by
  about `76.6px` and `65.6px`, respectively. The dynamic SPA replacement
  `利用規約 -> 新しい通知` was incorrectly treated as the old source and
  rendered/restored as `利用規約`.
- Repository-required checks: no additional repository CI gate exists yet.
- Replayable smoke: `npm run e2e:smoke` passed with Chrome for Testing. It
  measured `navWidth=270` in EN and VI, rendered constrained tooltip titles,
  translated the SPA replacement, and restored the current Japanese source.
- Latest browser rerun: after the engine fix, EN and VI both kept the
  navigation group at `270px` with the first anchor at `x=692.4px`; constrained
  strings exposed tooltip titles; a fresh-load SPA transition translated the
  current dynamic source in both languages; restore returned the current
  Japanese source; and no page errors or console errors were reported.
- Character-data regression proof: changing the existing dynamic text node in
  place with `node.data = "新しい通知"` translated it to `New notification`,
  and restore returned that current source to Japanese.

## Result

Active. The fixture-only extension and mock-backend scaffold passes typecheck,
unit tests, and production build. Browser E2E now proves basic EN/VI rendering,
hard-region preservation, constrained fallback, dynamic source replacement,
in-place character-data recovery, restore semantics, and controls. Real backend integration and the
decision-required product/security policies remain pending.
