import type { TranslationStatus } from "./contracts";

export interface FrameReport {
  status: TranslationStatus;
  translatedAnchors: number;
  lastError?: string;
}

/**
 * Most urgent first. A tab is one thing to the reader, but each frame reports
 * for itself, so the popup shows the state that most needs attention rather
 * than whichever frame happened to report last.
 */
const STATUS_PRECEDENCE: readonly TranslationStatus[] = [
  "error",
  "translating",
  "scanning",
  "rendered",
  "restored",
  "unsupported",
  "inactive",
];

/**
 * Folds every frame of one tab into the single state the popup shows. Counts
 * add up, because the reader sees one page; a frame that is not Japanese does
 * not make the whole tab unsupported.
 */
export function aggregateFrameStates(frames: Iterable<FrameReport>): FrameReport {
  let status: TranslationStatus | undefined;
  let translatedAnchors = 0;
  let lastError: string | undefined;

  for (const frame of frames) {
    translatedAnchors += Number.isFinite(frame.translatedAnchors) ? frame.translatedAnchors : 0;
    if (!lastError && frame.lastError) lastError = frame.lastError;
    if (
      status === undefined
      || STATUS_PRECEDENCE.indexOf(frame.status) < STATUS_PRECEDENCE.indexOf(status)
    ) {
      status = frame.status;
    }
  }

  return {
    status: status ?? "inactive",
    translatedAnchors,
    ...(lastError === undefined ? {} : { lastError }),
  };
}
