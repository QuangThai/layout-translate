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
  lastError?: string;
}

export const DEFAULT_EXTENSION_STATE: ExtensionState = {
  enabled: false,
  targetLanguage: "en",
  status: "inactive",
  translatedAnchors: 0,
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
  | { type: "RESTORE_ORIGINAL" };

export type RuntimeMessage =
  | { type: "GET_STATE" }
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
      error?: string;
    };

export type RuntimeResponse =
  | { type: "STATE"; state: ExtensionState; delivered?: boolean }
  | { type: "ACK"; state: ExtensionState; delivered?: boolean }
  | { type: "TRANSLATION_RESULT"; translations: TranslationResult[] }
  | { type: "UNAVAILABLE"; state: ExtensionState; reason: string };

export type ContentMessage = { type: "CONTENT_COMMAND"; command: ContentCommand };
