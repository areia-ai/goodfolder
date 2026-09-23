/**
 * The bench upstream, in its own process so its memory never mixes with the
 * proxy's. Wraps `git http-backend` over a bare repo under the directory
 * given as argv[2], prints the listen URL on stdout, then serves.
 *
 *   node --experimental-transform-types bench-upstream.mts <dir>
 */

import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

const dir = process.argv[2]!;
const PROJECT = "11111111-1111-1111-1111-111111111111";
const bare = join(dir, `${PROJECT}.git`);
execFileSync("git", ["init", "-q", "--bare", bare]);
execFileSync("git", ["-C", bare, "config", "http.receivepack", "true"]);
execFileSync("git", ["-C", bare, "config", "receive.advertisePushOptions", "true"]);

const server = createServer((req, res) => {
  const u = new URL(req.url ?? "/", "http://x");
  const child = spawn("git", ["http-backend"], {
    env: {
      ...process.env,
      GIT_PROJECT_ROOT: dir,
      GIT_HTTP_EXPORT_ALL: "",
      PATH_INFO: u.pathname.replace(/^\/gf-service/, ""),
      QUERY_STRING: u.search.slice(1),
      REQUEST_METHOD: req.method ?? "GET",
      CONTENT_TYPE: (req.headers["content-type"] as string) ?? "",
      CONTENT_LENGTH: (req.headers["content-length"] as string) ?? "",
      REMOTE_USER: "gf-service",
    },
  });
  req.pipe(child.stdin);
  const out: Buffer[] = [];
  child.stdout.on("data", (c) => out.push(c));
  child.on("close", () => {
    const raw = Buffer.concat(out);
    const sep = raw.indexOf("\r\n\r\n");
    if (sep < 0) {
      res.writeHead(502);
      res.end();
      return;
    }
    const head = raw.subarray(0, sep).toString();
    const headers: Record<string, string> = {};
    let status = 200;
    for (const line of head.split(/\r?\n/)) {
      const i = line.indexOf(":");
      if (i <= 0) continue;
      const name = line.slice(0, i).trim();
      if (/^status$/i.test(name)) status = Number(line.slice(i + 1).split(" ")[0]) || 200;
      else headers[name] = line.slice(i + 1).trim();
    }
    res.writeHead(status, headers);
    res.end(raw.subarray(sep + 4));
  });
});
server.listen(0, "127.0.0.1", () => {
  process.stdout.write(`http://127.0.0.1:${(server.address() as AddressInfo).port}\n`);
});
