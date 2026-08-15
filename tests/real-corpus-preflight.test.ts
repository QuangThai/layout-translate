import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateRealCorpus } from "../scripts/real-corpus-preflight.mjs";

function temporaryCorpus() {
  return mkdtempSync(join(tmpdir(), "layout-translate-real-corpus-"));
}

function writeValidCorpus(root: string) {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "page.html"), "<!doctype html><main><h1>Sanitized page</h1></main>\n", "utf8");
  writeFileSync(join(root, "styles.css"), "main { display: grid; }\n", "utf8");
  writeFileSync(join(root, "manifest.json"), JSON.stringify({
    schema: "layout-translate/real-corpus-manifest/v2",
    status: "approved",
    snapshotId: "snapshot-001",
    source: { kind: "sanitized-export", reference: "internal-review-001", capturedAt: "2026-08-13T00:00:00Z" },
    allowedUse: { purpose: "technical-spike-calibration", approvedBy: "product-owner", approvedAt: "2026-08-13T00:00:00Z" },
    sanitization: { reviewed: true, reviewedBy: "privacy-reviewer", reviewedAt: "2026-08-13T00:00:00Z", removedExternalRequests: true, contentClass: "synthetic-only", notes: null },
    viewports: [{ name: "desktop", width: 1280, height: 900, pageOverflowPolicy: "hard" }],
    calibration: {
      targets: [{ name: "main", anchorSelector: "main", siblingSelector: "body", desktopHardGate: true }],
      translationCases: [{ name: "main-heading", selector: "h1", source: "会社情報", en: "Company", vi: "Thông tin công ty" }],
      translationReview: { reviewed: true, reviewedBy: "content-reviewer", reviewedAt: "2026-08-13T00:00:00Z" },
    },
    files: { html: "page.html", css: ["styles.css"], assets: [], fonts: [], screenshots: [] },
    runtime: { offlineReplay: true, expectedEntry: "page.html", notes: null },
  }, null, 2), "utf8");
}

describe("real-corpus preflight", () => {
  it("fails closed for the repository template", () => {
    const result = validateRealCorpus(join(import.meta.dirname, "..", "fixtures", "real-corpus"));
    const codes = result.errors.map((error) => error.code);
    expect(result.ok).toBe(false);
    expect(codes).toContain("manifest_not_approved");
    expect(codes).toContain("approval_incomplete");
    expect(codes).toContain("sanitization_incomplete");
    expect(result.files).toEqual(["page.html", "styles.css"]);
  });

  it("accepts a complete approved offline corpus", () => {
    const root = temporaryCorpus();
    writeValidCorpus(root);
    const result = validateRealCorpus(root);
    expect(result).toMatchObject({ ok: true, manifest: { status: "approved", snapshotId: "snapshot-001" } });
    expect(result.errors).toEqual([]);
  });

  it("accepts a reviewed public-sanitized corpus", () => {
    const root = temporaryCorpus();
    writeValidCorpus(root);
    const manifestPath = join(root, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.sanitization.contentClass = "public-sanitized";
    writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
    const result = validateRealCorpus(root);
    expect(result).toMatchObject({ ok: true, manifest: { status: "approved", snapshotId: "snapshot-001" } });
    expect(result.errors).toEqual([]);
  });

  it("rejects an unknown sanitization content class", () => {
    const root = temporaryCorpus();
    writeValidCorpus(root);
    const manifestPath = join(root, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.sanitization.contentClass = "provider-export";
    writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
    const result = validateRealCorpus(root);
    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain("sanitization_incomplete");
  });

  it("allows a baseline-only corpus without translation references", () => {
    const root = temporaryCorpus();
    writeValidCorpus(root);
    const manifestPath = join(root, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    delete manifest.calibration.translationCases;
    delete manifest.calibration.translationReview;
    writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
    const result = validateRealCorpus(root, { mode: "baseline" });
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("baseline");
  });

  it("fails translation mode when human-reviewed references are absent", () => {
    const root = temporaryCorpus();
    writeValidCorpus(root);
    const manifestPath = join(root, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.calibration.translationReview.reviewed = false;
    writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
    const result = validateRealCorpus(root, { mode: "translation" });
    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain("translation_review_incomplete");
  });

  it("requires an explicit page-overflow policy for each viewport", () => {
    const root = temporaryCorpus();
    writeValidCorpus(root);
    const manifestPath = join(root, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    delete manifest.viewports[0].pageOverflowPolicy;
    writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
    const result = validateRealCorpus(root, { mode: "baseline" });
    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain("viewports_incomplete");
  });

  it("rejects external requests and credential markers", () => {
    const root = temporaryCorpus();
    writeValidCorpus(root);
    writeFileSync(join(root, "page.html"), "<main><img src=\"https://example.test/image.png\"><div data-api-key=\"secret\"></div></main>\n", "utf8");
    const result = validateRealCorpus(root);
    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual(expect.arrayContaining([
      "external_request_marker",
      "credential_marker",
    ]));
  });

  it("rejects file paths that escape the corpus root", () => {
    const root = temporaryCorpus();
    writeValidCorpus(root);
    const manifestPath = join(root, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.files.html = "../outside.html";
    writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
    const result = validateRealCorpus(root);
    expect(result.errors.map((error) => error.code)).toContain("file_path_invalid");
  });

  it("rejects missing or duplicate measurement targets", () => {
    const root = temporaryCorpus();
    writeValidCorpus(root);
    const manifestPath = join(root, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.calibration.targets.push({ ...manifest.calibration.targets[0], anchorSelector: "main\n", name: "main" });
    writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
    const result = validateRealCorpus(root);
    const codes = result.errors.map((error) => error.code);
    expect(codes).toContain("calibration_target_duplicate");
    expect(codes).toContain("calibration_selector_invalid");
  });
});
