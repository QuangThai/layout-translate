import { existsSync, readdirSync } from "node:fs";
import { delimiter, join } from "node:path";

/**
 * Finds a Chrome the runners can drive.
 *
 * One definition, because four runners had their own copy and every one of them
 * only looked for `chrome.exe`. That is fine on a developer's Windows machine
 * and useless in CI, which is where these proofs most need to run.
 */
export function findChrome() {
  const candidates = [];
  if (process.env.LAYOUT_TRANSLATE_CHROME) candidates.push(process.env.LAYOUT_TRANSLATE_CHROME);

  const executables = process.platform === "win32"
    ? ["chrome.exe"]
    : ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"];

  // Browsers installed by agent-browser, newest first.
  const browserRoot = process.env.USERPROFILE ?? process.env.HOME
    ? join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".agent-browser", "browsers")
    : undefined;
  if (browserRoot && existsSync(browserRoot)) {
    const stack = [browserRoot];
    while (stack.length) {
      const current = stack.pop();
      let entries = [];
      try {
        entries = readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = join(current, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (executables.includes(entry.name)) candidates.push(full);
      }
    }
  }

  for (const directory of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const executable of executables) candidates.push(join(directory, executable));
  }

  const chrome = candidates.find((candidate) => existsSync(candidate));
  if (!chrome) {
    throw new Error(
      "No Chrome was found; run `agent-browser install` or set LAYOUT_TRANSLATE_CHROME to a browser binary",
    );
  }
  return chrome;
}
