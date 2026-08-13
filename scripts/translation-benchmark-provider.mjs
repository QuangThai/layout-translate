import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readTraceMetadata } from "./trace-metadata.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const casesPath = join(repositoryRoot, "benchmarks", "translation-cases.json");
const reportPath = process.env.LAYOUT_TRANSLATE_BENCHMARK_PROVIDER_REPORT
  ?? join(repositoryRoot, ".output", "translation-benchmark-provider-report.json");

function failClosed(message) {
  const trace = readTraceMetadata({
    repositoryRoot,
    inputPaths: { dataset: casesPath },
  });
  const report = {
    schema: "layout-translate/translation-provider-benchmark-report/v1",
    result: "not-run",
    mode: "backend-only",
    generatedAt: new Date().toISOString(),
    trace,
    dataset: "synthetic-v1",
    model: null,
    provider: "openai-via-approved-backend",
    networkUsed: false,
    contentSentExternally: false,
    reason: message,
    limitations: [
      "No provider call was attempted.",
      "Configure an approved backend endpoint and candidate models before running the provider benchmark.",
      "This command does not accept provider credentials in the extension or source repository.",
    ],
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = 2;
}

function main() {
  if (!existsSync(casesPath)) return failClosed("Synthetic benchmark dataset is missing");
  if (process.env.LAYOUT_TRANSLATE_BENCHMARK_PROVIDER !== "openai-backend") {
    return failClosed("Provider benchmark is disabled; set LAYOUT_TRANSLATE_BENCHMARK_PROVIDER=openai-backend explicitly");
  }
  if (!process.env.LAYOUT_TRANSLATE_BENCHMARK_BACKEND_URL) {
    return failClosed("LAYOUT_TRANSLATE_BENCHMARK_BACKEND_URL is not configured");
  }
  if (!process.env.LAYOUT_TRANSLATE_BENCHMARK_MODELS?.trim()) {
    return failClosed("LAYOUT_TRANSLATE_BENCHMARK_MODELS is not configured");
  }
  if (!process.env.LAYOUT_TRANSLATE_BENCHMARK_AUTH_TOKEN) {
    return failClosed("LAYOUT_TRANSLATE_BENCHMARK_AUTH_TOKEN is not configured");
  }
  failClosed("Provider gateway client is not implemented; no provider call is permitted yet");
}

main();
