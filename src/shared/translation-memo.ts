import type { ComponentKind, TargetLanguage, TranslationResult } from "./contracts";

/**
 * Pages rewrite their own text constantly: status tickers, recycled list rows,
 * carousels. Those rewrites usually cycle through a handful of strings, and
 * without a memo every cycle buys the same translation again from the provider.
 */
export const TRANSLATION_MEMO_LIMIT = 500;

export interface MemoizableRequest {
  source: string;
  component: ComponentKind;
  /**
   * Part of the key because the same words shortened for a narrow control are
   * not interchangeable with the same words in a wide one.
   */
  compactMaxChars?: number;
}

export function translationMemoKey(request: MemoizableRequest): string {
  return `${request.component}${request.compactMaxChars ?? ""}${request.source}`;
}

export class TranslationMemo {
  private entries = new Map<string, { full: string; compact: string }>();
  private language?: TargetLanguage;

  constructor(private readonly limit = TRANSLATION_MEMO_LIMIT) {}

  /** Drops everything when the target language changes; entries are per language. */
  useLanguage(language: TargetLanguage): void {
    if (this.language === language) return;
    this.language = language;
    this.entries.clear();
  }

  get(request: MemoizableRequest): { full: string; compact: string } | undefined {
    return this.entries.get(translationMemoKey(request));
  }

  remember(request: MemoizableRequest, result: TranslationResult): void {
    const key = translationMemoKey(request);
    // Re-inserting moves the entry to the end, so eviction follows least
    // recently written rather than first ever seen.
    this.entries.delete(key);
    this.entries.set(key, { full: result.full, compact: result.compact });
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
