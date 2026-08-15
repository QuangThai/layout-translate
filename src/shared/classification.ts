import type { ComponentKind, PreserveMode } from "./contracts";

export function classifyElement(element: Element): ComponentKind {
  const tagName = element.tagName.toLowerCase();

  if (element.closest("header, nav, [role='navigation']")) return "navigation";
  if (element.closest("table, thead, tbody, tr, th, td")) return "table";
  if (element.closest("button, [role='button']") || tagName === "button") return "button";
  if (element.closest("[role='tab'], [data-tab], .tab")) return "tab";
  if (element.matches("[data-badge], [class*='badge'], [class*='tag']")) return "badge";
  if (element.matches("label, [data-form-label]")) return "form-label";
  if (/^h[1-6]$/.test(tagName)) return "heading";
  if (element.closest("[data-card], article, .card")) return "card";
  if (tagName === "p" || element.closest("p, article")) return "paragraph";
  return "unknown";
}

export function preserveModeFor(kind: ComponentKind, element: Element): PreserveMode {
  if (element.matches("[data-semantic-critical='true']")) return "critical";
  if (["navigation", "button", "tab", "badge", "table"].includes(kind)) return "hard";
  if (["form-label", "heading", "card"].includes(kind)) return "medium";
  if (kind === "paragraph") return "soft";
  return "medium";
}

export function containsJapanese(value: string): boolean {
  return /[\u3040-\u30ff\u3400-\u9fff]/u.test(value);
}

/**
 * Honours the standard opt-out a page uses to mark content that must be copied
 * verbatim: the inherited HTML `translate` attribute and the `notranslate`
 * class. This keeps brand names, code, and identifiers out of translation
 * without the extension guessing which text is a proper noun.
 */
export function isTranslationOptedOut(element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    if (current.classList?.contains("notranslate")) return true;
    const declared = current.getAttribute("translate")?.trim().toLowerCase();
    // The nearest declaration wins, so a `yes` inside a `no` region opts back in.
    if (declared === "no") return true;
    if (declared === "yes") return false;
    current = current.parentElement;
  }
  return false;
}
