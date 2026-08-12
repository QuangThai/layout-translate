export type TargetLanguage = "en" | "vi";

export type TranslationStatus =
  | "inactive"
  | "scanning"
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
}

export interface TranslationResult {
  anchorId: string;
  full: string;
  compact: string;
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
      type: "CONTENT_STATUS";
      status: TranslationStatus;
      translatedAnchors: number;
      error?: string;
    };

export type RuntimeResponse =
  | { type: "STATE"; state: ExtensionState; delivered?: boolean }
  | { type: "ACK"; state: ExtensionState; delivered?: boolean }
  | { type: "UNAVAILABLE"; state: ExtensionState; reason: string };

export type ContentMessage = { type: "CONTENT_COMMAND"; command: ContentCommand };
