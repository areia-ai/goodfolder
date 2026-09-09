/**
 * What a /git/* request is allowed to be.
 *
 * The proxy attaches the service account's credential to whatever it forwards,
 * so it must only forward the three endpoints the smart HTTP protocol uses.
 * Anything else under the repository path — the engine's own web pages, its
 * raw-file and edit routes — would otherwise be reachable as the service
 * account by anyone holding a folder token. A stock client never asks for
 * those; refusing them costs nothing.
 */

export type TransportRoute = {
  projectId: string;
  /** The part after the project id, starting with a slash. */
  subpath: string;
  /** Whether this request pushes history rather than reading it. */
  isWrite: boolean;
};

const PROJECT_PATH = /^\/git\/([0-9a-f-]{36})(\/.*)$/;

/** The only paths the protocol needs. Everything else is refused. */
const ALLOWED_SUBPATHS = new Set(["/info/refs", "/git-upload-pack", "/git-receive-pack"]);

export function transportRoute(url: URL): TransportRoute | null {
  const match = PROJECT_PATH.exec(url.pathname);
  if (!match) return null;
  const subpath = match[2]!;
  if (!ALLOWED_SUBPATHS.has(subpath)) return null;
  const service = url.searchParams.get("service");
  if (subpath === "/info/refs" && service !== null && service !== "git-upload-pack" && service !== "git-receive-pack") {
    return null;
  }
  return {
    projectId: match[1]!,
    subpath,
    isWrite: subpath === "/git-receive-pack" || service === "git-receive-pack",
  };
}
