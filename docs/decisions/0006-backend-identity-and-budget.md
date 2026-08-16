# 0006 Backend Identity And Budget

Date: 2026-08-16

## Status

Accepted for the internal deployment described below. It does not cover a
public release, which would need accounts, billing, and abuse handling that this
record deliberately leaves out.

## Context

The backend held the provider credential behind a single shared bearer token.
That token cannot answer the questions an operated service has to answer:

- Who translated this? Everyone holding the token is the same caller.
- Who spent the budget? One person can exhaust the company's provider quota
  before anyone notices, and nothing attributes it.
- How is one person removed? Rotating the token removes everybody.

`docs/decisions/0001-mvp-translation-data-security-boundary.md` already made
real provider integration conditional on these controls existing.

The product owner chose, on 2026-08-16: company-internal users, container
deployment, and one shared company provider quota.

## Decision

1. **Identity is verified, not asserted.** In `identity` mode the backend
   verifies an OIDC ID token against the issuer's published keys: RS256 only,
   matching issuer and audience, unexpired within a configured clock skew, and
   an email in a configured company domain. A header the client controls is not
   evidence, so nothing is trusted without a signature check.
2. **The mode is explicit.** `LAYOUT_TRANSLATE_AUTH_MODE` selects
   `shared-token` or `identity`. Development keeps the shared token; running
   that way in production has to be something a person typed.
3. **The budget is per identity and per day.** Usage is charged to the verified
   email, not to a network address, because several people behind one office
   address are not one caller and one person on two networks is not two. The
   check happens before a provider call, since a refused request costs nothing.
4. **Cost is measured from provider usage.** The provider reports token counts,
   which are counts rather than content, and those counts drive both the quota
   and any cost estimate.
5. **The audit line names the account and the size, never the text.** A
   translation response logs its request id, status, item count, and account.
   That is what a quota dispute or an abuse investigation needs, and no part of
   the page is in it.
6. **A container can operate it.** The bind address is configurable and defaults
   to loopback, `/healthz` reports readiness with the active mode, and `SIGTERM`
   finishes the requests in flight instead of dropping provider calls that have
   already been paid for.

## Alternatives Considered

- **Keep the shared token and add a per-token quota.** Rejected: it measures a
  token rather than a person, so it cannot attribute spend or remove one user.
- **Trust an identity header set by a gateway.** Rejected for this stage: it
  moves the whole security boundary into the deployment's network configuration,
  where a misrouted request silently becomes an authenticated one.
- **Give each user their own provider key.** Rejected by the cost decision, and
  it would put a credential in reach of the extension.

## Consequences

- The extension must obtain an ID token from the company identity provider and
  send it. That work is not in this record; until it lands, the extension runs
  against a development backend in shared-token mode.
- The quota lives in the process, so it holds for a single instance. Running
  more than one instance needs shared storage, and that is a real limitation
  rather than a detail: the container decision assumed one instance.
- A person who reaches the daily limit is refused with a rate-limit code and
  keeps the untranslated page, which is the existing fail-closed behaviour.

## Follow-Up

- Wire the extension to the identity provider and record the client
  registration that requires.
- Move the quota ledger to shared storage before running more than one instance.
- Decide retention for the audit log, which is not covered here.
