import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readTraceMetadata } from "./trace-metadata.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const casesPath = join(repositoryRoot, "benchmarks", "translation-cases.json");
const reportPath = process.env.LAYOUT_TRANSLATE_BENCHMARK_REPORT
  ?? join(repositoryRoot, ".output", "translation-benchmark-report.json");

function assert(condition, message) {
  if (!condition) throw new Error(`Benchmark validation failed: ${message}`);
}

function loadCases() {
  assert(existsSync(casesPath), `benchmark cases are missing at ${casesPath}`);
  const document = JSON.parse(readFileSync(casesPath, "utf8"));
  // v2 added a per-case compact budget, so a reviewer can see and argue with the
  // number the provider benchmark scores against instead of it living in a script.
  assert(
    ["layout-translate/translation-benchmark-cases/v1", "layout-translate/translation-benchmark-cases/v2"]
      .includes(document.schema),
    "unsupported benchmark case schema",
  );
  assert(document.status === "synthetic-draft", "only the synthetic draft may run offline");
  assert(Array.isArray(document.cases) && document.cases.length > 0, "benchmark cases must be non-empty");
  const ids = new Set();
  for (const testCase of document.cases) {
    assert(typeof testCase.id === "string" && !ids.has(testCase.id), `case id must be unique: ${testCase.id}`);
    ids.add(testCase.id);
    assert(typeof testCase.source === "string" && testCase.source.length > 0, `${testCase.id} source is required`);
    assert(["en", "vi"].every((language) => typeof testCase.reference?.[language] === "string"), `${testCase.id} references must cover en and vi`);
    if (testCase.compactReference) {
      assert(["en", "vi"].every((language) => typeof testCase.compactReference[language] === "string"), `${testCase.id} compact references must cover en and vi`);
    }
  }
  return document;
}

function evaluateCandidate(testCase, language, candidate) {
  const reference = testCase.reference[language];
  const compactReference = testCase.compactReference?.[language];
  const normalized = candidate.trim();
  const exactReference = normalized === reference;
  const exactCompactReference = compactReference !== undefined && normalized === compactReference;
  const preservesInterpolation = !testCase.source.includes("{{count}}") || normalized.includes("{{count}}");
  return {
    exactReference,
    exactCompactReference,
    preservesInterpolation,
    semanticReviewRequired: Boolean(testCase.reviewNote) || (!exactReference && !exactCompactReference),
    pass: preservesInterpolation && (exactReference || exactCompactReference),
  };
}

function main() {
  const benchmark = loadCases();
  const trace = readTraceMetadata({
    repositoryRoot,
    inputPaths: { dataset: casesPath },
  });
  const cases = benchmark.cases.flatMap((testCase) => ["en", "vi"].map((language) => ({
    id: testCase.id,
    language,
    component: testCase.component,
    semanticCritical: testCase.semanticCritical,
    sourceLength: testCase.source.length,
    referenceLength: testCase.reference[language].length,
    compactReferenceLength: testCase.compactReference?.[language]?.length ?? null,
    evaluator: "reference-only-offline",
    ...evaluateCandidate(testCase, language, testCase.reference[language]),
  })));
  const report = {
    schema: "layout-translate/translation-benchmark-report/v1",
    result: "reference-set-validated",
    mode: "offline-reference-validation",
    generatedAt: new Date().toISOString(),
    trace,
    source: "benchmarks/translation-cases.json",
    caseCount: benchmark.cases.length,
    evaluationCount: cases.length,
    languages: ["en", "vi"],
    model: null,
    provider: null,
    networkUsed: false,
    contentSentExternally: false,
    limitations: [
      "This command validates the synthetic case set and evaluator shape only.",
      "It does not measure model quality, latency, cost, or structured-output reliability.",
      "Reference matches are not a substitute for human semantic review.",
    ],
    cases,
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ result: report.result, caseCount: report.caseCount, evaluationCount: report.evaluationCount, networkUsed: report.networkUsed }, null, 2));
}

main();
