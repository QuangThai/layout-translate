# Documentation Map

Start with the smallest authoritative surface.

## Current Product

- `WORKFLOW.md`: request shape, planning, judgment, operation, validation, and
  completion.
- `architecture.md`: current extension component, data-flow, state, and
  ownership boundaries.
- `product/`: current product behavior and installation contract.
- `decisions/`: lasting choices future work must inherit.
- `plans/`: one durable working-memory document for work that needs it.
- `runbooks/`: verified operating procedures for running the application.
- `templates/`: optional decision, plan, runbook, and Harness-improvement
  structures.

## Consumer-Owned Truth

The consumer's README, product documents, architecture, code, tests, CI,
runtime signals, and application behavior remain authoritative. Harness does
not overwrite those with upstream product assumptions.

## Source Repository

- Root `README.md`: current scope, development, checks, and mock-backend usage.
- `SPEC.md`: product authority and unresolved decisions.
- `src/`, `entrypoints/`, and `backend/`: extension and mock-backend code.
- `fixtures/`: representative browser fixture and styles.
- `tests/` and `scripts/e2e-smoke.mjs`: focused and browser-level proof.

Harness instructions and installed-core metadata live in `AGENTS.md` and
`.harness-core/`; they do not define consumer product behavior.
