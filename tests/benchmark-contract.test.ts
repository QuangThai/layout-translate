import { describe, expect, it } from "vitest";
import {
  BENCHMARK_DATASET,
  buildBenchmarkRunPlan,
  parseBenchmarkModels,
  parseBenchmarkRunRequest,
} from "../backend/src/benchmark-contract";

describe("translation benchmark gateway contract", () => {
  it("requires explicit model configuration and normalizes candidate IDs", () => {
    expect(parseBenchmarkModels(undefined)).toEqual([]);
    expect(parseBenchmarkModels(" model-a,model-b,model-a ")).toEqual(["model-a", "model-b"]);
    expect(() => buildBenchmarkRunPlan([])).toThrow("At least one approved benchmark model is required");
  });

  it("builds both target-language runs without selecting a default model", () => {
    const plan = buildBenchmarkRunPlan(["provider/model-a"]);
    expect(plan).toEqual({
      dataset: BENCHMARK_DATASET,
      models: ["provider/model-a"],
      targetLanguages: ["en", "vi"],
      requests: [
        { dataset: BENCHMARK_DATASET, model: "provider/model-a", targetLanguage: "en", includeCompactCandidates: true },
        { dataset: BENCHMARK_DATASET, model: "provider/model-a", targetLanguage: "vi", includeCompactCandidates: true },
      ],
    });
  });

  it("fails closed for unsupported fields, language, and compact omission", () => {
    const valid = {
      dataset: BENCHMARK_DATASET,
      model: "provider/model-a",
      targetLanguage: "en",
      includeCompactCandidates: true,
    };
    expect(parseBenchmarkRunRequest(valid)).toEqual(valid);
    expect(() => parseBenchmarkRunRequest({ ...valid, extra: true })).toThrow("unsupported field");
    expect(() => parseBenchmarkRunRequest({ ...valid, targetLanguage: "ja" })).toThrow("targetLanguage");
    expect(() => parseBenchmarkRunRequest({ ...valid, includeCompactCandidates: false })).toThrow("includeCompactCandidates");
    expect(() => parseBenchmarkModels("model with spaces")).toThrow("invalid model ID");
  });
});
