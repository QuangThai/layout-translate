export type TargetLanguage = "en" | "vi";

// Keep extension request chunks within the backend contract's bounded batch.
export const MAX_TRANSLATION_BATCH_ITEMS = 50;

export type TranslationStatus =
  | "inactive"
  | "scanning"
  | "unsupported"
  | "translating"
  | "rendered"
  | "restored"
  | "error";

export interface ExtensionState {
  enabled: boolean;
  targetLanguage: TargetLanguage;
  status: TranslationStatus;
  translatedAnchors: number;
  /** Strings kept on this device because they matched the protected-content rule. */
  withheldAnchors: number;
  lastError?: string;
}

export const DEFAULT_EXTENSION_STATE: ExtensionState = {
  enabled: false,
  targetLanguage: "en",
  status: "inactive",
  translatedAnchors: 0,
  withheldAnchors: 0,
};

export type ComponentKind =
  | "navigation"
  | "button"
  | "tab"
  | "badge"
  | "table"
  | "form-label"
  | "heading"
  | "card"
  | "paragraph"
  | "unknown";

export type PreserveMode = "hard" | "medium" | "soft" | "critical";

export interface TranslationRequest {
  anchorId: string;
  source: string;
  component: ComponentKind;
  /**
   * Characters the compact variant may use before the source box overflows.
   * Sent only for regions that must keep their box, and omitted when the box is
   * wide enough that no shortening is needed.
   */
  compactMaxChars?: number;
}

export interface TranslationResult {
  anchorId: string;
  full: string;
  compact: string;
}

/**
 * The audit `SPEC.md` asks Phase 0 to produce, in counts only. It carries no
 * page text: what a reviewer needs here is how many anchors held their box, how
 * many fell back, and whether anything semantic-critical was shortened.
 */
export interface TranslationAudit {
  anchors: number;
  withheld: number;
  byComponent: Partial<Record<ComponentKind, number>>;
  /**
   * Geometry per component policy. Mixing them hides the answer: a paragraph is
   * meant to reflow, a navigation item is not, so one combined percentage says
   * nothing about whether the policy held.
   */
  byPolicy: Partial<Record<PreserveMode, {
    anchors: number;
    /** Position held, which includes being pushed down by content above. */
    withinTolerance: number;
    /** The anchor's own box held its size, which is what a hard policy promises. */
    boxHeld: number;
    maxShiftPx: number;
    maxSizeDeltaPx: number;
    overflows: number;
  }>>;
  tolerancePx: number;
  byFallback: { full: number; compact: number; ellipsisTooltip: number };
  /** Semantic-critical anchors whose displayed text is not the full translation. */
  criticalBreaks: number;
  /** Anchors whose own box overflows after translation. */
  overflows: number;
}

export const BACKEND_CONFIG_KEY = "layout-translate:backend";

export interface BackendConfig {
  url: string;
  token: string;
  /** Real providers are slower than the fixture dictionary; opt in per install. */
  timeoutMs?: number;
}

export type ContentCommand =
  | { type: "SYNC_STATE"; state: ExtensionState }
  | { type: "SET_ENABLED"; enabled: boolean }
  | { type: "SET_TARGET_LANGUAGE"; targetLanguage: TargetLanguage }
  /**
   * Locally reused translations belong to the backend that produced them, so a
   * configuration change drops them rather than serving results the current
   * backend never returned.
   */
  | { type: "INVALIDATE_TRANSLATIONS" }
  | { type: "RESTORE_ORIGINAL" };

export type RuntimeMessage =
  | { type: "GET_STATE" }
  | { type: "GET_AUDIT" }
  | { type: "SET_ENABLED"; enabled: boolean }
  | { type: "SET_TARGET_LANGUAGE"; targetLanguage: TargetLanguage }
  | { type: "RESTORE_ORIGINAL" }
  | { type: "CONTENT_READY" }
  | {
      type: "TRANSLATE_BATCH";
      targetLanguage: TargetLanguage;
      requests: TranslationRequest[];
    }
  | {
      type: "CONTENT_STATUS";
      status: TranslationStatus;
      translatedAnchors: number;
      withheldAnchors: number;
      /** Sent only once a frame has finished rendering, since it costs a layout pass. */
      audit?: TranslationAudit;
      error?: string;
    };

export type RuntimeResponse =
  | { type: "STATE"; state: ExtensionState; delivered?: boolean }
  | { type: "AUDIT"; audit: TranslationAudit }
  | { type: "ACK"; state: ExtensionState; delivered?: boolean }
  | { type: "TRANSLATION_RESULT"; translations: TranslationResult[] }
  | { type: "UNAVAILABLE"; state: ExtensionState; reason: string };

export type ContentMessage = { type: "CONTENT_COMMAND"; command: ContentCommand };
