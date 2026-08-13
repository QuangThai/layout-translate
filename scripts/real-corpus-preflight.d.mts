export interface RealCorpusPreflightError {
  code: string;
  message: string;
  path?: string;
}

export interface RealCorpusPreflightResult {
  ok: boolean;
  schema: string;
  mode: "baseline" | "translation" | "both";
  corpusRoot: string;
  manifest: {
    schema: string | null;
    status: string | null;
    snapshotId: string | null;
  } | null;
  files: string[];
  errors: RealCorpusPreflightError[];
}

export const REAL_CORPUS_MANIFEST_SCHEMA: string;
export const REAL_CORPUS_PREFLIGHT_SCHEMA: string;
export function validateRealCorpus(corpusRoot: string, options?: { mode?: "baseline" | "translation" | "both" }): RealCorpusPreflightResult;
