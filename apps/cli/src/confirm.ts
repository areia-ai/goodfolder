import { CliError } from "./cli-error.ts";

/**
 * Commands that ask before doing something call this first. With no
 * terminal to ask in (a script, a pipe, an agent's shell), the answer is
 * never assumed to be "no" — the command stops and says how to say yes.
 */
export function requireTerminalToConfirm(yesCommand: string, alsoTry?: string): void {
  if (process.stdin.isTTY) return;
  throw new CliError(
    "✗ This needs your confirmation, and there's no terminal here to ask in.\n" +
      `  Re-run with --yes to go ahead:  ${yesCommand}` +
      (alsoTry ? `\n  ${alsoTry}` : ""),
    1,
  );
}
