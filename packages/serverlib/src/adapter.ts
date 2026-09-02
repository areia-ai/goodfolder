import type { ServerConfig } from "./config.ts";

/**
 * Repository adapter — the ONLY code that talks to Gitea.
 * Narrow surface by design (TECHNICAL_PROPOSAL.md): swapping Gitea for
 * git-http-backend later means reimplementing this file and nothing else.
 *
 * Repos are owned by the single service account; per-project authorization
 * is enforced by GoodFolder's middleware BEFORE any request reaches here.
 */

/** What the engine hands back per request, and how far this will read. */
const TREE_PAGE_SIZE = 1000;
export const TREE_ENTRY_CAP = 25_000;

/** One file's part in a change. A rename is a `write` and a `remove` together. */
export type FileChange =
  | { operation: "write"; path: string; content: Buffer }
  | { operation: "remove"; path: string };

export class RepositoryAdapter {
  constructor(private cfg: ServerConfig) {}

  private authHeader(): string {
    const raw = `${this.cfg.giteaAdminUser}:${this.cfg.giteaAdminPassword}`;
    return `Basic ${Buffer.from(raw).toString("base64")}`;
  }

  private api(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${this.cfg.giteaInternalUrl}/api/v1${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: this.authHeader(),
        ...(init?.headers ?? {}),
      },
    });
  }

  /** Create the backing repo for a project. Idempotent. */
  async ensureRepo(projectId: string): Promise<{ created: boolean }> {
    const res = await this.api("/user/repos", {
      method: "POST",
      body: JSON.stringify({
        name: projectId,
        private: true,
        auto_init: false,
        default_branch: "main",
      }),
    });
    if (res.status === 201) return { created: true };
    // Gitea returns 409 when the repo name already exists.
    if (res.status === 409) return { created: false };
    const body = await res.text();
    throw new Error(`ensureRepo failed (${res.status}): ${body.slice(0, 300)}`);
  }

  async repoExists(projectId: string): Promise<boolean> {
    const res = await this.api(
      `/repos/${encodeURIComponent(this.cfg.giteaAdminUser)}/${projectId}`,
    );
    return res.ok;
  }

  /** Remove one backing store during an authorized permanent cleanup. */
  async deleteRepo(projectId: string): Promise<void> {
    const res = await this.api(this.repoPath(projectId), { method: "DELETE" });
    if (res.status === 404 || res.status === 204) return;
    if (!res.ok) throw new Error(`deleteRepo failed (${res.status})`);
  }

  /** Gitea's repository `size` field is kibibytes. Normalize it to bytes. */
  async repositorySizeBytes(projectId: string): Promise<number> {
    const res = await this.api(this.repoPath(projectId));
    if (res.status === 404) return 0;
    if (!res.ok) throw new Error(`repositorySizeBytes failed (${res.status})`);
    const body = await res.json() as { size?: number };
    return normalizeGiteaRepositorySize(body.size);
  }

  private repoPath(projectId: string): string {
    return `/repos/${encodeURIComponent(this.cfg.giteaAdminUser)}/${encodeURIComponent(projectId)}`;
  }

  async head(projectId: string): Promise<string | null> {
    const res = await this.api(`${this.repoPath(projectId)}/branches/main`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`head failed (${res.status})`);
    const body = (await res.json()) as { commit?: { id?: string } };
    return body.commit?.id ?? null;
  }

  /**
   * Every path in the project, not the first page of them.
   *
   * The engine hands back a thousand at a time. Stopping at the first page
   * would mean the browser's checks — above all the one that refuses a pair
   * of names differing only in case — judged a folder they had only partly
   * seen, and passed. So this reads to the end, and past TREE_ENTRY_CAP it
   * says so out loud rather than answering with a part of the truth.
   */
  async tree(projectId: string, ref = "main"): Promise<Array<{
    path: string;
    type: "blob" | "tree";
    size: number;
    sha: string;
  }>> {
    const found = new Map<string, { path: string; type: "blob" | "tree"; size: number; sha: string }>();
    for (let page = 1; page <= TREE_ENTRY_CAP / TREE_PAGE_SIZE; page += 1) {
      const res = await this.api(
        `${this.repoPath(projectId)}/git/trees/${encodeURIComponent(ref)}?recursive=true&per_page=${TREE_PAGE_SIZE}&page=${page}`,
      );
      // Gitea answers 400 when an empty project has no main tree yet.
      if (res.status === 400 || res.status === 404) return [...found.values()];
      if (!res.ok) throw new Error(`tree failed (${res.status})`);
      const body = (await res.json()) as {
        tree?: Array<{ path?: string; type?: string; size?: number; sha?: string }>;
        truncated?: boolean;
      };
      const returned = body.tree ?? [];
      const before = found.size;
      for (const item of returned) {
        if (!item.path || (item.type !== "blob" && item.type !== "tree")) continue;
        found.set(item.path, {
          path: item.path,
          type: item.type,
          size: Number(item.size ?? 0),
          sha: item.sha ?? "",
        });
      }
      // Three ways to know there is no more to read, so this does not depend
      // on any one of them being reported the way it is documented.
      if (returned.length < TREE_PAGE_SIZE) return [...found.values()];
      if (body.truncated === false) return [...found.values()];
      if (found.size === before) return [...found.values()];
    }
    const error = new Error("folder-too-large") as Error & { code?: string };
    error.code = "folder-too-large";
    throw error;
  }

  async readFile(
    projectId: string,
    path: string,
    ref = "main",
  ): Promise<{ content: Buffer; sha: string; size: number } | null> {
    const res = await this.api(
      `${this.repoPath(projectId)}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`,
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`readFile failed (${res.status})`);
    const body = (await res.json()) as {
      content?: string;
      encoding?: string;
      sha?: string;
      size?: number;
      type?: string;
    };
    if (body.type !== "file" || body.encoding !== "base64" || body.content == null) return null;
    return {
      content: Buffer.from(body.content.replace(/\s/g, ""), "base64"),
      sha: body.sha ?? "",
      size: Number(body.size ?? 0),
    };
  }

  async writeFile(input: {
    projectId: string;
    path: string;
    content: Buffer;
    message: string;
    expectedHead: string | null;
  }): Promise<{ commitSha: string }> {
    const currentHead = await this.head(input.projectId);
    if (currentHead !== input.expectedHead) {
      const error = new Error("newer-work") as Error & { code?: string };
      error.code = "newer-work";
      throw error;
    }
    const existing = await this.readFile(input.projectId, input.path);
    const body: Record<string, unknown> = {
      branch: "main",
      message: input.message,
      content: input.content.toString("base64"),
    };
    if (existing?.sha) body.sha = existing.sha;
    const res = await this.api(
      `${this.repoPath(input.projectId)}/contents/${input.path.split("/").map(encodeURIComponent).join("/")}`,
      { method: existing ? "PUT" : "POST", body: JSON.stringify(body) },
    );
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`writeFile failed (${res.status}): ${detail.slice(0, 200)}`);
    }
    const response = (await res.json()) as { commit?: { sha?: string } };
    const commitSha = response.commit?.sha;
    if (!commitSha) throw new Error("writeFile returned no save id");
    return { commitSha };
  }

  /**
   * Several files changed in one save.
   *
   * A rename is a file arriving and a file leaving; done as two writes there
   * is a moment where the folder holds both or neither, and whoever syncs in
   * that moment gets it. One call, one save, no moment.
   *
   * The engine also offers a rename of its own, which would spare re-sending
   * the bytes. It is not used: this shape works on every version and can be
   * checked against one, which a rename that only newer engines understand
   * could not be.
   */
  async changeFiles(input: {
    projectId: string;
    changes: readonly FileChange[];
    message: string;
    expectedHead: string | null;
  }): Promise<{ commitSha: string }> {
    if (input.changes.length === 0) throw new Error("changeFiles was asked to change nothing");
    const currentHead = await this.head(input.projectId);
    if (currentHead !== input.expectedHead) {
      const error = new Error("newer-work") as Error & { code?: string };
      error.code = "newer-work";
      throw error;
    }
    // One read of the whole folder rather than one per file: what each
    // change needs from it is the name the engine knows the old bytes by.
    const known = new Map(
      (await this.tree(input.projectId))
        .filter((entry) => entry.type === "blob")
        .map((entry) => [entry.path, entry.sha]),
    );
    const files = input.changes.map((change) => {
      const sha = known.get(change.path);
      if (change.operation === "remove") {
        if (!sha) throw new Error(`changeFiles cannot take out a file that isn't there: ${change.path}`);
        return { operation: "delete", path: change.path, sha };
      }
      return {
        operation: sha ? "update" : "create",
        path: change.path,
        content: change.content.toString("base64"),
        ...(sha ? { sha } : {}),
      };
    });
    const res = await this.api(`${this.repoPath(input.projectId)}/contents`, {
      method: "POST",
      body: JSON.stringify({ branch: "main", message: input.message, files }),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`changeFiles failed (${res.status}): ${detail.slice(0, 200)}`);
    }
    const response = (await res.json()) as { commit?: { sha?: string } };
    const commitSha = response.commit?.sha;
    if (!commitSha) throw new Error("changeFiles returned no save id");
    return { commitSha };
  }
}

export function normalizeGiteaRepositorySize(sizeKiB: unknown): number {
  const value = Number(sizeKiB ?? 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value * 1024);
}
