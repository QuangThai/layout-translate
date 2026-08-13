export type SourceLanguage = "ja" | "non-ja" | "unknown";

const JAPANESE_RATIO_THRESHOLD = 0.2;
const MIN_SCRIPT_SIGNAL = 2;

function isKana(value: string): boolean {
  return /[\u3040-\u30ff\uff66-\uff9f]/u.test(value);
}

function isCjk(value: string): boolean {
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(value);
}

function isLetterOrNumber(value: string): boolean {
  return /[\p{L}\p{N}]/u.test(value);
}

function isLetter(value: string): boolean {
  return /\p{L}/u.test(value);
}

interface ScriptCounts {
  japanese: number;
  kana: number;
  other: number;
  significant: number;
}

function countScripts(value: string): ScriptCounts {
  const counts: ScriptCounts = { japanese: 0, kana: 0, other: 0, significant: 0 };

  for (const character of value.normalize("NFKC")) {
    if (!isLetterOrNumber(character)) continue;
    counts.significant += 1;
    if (isKana(character) || isCjk(character)) {
      counts.japanese += 1;
      if (isKana(character)) counts.kana += 1;
    } else if (isLetter(character)) {
      counts.other += 1;
    }
  }

  return counts;
}

function isJapaneseHint(languageHint: string | undefined): boolean {
  return /^ja(?:-|$)/iu.test(languageHint?.trim() ?? "");
}

/**
 * Detect whether a text sample has enough evidence to treat its source as
 * Japanese. Ambiguous CJK-only or very short samples stay unknown unless the
 * document explicitly identifies itself as Japanese.
 */
export function detectSourceLanguage(value: string, languageHint?: string): SourceLanguage {
  const counts = countScripts(value);
  if (counts.significant === 0) return "unknown";

  if (isJapaneseHint(languageHint) && counts.japanese >= MIN_SCRIPT_SIGNAL) return "ja";

  const japaneseRatio = counts.japanese / counts.significant;
  if (
    counts.japanese >= MIN_SCRIPT_SIGNAL
    && counts.kana > 0
    && japaneseRatio >= JAPANESE_RATIO_THRESHOLD
  ) {
    return "ja";
  }

  if (counts.japanese === 0 && counts.other >= MIN_SCRIPT_SIGNAL) return "non-ja";
  if (counts.japanese > 0) return "unknown";
  return "unknown";
}
