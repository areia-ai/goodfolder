/**
 * A user-facing failure. Commands throw these instead of exiting so the
 * same functions run inside the CLI (prints + exits) and the MCP server
 * (returns the message to the agent).
 */
export class CliError extends Error {
  exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}
