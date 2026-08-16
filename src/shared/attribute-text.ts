import { containsJapanese } from "./classification";

/**
 * Attributes whose value a reader actually sees. A form whose labels are
 * translated but whose placeholders still read 山田 太郎 is only half usable, and
 * `alt` text is the only version of an image a screen reader ever gets.
 */
export const TRANSLATABLE_ATTRIBUTES = ["placeholder", "alt", "title", "aria-label"] as const;

export type TranslatableAttribute = typeof TRANSLATABLE_ATTRIBUTES[number];

export const TRANSLATABLE_ATTRIBUTE_SELECTOR = TRANSLATABLE_ATTRIBUTES
  .map((attribute) => `[${attribute}]`)
  .join(",");

/**
 * Attribute values double as machine data far more often than text nodes do, so
 * anything that looks like an identifier rather than a sentence is left alone.
 */
export function isTranslatableAttributeValue(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed || !containsJapanese(trimmed)) return false;
  if (trimmed.length > 2_000) return false;
  // A value the page also uses as a URL, template placeholder, or token would be
  // broken by translation even though it contains Japanese.
  if (/^(?:https?:|mailto:|tel:|data:|\/|#|\{\{|\$\{)/u.test(trimmed)) return false;
  return true;
}
