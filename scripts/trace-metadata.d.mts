export interface TraceFile {
  path: string;
  sha256: string;
  byteCount: number;
  fileCount: number;
}

export interface TraceMetadata {
  command: string;
  argv: string[];
  cwd: string;
  node: string;
  npm: string | null;
  npmLifecycleEvent: string | null;
  repository: {
    revision: string | null;
    branch: string | null;
    dirty: boolean | null;
    changedPathCount: number | null;
    statusEntryCount: number | null;
    trackedChangedFileCount: number | null;
    untrackedFileCount: number | null;
    workingTreeSha256: string | null;
  };
  packageLock: TraceFile | null;
  inputs: Record<string, TraceFile | null>;
  artifacts: Record<string, TraceFile | null>;
}

export function classifyFailure(error: unknown): string;
export function extractRequestId(value: unknown): string | null;
export function readGitTrace(repositoryRoot: string): TraceMetadata["repository"];
export function readTraceMetadata(options: {
  repositoryRoot: string;
  argv?: string[];
  inputPaths?: Record<string, string>;
  artifactPaths?: Record<string, string>;
}): TraceMetadata;
export function removeOwnedArtifacts(paths: string[]): { removedCount: number; failureCount: number };
