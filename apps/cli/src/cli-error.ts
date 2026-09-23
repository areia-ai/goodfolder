/**
 * A user-facing failure. Commands throw these instead of exiting so the
 * same functions run inside the CLI (prints + exits) and the MCP server
 * (returns the message to the agent).
 */
/** The structured refusal a push gate sends back, when there is one. */
export interface SaveRefusal {
  code: "left-out" | "unreadable" | "too-large" | string;
  refusalId?: string;
  paths: { path: string; kind: string; pattern: string; reason: string }[];
  total: number;
}

export class CliError extends Error {
  exitCode: number;
  /** Set when the failure was a refused save, so callers can show the shape. */
  refusal?: SaveRefusal;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}
