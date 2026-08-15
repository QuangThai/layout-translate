import type { PreserveMode } from "./contracts";

/**
 * Below this many characters a compact label stops carrying meaning. Japanese
 * is dense, so a control sized to its Japanese text can be narrower than any
 * honest English or Vietnamese label. Demanding that width produced wrong
 * translations, so a budget this tight is not sent at all and the documented
 * compact-then-ellipsis fallback handles the fit instead.
 */
export const MIN_COMPACT_BUDGET = 8;
/** Above this, the box is wide enough that a budget adds nothing. */
export const MAX_COMPACT_BUDGET = 120;

/**
 * Converts an available width into a character budget the provider can respect.
 * A model cannot reason about pixels, but it can count characters, so fitting
 * is expressed in the only unit both sides understand.
 */
export function estimateCharacterBudget(
  availableWidth: number,
  averageCharacterWidth: number,
): number | null {
  if (!Number.isFinite(availableWidth) || !Number.isFinite(averageCharacterWidth)) return null;
  if (availableWidth <= 0 || averageCharacterWidth <= 0) return null;
  const budget = Math.floor(availableWidth / averageCharacterWidth);
  if (budget < MIN_COMPACT_BUDGET || budget > MAX_COMPACT_BUDGET) return null;
  return budget;
}

/**
 * Only regions that must keep their box need a budget. Constraining paragraphs
 * would trade readability for a fit the layout does not require.
 */
export function needsCompactBudget(mode: PreserveMode): boolean {
  return mode === "hard" || mode === "critical";
}

/**
 * One translation is reused everywhere the same string appears, so it has to
 * fit the tightest box among them. An unbudgeted member imposes no limit.
 */
export function narrowestBudget(budgets: ReadonlyArray<number | undefined>): number | undefined {
  let narrowest: number | undefined;
  for (const budget of budgets) {
    if (budget === undefined) continue;
    if (narrowest === undefined || budget < narrowest) narrowest = budget;
  }
  return narrowest;
}

const averageWidthSample = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ ";

let sharedContext: CanvasRenderingContext2D | null | undefined;

function measurementContext(document: Document): CanvasRenderingContext2D | null {
  if (sharedContext !== undefined) return sharedContext;
  sharedContext = document.createElement("canvas").getContext("2d");
  return sharedContext;
}

function fontShorthand(style: CSSStyleDeclaration): string | null {
  if (style.font) return style.font;
  const size = style.fontSize;
  const family = style.fontFamily;
  if (!size || !family) return null;
  return `${style.fontStyle || "normal"} ${style.fontWeight || "400"} ${size} ${family}`;
}

/**
 * Measures the average advance width of Latin text in the element's own font,
 * so the budget reflects how the translation will actually render there.
 */
export function measureAverageCharacterWidth(element: HTMLElement): number | null {
  const context = measurementContext(element.ownerDocument);
  if (!context) return null;
  const font = fontShorthand(window.getComputedStyle(element));
  if (!font) return null;
  context.font = font;
  const width = context.measureText(averageWidthSample).width;
  if (!Number.isFinite(width) || width <= 0) return null;
  return width / averageWidthSample.length;
}

/** Horizontal space the text can occupy inside the element's own padding. */
export function availableTextWidth(element: HTMLElement): number {
  const style = window.getComputedStyle(element);
  const padding = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
  const width = element.clientWidth || element.getBoundingClientRect().width;
  return width - padding;
}
