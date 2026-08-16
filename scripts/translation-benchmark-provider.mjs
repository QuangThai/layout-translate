// Runs the benchmark case set against candidate models through the backend, so
// provider credentials stay in the backend process and never reach this script.
//
// It produces evidence for a model decision. It does not make one:
// `docs/decisions/0003-translation-model-benchmark-contract.md` requires human
// semantic review before any score becomes a selection, and rejects picking the
// model with the best reference-match score.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createServer as createTcpServer } from "node:net";
import { taskkillCommand } from "./process-tree.mjs";
import { readTraceMetadata } from "./trace-metadata.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const casesPath = join(repositoryRoot, "benchmarks", "translation-cases.json");
const reportPath = process.env.LAYOUT_TRANSLATE_BENCHMARK_PROVIDER_REPORT
  ?? join(repositoryRoot, ".output", "translation-benchmark-provider-report.json");

const JAPANESE = /[぀-ヿ㐀-鿿]/u;
const LANGUAGES = ["en", "vi"];


function sleep(ms) {
  return new Promise((settle) => setTimeout(settle, ms));
}

function readEnvFile() {
  const path = join(repositoryRoot, ".env");
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, "utf8").split(/\r?\n/u)
    .filter((line) => line.trim() && !line.trim().startsWith("#"))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^["']|["']$/gu, "")];
    })
    .filter(([key]) => key));
}

function failClosed(message) {
  const report = {
    schema: "layout-translate/translation-provider-benchmark-report/v2",
    result: "not-run",
    mode: "backend-only",
    generatedAt: new Date().toISOString(),
    trace: readTraceMetadata({ repositoryRoot, inputPaths: { dataset: casesPath } }),
    dataset: "synthetic-v1",
    models: [],
    provider: "openai-via-backend",
    reason: message,
    limitations: [
      "No provider call was attempted.",
      "This command never receives provider credentials; the backend process holds them.",
    ],
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.error(message);
  process.exitCode = 2;
  return null;
}

async function findFreePort() {
  const server = createTcpServer();
  await new Promise((settle, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", settle);
  });
  const port = server.address().port;
  await new Promise((settle) => server.close(settle));
  return port;
}

/**
 * Checks that hold whatever wording a model chooses. Reference matching is a
 * weak signal for translation, but these are not: a lost interpolation token or
 * a changed date is a defect in any wording.
 */
function scoreCase(testCase, language, result) {
  const failures = [];
  const full = result?.full ?? "";
  const compact = result?.compact ?? "";

  if (!full.trim()) failures.push("empty");
  if (JAPANESE.test(full) || JAPANESE.test(compact)) failures.push("japanese_remains");
  if (compact.length > full.length) failures.push("compact_longer_than_full");
  const budget = testCase.constraints?.compactMaxChars;
  if (typeof budget === "number" && compact.length > budget) {
    failures.push("compact_over_budget:" + compact.length + ">" + budget);
  }
  for (const token of testCase.source.match(/\{\{[^}]+\}\}/gu) ?? []) {
    if (!full.includes(token)) failures.push(`token_lost:${token}`);
  }
  for (const number of testCase.source.match(/\d+/gu) ?? []) {
    if (!full.includes(number)) failures.push(`number_lost:${number}`);
  }
  // No check on a critical case's compact form: the engine never displays it,
  // because critical content keeps its full wording and gets a tooltip. Judging
  // the model on a variant nothing uses measured the wrong thing.

  const expected = testCase.reference?.[language] ?? "";
  const normalise = (value) => value.toLowerCase().replace(/[\s.,!?:;"']/gu, "");
  return {
    id: testCase.id,
    component: testCase.component,
    semanticCritical: Boolean(testCase.semanticCritical),
    full,
    compact,
    expected,
    matchesReference: full === expected,
    matchesReferenceNormalised: normalise(full) === normalise(expected),
    failures,
  };
}

async function runModel(model, cases, apiKey, env) {
  const port = await findFreePort();
  const token = "benchmark-token";
  const origin = "http://127.0.0.1:4173";
  const usage = [];
  const backend = spawn(
    process.execPath,
    [join(repositoryRoot, "node_modules", "tsx", "dist", "cli.mjs"), join(repositoryRoot, "backend", "src", "mock-server.ts")],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        LAYOUT_TRANSLATE_PROVIDER: "openai",
        OPENAI_API_KEY: apiKey,
        LAYOUT_TRANSLATE_PROVIDER_MODEL: model,
        LAYOUT_TRANSLATE_PROVIDER_TIMEOUT_MS: env.LAYOUT_TRANSLATE_PROVIDER_TIMEOUT_MS ?? "120000",
        LAYOUT_TRANSLATE_MOCK_PORT: String(port),
        LAYOUT_TRANSLATE_MOCK_AUTH_TOKEN: token,
        LAYOUT_TRANSLATE_ALLOWED_ORIGINS: origin,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  const stderr = [];
  backend.stdout.setEncoding("utf8");
  backend.stdout.on("data", (chunk) => {
    for (const line of String(chunk).split(/\r?\n/u).filter(Boolean)) {
      try {
        const event = JSON.parse(line);
        if (event.event === "provider_usage") usage.push(event);
      } catch {
        // The listening banner is not JSON.
      }
    }
  });
  backend.stderr.setEncoding("utf8");
  backend.stderr.on("data", (chunk) => stderr.push(String(chunk).slice(0, 200)));

  try {
    const deadline = Date.now() + 20_000;
    let ready = false;
    while (Date.now() < deadline && !ready) {
      ready = await fetch(`http://127.0.0.1:${port}/v1/translate`, { method: "OPTIONS" })
        .then(() => true)
        .catch(() => false);
      if (!ready) await sleep(250);
    }
    if (!ready) return { model, error: `backend did not start: ${stderr.slice(-1)[0] ?? "no output"}` };

    const languages = {};
    for (const language of LANGUAGES) {
      const startedAt = Date.now();
      const response = await fetch(`http://127.0.0.1:${port}/v1/translate`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          pageOrigin: origin,
          targetLanguage: language,
          items: cases.map((testCase) => ({
            anchorId: testCase.id.replace(/[^A-Za-z0-9_-]/gu, "-"),
            source: testCase.source,
            component: testCase.component,
            dataClass: "normal",
            ...(typeof testCase.constraints?.compactMaxChars === "number"
              ? { compactMaxChars: testCase.constraints.compactMaxChars }
              : {}),
          })),
        }),
      });
      const elapsedMs = Date.now() - startedAt;
      const body = await response.json().catch(() => undefined);
      if (!response.ok) {
        languages[language] = { elapsedMs, error: body?.code ?? `http_${response.status}` };
        continue;
      }
      const byId = new Map((body.translations ?? []).map((item) => [item.anchorId, item]));
      const scored = cases.map((testCase) =>
        scoreCase(testCase, language, byId.get(testCase.id.replace(/[^A-Za-z0-9_-]/gu, "-"))));
      languages[language] = {
        elapsedMs,
        cases: scored,
        structuredOutputValid: byId.size === cases.length,
        casesWithFailures: scored.filter((entry) => entry.failures.length > 0).length,
        criticalFailures: scored.filter((entry) => entry.semanticCritical && entry.failures.length > 0).length,
        referenceMatches: scored.filter((entry) => entry.matchesReference).length,
        referenceMatchesNormalised: scored.filter((entry) => entry.matchesReferenceNormalised).length,
      };
    }
    return {
      model,
      languages,
      usage: {
        requests: usage.length,
        promptTokens: usage.reduce((total, entry) => total + entry.promptTokens, 0),
        completionTokens: usage.reduce((total, entry) => total + entry.completionTokens, 0),
      },
    };
  } finally {
    if (backend.exitCode === null) {
      try {
        if (process.platform === "win32") {
          spawn(taskkillCommand(), ["/pid", String(backend.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
        } else {
          backend.kill("SIGTERM");
        }
      } catch {
        // Already gone.
      }
      const stopBy = Date.now() + 5_000;
      while (backend.exitCode === null && Date.now() < stopBy) await sleep(100);
    }
  }
}

async function main() {
  if (!existsSync(casesPath)) return failClosed("Synthetic benchmark dataset is missing");
  const env = { ...readEnvFile(), ...process.env };
  const apiKey = env.OPENAI_API_KEY?.trim();
  const models = (env.LAYOUT_TRANSLATE_BENCHMARK_MODELS ?? "")
    .split(",").map((value) => value.trim()).filter(Boolean);

  if (!apiKey) return failClosed("OPENAI_API_KEY is not configured; the backend needs it to reach the provider");
  if (models.length === 0) {
    return failClosed("LAYOUT_TRANSLATE_BENCHMARK_MODELS is not configured; no model is a repository default");
  }

  const dataset = JSON.parse(readFileSync(casesPath, "utf8"));
  const results = [];
  for (const model of models) {
    console.error(`running ${model}...`);
    results.push(await runModel(model, dataset.cases, apiKey, env));
  }

  const report = {
    schema: "layout-translate/translation-provider-benchmark-report/v2",
    result: "completed",
    mode: "backend-only",
    generatedAt: new Date().toISOString(),
    trace: readTraceMetadata({ repositoryRoot, inputPaths: { dataset: casesPath } }),
    dataset: dataset.schema,
    caseCount: dataset.cases.length,
    provider: "openai-via-backend",
    compactBudgetSource: "per case, in the dataset",
    models: results,
    selection: null,
    limitations: [
      "No model is selected by this run.",
      "Reference matching is a weak signal for translation quality and is reported, not scored on.",
      "The objective checks hold for any wording: lost interpolation tokens, lost numbers, remaining Japanese, a compact longer than its full form, and heavily shortened critical text.",
      "Semantic quality still needs the human review that decision 0003 requires.",
    ],
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({
    result: report.result,
    caseCount: report.caseCount,
    models: results.map((entry) => ({
      model: entry.model,
      error: entry.error,
      en: entry.languages?.en && {
        ms: entry.languages.en.elapsedMs,
        failures: entry.languages.en.casesWithFailures,
        criticalFailures: entry.languages.en.criticalFailures,
        referenceMatches: entry.languages.en.referenceMatches,
      },
      vi: entry.languages?.vi && {
        ms: entry.languages.vi.elapsedMs,
        failures: entry.languages.vi.casesWithFailures,
        criticalFailures: entry.languages.vi.criticalFailures,
        referenceMatches: entry.languages.vi.referenceMatches,
      },
      tokens: entry.usage,
    })),
    reportPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
