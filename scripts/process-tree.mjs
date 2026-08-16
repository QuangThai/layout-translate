import { join } from "node:path";

/**
 * Resolves `taskkill` by absolute path.
 *
 * Node hands its own `PATH` to `CreateProcess`, so a POSIX-style `PATH` from a
 * Git Bash shell leaves Windows unable to find `taskkill`. The failed spawn
 * emits an unhandled `error` event, which previously took down a runner in the
 * middle of cleanup and left the browser running.
 */
export function taskkillCommand() {
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? "C:\\Windows";
  return join(systemRoot, "System32", "taskkill.exe");
}
