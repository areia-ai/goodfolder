import { spawn, spawnSync } from "node:child_process";
import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

// Git output is captured through TEMP FILES, never pipes. Reason: git spawns
// long-lived helpers of its own (the fsmonitor daemon above all), and those
// inherit whatever stdout/stderr descriptors git had. With pipes, a helper
// holding the write end means Node waits for an EOF that never arrives —
// the git command finished long ago but the call hangs forever. Files don't
// care who keeps them open; we read them after exit.

interface TempCapture {
  fds: [number, number];
  paths: [string, string];
}

function tempCapture(): TempCapture {
  const base = join(
    tmpdir(),
    `gf-git-${process.pid}-${Math.random().toString(36).slice(2)}`,
  );
  const paths: [string, string] = [`${base}.out`, `${base}.err`];
  writeFileSync(paths[0], "");
  writeFileSync(paths[1], "");
  return { fds: [openSync(paths[0], "r+"), openSync(paths[1], "r+")], paths };
}

function finishCapture(cap: TempCapture): void {
  for (const fd of cap.fds) {
    try {
      closeSync(fd);
    } catch {
      /* already closed */
    }
  }
  for (const p of cap.paths) {
    try {
      unlinkSync(p);
    } catch {
      /* best effort */
    }
  }
}

/** Run a git command in a folder. Never throws; callers decide on failure. */
export function git(cwd: string, args: string[], input?: string): GitResult {
  const cap = tempCapture();
  try {
    // Only commands fed on stdin open one; everything else keeps stdin shut,
    // so a command that decides to prompt fails fast instead of hanging.
    const r = spawnSync("git", args, {
      cwd,
      stdio: [input === undefined ? "ignore" : "pipe", ...cap.fds],
      ...(input === undefined ? {} : { input }),
    });
    const stdout = readFileSync(cap.paths[0], "utf8");
    let stderr = readFileSync(cap.paths[1], "utf8");
    if (r.error && !stderr) stderr = String(r.error.message ?? "spawn failed");
    return { code: r.status ?? 1, stdout, stderr };
  } finally {
    finishCapture(cap);
  }
}

export function gitOk(cwd: string, args: string[]): boolean {
  return git(cwd, args).code === 0;
}

/** Find the .git directory (absolute) for a folder, or null. */
export function findGitDir(folder: string): string | null {
  const r = git(folder, ["rev-parse", "--absolute-git-dir"]);
  return r.code === 0 ? r.stdout.trim() : null;
}

function readFileNow(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/**
 * Promise-based variant. Same temp-file discipline as `git`: a helper
 * process outliving the command can never stall completion.
 */
export function gitAsync(cwd: string, args: string[]): Promise<GitResult> {
  const cap = tempCapture();
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", ...cap.fds] });
    child.on("close", (code) => {
      const result: GitResult = {
        code: code ?? 1,
        stdout: readFileNow(cap.paths[0]),
        stderr: readFileNow(cap.paths[1]),
      };
      finishCapture(cap);
      resolve(result);
    });
    child.on("error", () => {
      const result: GitResult = {
        code: 1,
        stdout: readFileNow(cap.paths[0]),
        stderr: readFileNow(cap.paths[1]) || "spawn failed",
      };
      finishCapture(cap);
      resolve(result);
    });
  });
}

export interface GitAsyncResult extends GitResult {
  /** Kill the child (used for SIGINT handling by callers). */
  kill: () => void;
}

/**
 * Async git run that streams progress from stderr. Progress fragments are
 * polled from the capture file (`\r`-separated), which keeps the same
 * helper-proof guarantee as every other runner here while still feeding
 * single-line progress renderers.
 */
export function gitStream(
  cwd: string,
  args: string[],
  onProgress?: (fragment: string) => void,
): { done: Promise<GitAsyncResult>; kill: () => void } {
  const base = join(
    tmpdir(),
    `gf-git-${process.pid}-${Math.random().toString(36).slice(2)}`,
  );
  const outPath = `${base}.out`;
  const errPath = `${base}.err`;
  writeFileSync(outPath, "");
  writeFileSync(errPath, "");
  const outFd = openSync(outPath, "r+");
  const errFd = openSync(errPath, "r+");
  let errCursor = 0;

  const child = spawn("git", args, { cwd, stdio: ["ignore", outFd, errFd] });
  const kill = () => child.kill("SIGTERM");

  const poller =
    onProgress && process.platform !== "win32"
      ? setInterval(() => {
          const text = readFileNow(errPath);
          if (text.length <= errCursor) return;
          const fresh = text.slice(errCursor);
          errCursor = text.length;
          for (const frag of fresh.split(/[\r\n]/)) {
            const t = frag.trim();
            if (t) onProgress(t);
          }
        }, 120)
      : null;

  const done = new Promise<GitAsyncResult>((resolve) => {
    child.on("close", (code) => {
      if (poller) clearInterval(poller);
      const stderr = readFileNow(errPath);
      if (poller && onProgress) {
        // Emit anything the final poll missed.
        const rest = stderr.slice(errCursor);
        for (const frag of rest.split(/[\r\n]/)) {
          const t = frag.trim();
          if (t) onProgress(t);
        }
      }
      const result: GitAsyncResult = {
        code: code ?? 1,
        stdout: readFileNow(outPath),
        stderr,
        kill,
      };
      try {
        closeSync(outFd);
        closeSync(errFd);
        unlinkSync(outPath);
        unlinkSync(errPath);
      } catch {
        /* best effort */
      }
      resolve(result);
    });
    child.on("error", () => {
      if (poller) clearInterval(poller);
      const result: GitAsyncResult = {
        code: 1,
        stdout: readFileNow(outPath),
        stderr: readFileNow(errPath) || "spawn failed",
        kill,
      };
      try {
        closeSync(outFd);
        closeSync(errFd);
        unlinkSync(outPath);
        unlinkSync(errPath);
      } catch {
        /* best effort */
      }
      resolve(result);
    });
  });

  return { done, kill };
}
