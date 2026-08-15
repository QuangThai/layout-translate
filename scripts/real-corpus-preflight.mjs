import { existsSync, lstatSync, readFileSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const REAL_CORPUS_MANIFEST_SCHEMA = "layout-translate/real-corpus-manifest/v2";
export const REAL_CORPUS_PREFLIGHT_SCHEMA = "layout-translate/real-corpus-preflight/v1";

const repositoryRoot = resolve(import.meta.dirname, "..");
const textExtensions = new Set([".css", ".html", ".htm", ".js", ".json", ".mjs", ".svg", ".ts", ".tsx"]);
const realCorpusContentClasses = new Set(["synthetic-only", "public-sanitized"]);
const externalRequestPattern = /\b(?:https?:)?\/\/[A-Za-z0-9.-]+(?:[/:?#][^\s"'<>)]*)?/iu;
const credentialPattern = /\b(?:authorization|bearer|api[-_]?key|access[-_]?token|client[-_]?secret|private[-_]?key|set[-_]?cookie|password)\b\s*[:=]/iu;
const executablePattern = /<script\b|\bon[a-z][a-z0-9-]*\s*=/iu;

function addError(errors, code, message, path) {
  errors.push({ code, message, ...(path ? { path } : {}) });
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidDate(value) {
  return hasText(value) && Number.isFinite(Date.parse(value));
}

function relativeFilePath(root, value) {
  if (!hasText(value) || isAbsolute(value)) return null;
  const normalized = value.replaceAll("\\", "/");
  const resolvedPath = resolve(root, normalized);
  const relativePath = relative(root, resolvedPath).replaceAll("\\", "/");
  if (!relativePath || relativePath === ".." || relativePath.startsWith("../") || isAbsolute(relativePath)) return null;
  return { absolutePath: resolvedPath, relativePath: normalized };
}

function readManifest(manifestPath, errors) {
  if (!existsSync(manifestPath)) {
    addError(errors, "manifest_missing", "manifest.json is required");
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (!isRecord(parsed)) {
      addError(errors, "manifest_invalid", "manifest.json must contain a JSON object");
      return null;
    }
    return parsed;
  } catch {
    addError(errors, "manifest_invalid_json", "manifest.json is not valid JSON");
    return null;
  }
}

function checkDeclaredFile(root, value, label, errors, files) {
  const pathInfo = relativeFilePath(root, value);
  if (!pathInfo) {
    addError(errors, "file_path_invalid", `${label} must be a relative path inside the corpus`, label);
    return null;
  }
  if (!existsSync(pathInfo.absolutePath)) {
    addError(errors, "file_missing", `${label} does not exist`, pathInfo.relativePath);
    return null;
  }
  try {
    if (!lstatSync(pathInfo.absolutePath).isFile()) {
      addError(errors, "file_not_regular", `${label} must point to a regular file`, pathInfo.relativePath);
      return null;
    }
  } catch {
    addError(errors, "file_unreadable", `${label} could not be inspected`, pathInfo.relativePath);
    return null;
  }
  files.push(pathInfo);
  return pathInfo;
}

function checkDeclaredFileList(root, value, label, errors, files, required) {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value) || (required && value.length === 0) || value.some((item) => typeof item !== "string")) {
    addError(errors, "file_declaration_invalid", `${label} must be a non-empty array of relative file paths`, label);
    return [];
  }
  return value.map((item, index) => checkDeclaredFile(root, item, `${label}[${index}]`, errors, files)).filter(Boolean);
}

function validateCalibrationTargets(manifest, errors) {
  const calibration = manifest.calibration;
  if (!isRecord(calibration) || !Array.isArray(calibration.targets) || calibration.targets.length === 0) {
    addError(errors, "calibration_targets_incomplete", "calibration.targets must list at least one measurement target");
    return;
  }
  const names = new Set();
  for (const [index, target] of calibration.targets.entries()) {
    const label = `calibration.targets[${index}]`;
    if (
      !isRecord(target)
      || !hasText(target.name)
      || !hasText(target.anchorSelector)
      || !hasText(target.siblingSelector)
      || typeof target.desktopHardGate !== "boolean"
    ) {
      addError(errors, "calibration_target_invalid", `${label} requires name, anchorSelector, siblingSelector, and boolean desktopHardGate`, label);
      continue;
    }
    if (names.has(target.name)) {
      addError(errors, "calibration_target_duplicate", `${label} has a duplicate target name`, label);
    }
    names.add(target.name);
    for (const [field, value] of [["anchorSelector", target.anchorSelector], ["siblingSelector", target.siblingSelector]]) {
      if (/\r|\n/u.test(value)) addError(errors, "calibration_selector_invalid", `${label}.${field} must be a single-line selector`, label);
    }
  }
}

function validateTranslationContract(manifest, errors, mode) {
  if (mode === "baseline") return;
  const calibration = manifest.calibration;
  const cases = isRecord(calibration) ? calibration.translationCases : null;
  if (!Array.isArray(cases) || cases.length === 0) {
    addError(errors, "translation_contract_incomplete", "calibration.translationCases must list at least one reviewed translation case", "calibration.translationCases");
    return;
  }
  const names = new Set();
  for (const [index, translationCase] of cases.entries()) {
    const label = `calibration.translationCases[${index}]`;
    if (
      !isRecord(translationCase)
      || !hasText(translationCase.name)
      || !hasText(translationCase.selector)
      || !hasText(translationCase.source)
      || !hasText(translationCase.en)
      || !hasText(translationCase.vi)
    ) {
      addError(errors, "translation_case_invalid", `${label} requires name, selector, source, en, and vi`, label);
      continue;
    }
    if (names.has(translationCase.name)) {
      addError(errors, "translation_case_duplicate", `${label} has a duplicate case name`, label);
    }
    names.add(translationCase.name);
    if (/\r|\n/u.test(translationCase.selector)) {
      addError(errors, "translation_selector_invalid", `${label}.selector must be a single-line selector`, label);
    }
    if (isRecord(translationCase.compact)) {
      for (const locale of ["en", "vi"]) {
        if (!hasText(translationCase.compact[locale])) {
          addError(errors, "translation_compact_invalid", `${label}.compact.${locale} must be a non-empty string when compact output is declared`, label);
        }
      }
    }
  }
  const review = isRecord(calibration) ? calibration.translationReview : null;
  if (
    !isRecord(review)
    || review.reviewed !== true
    || !hasText(review.reviewedBy)
    || !isValidDate(review.reviewedAt)
  ) {
    addError(errors, "translation_review_incomplete", "calibration.translationReview must record human review before translation calibration can run", "calibration.translationReview");
  }
}

function validateManifestShape(root, manifest, errors, files, mode) {
  if (manifest.schema !== REAL_CORPUS_MANIFEST_SCHEMA) {
    addError(errors, "manifest_schema_invalid", `manifest.schema must be ${REAL_CORPUS_MANIFEST_SCHEMA}`);
  }
  if (manifest.status !== "approved") {
    addError(errors, "manifest_not_approved", "manifest.status must be approved before calibration can run");
  }
  if (!hasText(manifest.snapshotId)) addError(errors, "snapshot_id_missing", "manifest.snapshotId is required");

  const source = manifest.source;
  if (!isRecord(source) || !hasText(source.kind) || !hasText(source.reference) || !isValidDate(source.capturedAt)) {
    addError(errors, "source_provenance_incomplete", "manifest.source.kind, reference, and capturedAt are required");
  }

  const allowedUse = manifest.allowedUse;
  if (!isRecord(allowedUse) || allowedUse.purpose !== "technical-spike-calibration" || !hasText(allowedUse.approvedBy) || !isValidDate(allowedUse.approvedAt)) {
    addError(errors, "approval_incomplete", "allowedUse must record technical-spike-calibration and product approval");
  }

  const sanitization = manifest.sanitization;
  if (
    !isRecord(sanitization)
    || sanitization.reviewed !== true
    || sanitization.removedExternalRequests !== true
    || !realCorpusContentClasses.has(sanitization.contentClass)
    || !hasText(sanitization.reviewedBy)
    || !isValidDate(sanitization.reviewedAt)
  ) {
    addError(errors, "sanitization_incomplete", "sanitization must be reviewed, declare contentClass as synthetic-only or public-sanitized, and be free of external requests");
  }

  if (!Array.isArray(manifest.viewports) || manifest.viewports.length === 0 || manifest.viewports.some((viewport) => (
    !isRecord(viewport)
    || !hasText(viewport.name)
    || !Number.isFinite(viewport.width)
    || !Number.isFinite(viewport.height)
    || viewport.width <= 0
    || viewport.height <= 0
    || !["hard", "measure-only"].includes(viewport.pageOverflowPolicy)
  ))) {
    addError(errors, "viewports_incomplete", "manifest.viewports must list named positive width/height pairs and pageOverflowPolicy (hard or measure-only)");
  }
  validateCalibrationTargets(manifest, errors);
  validateTranslationContract(manifest, errors, mode);

  const declared = manifest.files;
  if (!isRecord(declared)) addError(errors, "file_declaration_invalid", "manifest.files is required");
  const html = isRecord(declared) ? checkDeclaredFile(root, declared.html, "files.html", errors, files) : null;
  const css = isRecord(declared) ? checkDeclaredFileList(root, declared.css, "files.css", errors, files, true) : [];
  if (isRecord(declared)) {
    checkDeclaredFileList(root, declared.assets, "files.assets", errors, files, false);
    checkDeclaredFileList(root, declared.fonts, "files.fonts", errors, files, false);
    checkDeclaredFileList(root, declared.screenshots, "files.screenshots", errors, files, false);
  }

  const runtime = manifest.runtime;
  if (!isRecord(runtime) || runtime.offlineReplay !== true) {
    addError(errors, "offline_replay_disabled", "runtime.offlineReplay must be true");
  }
  if (!isRecord(runtime) || runtime.expectedEntry !== manifest.files?.html || !html) {
    addError(errors, "entrypoint_invalid", "runtime.expectedEntry must match the existing files.html entry");
  }

  return { html, css };
}

function scanTextFiles(files, errors) {
  const seen = new Set();
  for (const file of files) {
    if (seen.has(file.absolutePath) || !textExtensions.has(extname(file.absolutePath).toLowerCase())) continue;
    seen.add(file.absolutePath);
    let text;
    try {
      text = readFileSync(file.absolutePath, "utf8");
    } catch {
      addError(errors, "file_unreadable", "declared file could not be read", file.relativePath);
      continue;
    }
    if (externalRequestPattern.test(text)) {
      addError(errors, "external_request_marker", "declared text file contains an external URL/request marker", file.relativePath);
    }
    if (credentialPattern.test(text)) {
      addError(errors, "credential_marker", "declared text file contains a credential/header marker", file.relativePath);
    }
    if (executablePattern.test(text)) {
      addError(errors, "executable_content_marker", "declared text file contains script or inline-handler content", file.relativePath);
    }
  }
}

export function validateRealCorpus(corpusRoot, options = {}) {
  const mode = options.mode ?? "both";
  if (!["baseline", "translation", "both"].includes(mode)) {
    throw new Error(`Unsupported real-corpus preflight mode: ${mode}`);
  }
  const root = resolve(corpusRoot);
  const errors = [];
  const files = [];
  const manifest = readManifest(join(root, "manifest.json"), errors);
  if (manifest) validateManifestShape(root, manifest, errors, files, mode);
  scanTextFiles(files, errors);
  return {
    ok: errors.length === 0,
    schema: REAL_CORPUS_PREFLIGHT_SCHEMA,
    mode,
    corpusRoot: root,
    manifest: manifest
      ? {
          schema: manifest.schema ?? null,
          status: manifest.status ?? null,
          snapshotId: manifest.snapshotId ?? null,
        }
      : null,
    files: files.map((file) => file.relativePath).sort(),
    errors,
  };
}

function runCli() {
  const explicitCorpusRoot = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
  const corpusRoot = explicitCorpusRoot
    ? resolve(explicitCorpusRoot)
    : resolve(process.env.LAYOUT_TRANSLATE_REAL_CORPUS_ROOT ?? join(repositoryRoot, "fixtures", "real-corpus"));
  const mode = process.argv.find((argument) => argument.startsWith("--mode="))?.slice("--mode=".length) ?? "both";
  const result = validateRealCorpus(corpusRoot, { mode });
  console.log(JSON.stringify({ ...result, result: result.ok ? "passed" : "failed" }, null, 2));
  if (!result.ok) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) runCli();
