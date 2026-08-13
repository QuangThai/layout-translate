import type { TargetLanguage } from "../../src/shared/contracts";

export const BENCHMARK_DATASET = "synthetic-v1" as const;
export const MAX_BENCHMARK_MODEL_ID_LENGTH = 128;

export interface BenchmarkRunRequest {
  dataset: typeof BENCHMARK_DATASET;
  model: string;
  targetLanguage: TargetLanguage;
  includeCompactCandidates: boolean;
}

export interface BenchmarkRunPlan {
  dataset: typeof BENCHMARK_DATASET;
  models: string[];
  targetLanguages: TargetLanguage[];
  requests: BenchmarkRunRequest[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const expected = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) throw new Error(`${label} contains unsupported field: ${key}`);
  }
}

export function parseBenchmarkModels(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  const models = raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (models.length === 0 || models.some((model) => model.length > MAX_BENCHMARK_MODEL_ID_LENGTH || !/^[A-Za-z0-9._:/-]+$/u.test(model))) {
    throw new Error("LAYOUT_TRANSLATE_BENCHMARK_MODELS contains an invalid model ID");
  }
  return [...new Set(models)];
}

export function parseBenchmarkRunRequest(value: unknown): BenchmarkRunRequest {
  if (!isRecord(value)) throw new Error("Benchmark request must be an object");
  assertExactKeys(value, ["dataset", "model", "targetLanguage", "includeCompactCandidates"], "benchmark request");
  if (value.dataset !== BENCHMARK_DATASET) throw new Error(`dataset must be ${BENCHMARK_DATASET}`);
  if (typeof value.model !== "string" || !/^[A-Za-z0-9._:/-]+$/u.test(value.model) || value.model.length > MAX_BENCHMARK_MODEL_ID_LENGTH) {
    throw new Error("model must be a valid provider model ID");
  }
  if (value.targetLanguage !== "en" && value.targetLanguage !== "vi") throw new Error("targetLanguage must be en or vi");
  if (value.includeCompactCandidates !== true) throw new Error("includeCompactCandidates must be true");
  return {
    dataset: BENCHMARK_DATASET,
    model: value.model,
    targetLanguage: value.targetLanguage,
    includeCompactCandidates: true,
  };
}

export function buildBenchmarkRunPlan(models: readonly string[]): BenchmarkRunPlan {
  const normalized = [...new Set(models)];
  if (normalized.length === 0) throw new Error("At least one approved benchmark model is required");
  normalized.forEach((model) => parseBenchmarkRunRequest({
    dataset: BENCHMARK_DATASET,
    model,
    targetLanguage: "en",
    includeCompactCandidates: true,
  }));
  const targetLanguages: TargetLanguage[] = ["en", "vi"];
  const requests = normalized.flatMap((model) => targetLanguages.map((targetLanguage) => ({
    dataset: BENCHMARK_DATASET,
    model,
    targetLanguage,
    includeCompactCandidates: true,
  })));
  return { dataset: BENCHMARK_DATASET, models: normalized, targetLanguages, requests };
}
