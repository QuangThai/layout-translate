/**
 * Strings that must not reach an external translation provider, per
 * `docs/decisions/0001-mvp-translation-data-security-boundary.md`.
 *
 * One definition, used in two places on purpose. The content script checks it
 * so a matching string never leaves the browser at all, and the backend checks
 * it again so anything that reaches the boundary by another route is still
 * refused.
 */
const protectedSourcePattern =
  /(password|passcode|one[- ]time code|otp|secret|token|api[- ]?key|credit card|card number|cvv|ssn|social security|パスワード|暗証番号|クレジットカード|カード番号|秘密|トークン|APIキー)/iu;

export function isProtectedSource(value: string): boolean {
  return protectedSourcePattern.test(value);
}
