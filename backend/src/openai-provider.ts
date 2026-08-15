import type { TargetLanguage, TranslationResult } from "../../src/shared/contracts";
import { ContractError, MAX_TRANSLATION_LENGTH, type BackendTranslationItem } from "./contract";

export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_PROVIDER_TIMEOUT_MS = 30_000;

export interface OpenAIProviderConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
}

export interface TranslationProvider {
  readonly name: string;
  readonly model: string;
  translateBatch(
    items: readonly BackendTranslationItem[],
    targetLanguage: TargetLanguage,
  ): Promise<TranslationResult[]>;
}

const languageNames: Record<TargetLanguage, string> = {
  en: "English",
  vi: "Vietnamese",
};

// The provider never receives page URLs, selectors, or extension-owned metadata;
// only the bounded contract fields reach it.
const systemPrompt = [
  "You translate user-interface text from Japanese for a browser extension that must keep the",
  "original page layout intact.",
  "",
  "For every item return two variants:",
  "- full: a faithful translation that reads naturally in the target language.",
  "- compact: a shorter label with the same meaning, for cases where the original box is too narrow.",
  "",
  "Rules:",
  "- Keep compact no longer than full, and prefer it clearly shorter for buttons, tabs, badges,",
  "  navigation entries, and table headers.",
  "- When an item has compactMaxChars, that is how much room the original control has. Aim to fit",
  "  the compact variant within it using a shorter synonym or an abbreviation a reader of that",
  "  language would immediately recognise. Correctness outranks the limit: never invent a word,",
  "  truncate mid-word, or pick a term that changes the meaning in order to hit the number. If no",
  "  accurate label fits, return the shortest accurate one and let it exceed the limit.",
  "- Preserve numbers, dates, units, product names, and proper nouns exactly as written.",
  "- Match the register and capitalisation conventions of the target language for UI labels, and do",
  "  not add trailing punctuation that the source does not have.",
  "- Translate each item independently; never merge, reorder, drop, or invent items.",
  "- Return one result per requested anchorId, reusing the anchorId exactly.",
].join("\n");

const responseSchema = {
  type: "object",
  properties: {
    translations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          anchorId: { type: "string" },
          full: { type: "string" },
          compact: { type: "string" },
        },
        required: ["anchorId", "full", "compact"],
        additionalProperties: false,
      },
    },
  },
  required: ["translations"],
  additionalProperties: false,
} as const;

export function readOpenAIProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
): OpenAIProviderConfig {
  const apiKey = env.OPENAI_API_KEY?.trim();
  const model = env.LAYOUT_TRANSLATE_PROVIDER_MODEL?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY must be configured before starting the backend with LAYOUT_TRANSLATE_PROVIDER=openai");
  }
  if (!model) {
    throw new Error("LAYOUT_TRANSLATE_PROVIDER_MODEL must name the provider model; no default model is assumed");
  }

  const baseUrl = env.LAYOUT_TRANSLATE_PROVIDER_BASE_URL?.trim() || DEFAULT_OPENAI_BASE_URL;
  let parsedBaseUrl: URL;
  try {
    parsedBaseUrl = new URL(baseUrl);
  } catch {
    throw new Error("LAYOUT_TRANSLATE_PROVIDER_BASE_URL must be a valid URL");
  }
  if (!/^https?:$/u.test(parsedBaseUrl.protocol)) {
    throw new Error("LAYOUT_TRANSLATE_PROVIDER_BASE_URL must be an HTTP(S) URL");
  }

  const rawTimeout = Number(env.LAYOUT_TRANSLATE_PROVIDER_TIMEOUT_MS ?? DEFAULT_PROVIDER_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : DEFAULT_PROVIDER_TIMEOUT_MS;

  return {
    apiKey,
    model,
    baseUrl: parsedBaseUrl.toString().replace(/\/$/u, ""),
    timeoutMs,
  };
}

function buildUserMessage(
  items: readonly BackendTranslationItem[],
  targetLanguage: TargetLanguage,
): string {
  const payload = items.map((item) => ({
    anchorId: item.anchorId,
    component: item.component,
    source: item.source,
    ...(item.compactMaxChars === undefined ? {} : { compactMaxChars: item.compactMaxChars }),
  }));
  return [
    `Target language: ${languageNames[targetLanguage]}.`,
    `Translate the following ${items.length} interface strings.`,
    JSON.stringify({ items: payload }),
  ].join("\n");
}

function parseCompletion(body: unknown): unknown {
  if (typeof body !== "object" || body === null) {
    throw new ContractError("provider_invalid_response", 502, "Provider returned a non-object response");
  }
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new ContractError("provider_invalid_response", 502, "Provider returned no completion choices");
  }
  const message = (choices[0] as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) {
    throw new ContractError("provider_invalid_response", 502, "Provider choice is missing a message");
  }
  if (typeof (message as { refusal?: unknown }).refusal === "string" && (message as { refusal: string }).refusal) {
    throw new ContractError("provider_refused", 502, "Provider refused the translation request");
  }
  const content = (message as { content?: unknown }).content;
  if (typeof content !== "string" || content.length === 0) {
    throw new ContractError("provider_invalid_response", 502, "Provider message content is empty");
  }
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new ContractError("provider_invalid_response", 502, "Provider message content is not valid JSON");
  }
}

function toTranslationResults(parsed: unknown): TranslationResult[] {
  const translations = (parsed as { translations?: unknown }).translations;
  if (!Array.isArray(translations)) {
    throw new ContractError("provider_invalid_response", 502, "Provider response is missing a translations array");
  }
  // Shape only; the server still validates anchor correlation and bounds through
  // validateTranslationResults, which is the single authority for that contract.
  return translations.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new ContractError("provider_invalid_response", 502, `Provider translation ${index} is not an object`);
    }
    const record = entry as Record<string, unknown>;
    if (
      typeof record.anchorId !== "string"
      || typeof record.full !== "string"
      || typeof record.compact !== "string"
    ) {
      throw new ContractError("provider_invalid_response", 502, `Provider translation ${index} has invalid fields`);
    }
    return {
      anchorId: record.anchorId,
      full: record.full.slice(0, MAX_TRANSLATION_LENGTH),
      compact: record.compact.slice(0, MAX_TRANSLATION_LENGTH),
    };
  });
}

export function createOpenAIProvider(
  config: OpenAIProviderConfig,
  fetchImpl: typeof fetch = fetch,
): TranslationProvider {
  return {
    name: "openai",
    model: config.model,
    async translateBatch(items, targetLanguage) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: config.model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: buildUserMessage(items, targetLanguage) },
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "layout_translate_batch",
                strict: true,
                schema: responseSchema,
              },
            },
          }),
          signal: controller.signal,
        });

        const body = await response.json().catch(() => undefined);
        if (!response.ok) {
          // Provider error text can echo request content, so only the status and
          // the provider's error code are surfaced.
          const code = typeof body === "object" && body !== null
            ? (body as { error?: { code?: unknown } }).error?.code
            : undefined;
          throw new ContractError(
            response.status === 429 ? "provider_rate_limited" : "provider_unavailable",
            502,
            `Provider request failed with status ${response.status}${typeof code === "string" ? ` (${code})` : ""}`,
          );
        }
        return toTranslationResults(parseCompletion(body));
      } catch (error) {
        if (error instanceof ContractError) throw error;
        if (error instanceof Error && error.name === "AbortError") {
          throw new ContractError("provider_unavailable", 502, "Provider request timed out");
        }
        throw new ContractError("provider_unavailable", 502, "Provider request failed");
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
