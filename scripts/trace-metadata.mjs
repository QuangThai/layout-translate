import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";

function digestBytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizePath(value) {
  return value.split(sep).join("/").replaceAll("\\", "/");
}

function runGitBuffer(repositoryRoot, args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function runGitText(repositoryRoot, args) {
  return runGitBuffer(repositoryRoot, args).toString("utf8").trim();
}

function parseNullSeparated(value) {
  return value
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

function hashFile(filePath) {
  const content = readFileSync(filePath);
  return {
    sha256: digestBytes(content),
    byteCount: content.byteLength,
    fileCount: 1,
  };
}

function collectFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(entryPath));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

function hashPath(targetPath, repositoryRoot) {
  if (!targetPath || !existsSync(targetPath)) return null;
  const stats = lstatSync(targetPath);
  if (stats.isFile()) return { path: normalizePath(relative(repositoryRoot, targetPath)), ...hashFile(targetPath) };
  if (!stats.isDirectory()) return null;

  const files = collectFiles(targetPath);
  const hash = createHash("sha256");
  let byteCount = 0;
  for (const filePath of files) {
    const file = hashFile(filePath);
    byteCount += file.byteCount;
    hash.update(normalizePath(relative(targetPath, filePath)));
    hash.update("\0");
    hash.update(file.sha256);
    hash.update("\0");
  }
  return {
    path: normalizePath(relative(repositoryRoot, targetPath)),
    sha256: hash.digest("hex"),
    byteCount,
    fileCount: files.length,
  };
}

function readNpmVersion() {
  const userAgent = process.env.npm_config_user_agent ?? "";
  const fromUserAgent = userAgent.match(/npm\/(\S+)/u)?.[1];
  if (fromUserAgent) return fromUserAgent;
  try {
    const npmCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
    return execFileSync(process.execPath, [npmCli, "--version"], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim() || null;
  } catch {
    return null;
  }
}

function workingTreeFingerprint(repositoryRoot, untrackedPaths) {
  try {
    const hash = createHash("sha256");
    hash.update("tracked-diff\0");
    hash.update(runGitBuffer(repositoryRoot, ["diff", "--binary", "--no-ext-diff", "HEAD", "--"]));
    hash.update("\0untracked\0");
    for (const relativePath of [...untrackedPaths].sort()) {
      const absolutePath = join(repositoryRoot, relativePath);
      hash.update(normalizePath(relativePath));
      hash.update("\0");
      if (existsSync(absolutePath) && lstatSync(absolutePath).isFile()) hash.update(readFileSync(absolutePath));
      hash.update("\0");
    }
    return hash.digest("hex");
  } catch {
    return null;
  }
}

export function readGitTrace(repositoryRoot) {
  try {
    const status = runGitText(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=normal"]);
    const statusEntries = status ? status.split(/\r?\n/u).filter(Boolean) : [];
    const trackedPaths = parseNullSeparated(runGitBuffer(repositoryRoot, ["diff", "--name-only", "--no-renames", "-z", "HEAD", "--"]));
    const untrackedPaths = parseNullSeparated(runGitBuffer(repositoryRoot, ["ls-files", "--others", "--exclude-standard", "-z"]));
    return {
      revision: runGitText(repositoryRoot, ["rev-parse", "HEAD"]),
      branch: runGitText(repositoryRoot, ["branch", "--show-current"]) || null,
      dirty: statusEntries.length > 0,
      // Kept for report compatibility; this is the number of porcelain rows.
      changedPathCount: statusEntries.length,
      statusEntryCount: statusEntries.length,
      trackedChangedFileCount: new Set(trackedPaths).size,
      untrackedFileCount: untrackedPaths.length,
      workingTreeSha256: workingTreeFingerprint(repositoryRoot, untrackedPaths),
    };
  } catch {
    return {
      revision: null,
      branch: null,
      dirty: null,
      changedPathCount: null,
      statusEntryCount: null,
      trackedChangedFileCount: null,
      untrackedFileCount: null,
      workingTreeSha256: null,
    };
  }
}

function describePaths(repositoryRoot, paths) {
  return Object.fromEntries(
    Object.entries(paths ?? {})
      .filter(([, value]) => Boolean(value))
      .map(([name, value]) => [name, hashPath(value, repositoryRoot)]),
  );
}

export function readTraceMetadata({ repositoryRoot, argv = process.argv, inputPaths, artifactPaths } = {}) {
  return {
    command: argv.join(" "),
    argv: [...argv],
    cwd: process.cwd(),
    node: process.version,
    npm: readNpmVersion(),
    npmLifecycleEvent: process.env.npm_lifecycle_event ?? null,
    repository: readGitTrace(repositoryRoot),
    packageLock: hashPath(join(repositoryRoot, "package-lock.json"), repositoryRoot),
    inputs: describePaths(repositoryRoot, inputPaths),
    artifacts: describePaths(repositoryRoot, artifactPaths),
  };
}

export function removeOwnedArtifacts(paths) {
  let removedCount = 0;
  let failureCount = 0;
  for (const targetPath of paths) {
    try {
      rmSync(targetPath, { force: true });
      removedCount += 1;
    } catch {
      failureCount += 1;
    }
  }
  return { removedCount, failureCount };
}

export function classifyFailure(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/timed out|timeout/u.test(message)) return "timeout";
  if (/assertion failed/u.test(message)) return "assertion";
  if (/screenshot/i.test(message)) return "screenshot";
  if (/backend|translation backend/i.test(message)) return "backend";
  if (/Chrome|CDP|WebSocket|browser/i.test(message)) return "browser";
  if (/report/i.test(message)) return "report";
  return "runner";
}

export function extractRequestId(value) {
  return String(value ?? "").match(/\[request_id:([A-Za-z0-9_-]+)\]/u)?.[1] ?? null;
}
