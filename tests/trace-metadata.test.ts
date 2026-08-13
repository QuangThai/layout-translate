import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyFailure,
  extractRequestId,
  readTraceMetadata,
} from "../scripts/trace-metadata.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

describe("content-free trace metadata", () => {
  it("fingerprints the source tree, lockfile, and built inputs without page text", () => {
    const trace = readTraceMetadata({
      repositoryRoot,
      argv: ["node", "scripts/e2e-smoke.mjs"],
      inputPaths: { dataset: resolve(repositoryRoot, "benchmarks/translation-cases.json") },
    });

    expect(trace.node).toMatch(/^v\d+/u);
    expect(trace.npm).toMatch(/^\d+\.\d+\.\d+/u);
    expect(trace.repository.revision).toMatch(/^[a-f0-9]{40}$/u);
    expect(trace.repository.workingTreeSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(trace.packageLock?.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(trace.inputs.dataset?.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(trace)).not.toContain("会社情報");
  });

  it("keeps failure diagnostics classified and request correlation opaque", () => {
    expect(classifyFailure(new Error("CDP call timed out: Page.captureScreenshot"))).toBe("timeout");
    expect(classifyFailure(new Error("E2E assertion failed: source"))).toBe("assertion");
    expect(extractRequestId("Translation backend rejected request: unauthorized [request_id:req-123]")).toBe("req-123");
    expect(extractRequestId("Translation backend request timed out")).toBeNull();
  });
});
