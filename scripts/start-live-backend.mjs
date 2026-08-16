// Starts the backend in real-provider mode for live-site verification and
// prints the exact extension configuration to paste, so the developer loop is
// one command instead of six environment variables.
//
// Developer verification only, per
// docs/decisions/0005-live-site-developer-verification.md.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const DEFAULT_PORT = 8787;
const DEFAULT_TOKEN = "dev-only-token";
const DEFAULT_TIMEOUT_MS = 90_000;

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

function values(name) {
  const prefix = `--${name}=`;
  return process.argv.filter((argument) => argument.startsWith(prefix)).map((argument) => argument.slice(prefix.length));
}

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function normaliseOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value.includes("://") ? value : `https://${value}`);
  } catch {
    fail(`--site must be a URL or hostname, received: ${value}`);
  }
  if (!/^https?:$/u.test(parsed.protocol)) fail(`--site must be an HTTP(S) address, received: ${value}`);
  return parsed.origin;
}

const env = { ...readEnvFile(), ...process.env };
const apiKey = env.OPENAI_API_KEY?.trim();
const model = values("model").at(-1) ?? env.LAYOUT_TRANSLATE_PROVIDER_MODEL?.trim();
// Flags win over .env so a one-off site does not need an edit, but .env alone
// is enough for the everyday loop.
const configuredSites = values("site").length > 0
  ? values("site")
  : (env.LAYOUT_TRANSLATE_SITES ?? "").split(",").map((value) => value.trim()).filter(Boolean);
const sites = [...new Set(configuredSites.map(normaliseOrigin))];
const port = Number(values("port").at(-1) ?? env.LAYOUT_TRANSLATE_MOCK_PORT ?? DEFAULT_PORT);
const token = values("token").at(-1) ?? env.LAYOUT_TRANSLATE_MOCK_AUTH_TOKEN ?? DEFAULT_TOKEN;

if (!apiKey) fail("OPENAI_API_KEY is missing. Put it in .env or the environment before starting.");
if (!model) {
  fail([
    "A model is required; no default is assumed.",
    "",
    "  npm run backend:live -- --model=gpt-4.1-mini --site=https://example.co.jp",
  ].join("\n"));
}
if (sites.length === 0) {
  fail([
    "No page origin is configured. The backend only accepts origins you list, so a",
    "page you have not named is rejected rather than silently translated.",
    "",
    "Set LAYOUT_TRANSLATE_SITES in .env, or pass the flag:",
    "",
    "  npm run backend:live -- --site=https://example.co.jp",
  ].join("\n"));
}

const child = spawn(
  process.execPath,
  [join(repositoryRoot, "node_modules", "tsx", "dist", "cli.mjs"), join(repositoryRoot, "backend", "src", "mock-server.ts")],
  {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      LAYOUT_TRANSLATE_PROVIDER: "openai",
      OPENAI_API_KEY: apiKey,
      LAYOUT_TRANSLATE_PROVIDER_MODEL: model,
      LAYOUT_TRANSLATE_PROVIDER_TIMEOUT_MS: String(env.LAYOUT_TRANSLATE_PROVIDER_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
      LAYOUT_TRANSLATE_MOCK_PORT: String(port),
      LAYOUT_TRANSLATE_MOCK_AUTH_TOKEN: token,
      LAYOUT_TRANSLATE_ALLOWED_ORIGINS: sites.join(","),
      LAYOUT_TRANSLATE_ALLOW_EXTENSION_CLIENTS: "true",
    },
    stdio: "inherit",
    windowsHide: true,
  },
);

const configuration = JSON.stringify({
  url: `http://127.0.0.1:${port}`,
  token,
  timeoutMs: 60_000,
}, null, 2).replace(/\n/gu, "\n    ");

console.log([
  "",
  "Paste this once into the extension service worker console",
  "(chrome://extensions -> Layout Translate Spike -> service worker):",
  "",
  `  chrome.storage.local.set({ "layout-translate:backend": ${configuration} })`,
  "",
  `Allowed page origins: ${sites.join(", ")}`,
  "A page outside that list is rejected with origin_not_allowed.",
  "",
].join("\n"));

child.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => child.kill("SIGINT"));
