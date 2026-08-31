import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const scratch = mkdtempSync(join(tmpdir(), "goodfolder-package-smoke-"));

function run(command, args, cwd = root, input) {
  return execFileSync(command, args, {
    cwd,
    input,
    encoding: "utf8",
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
}

function assertPackageContents(tarball) {
  const files = run("tar", ["-tf", tarball]).trim().split("\n");
  if (!files.includes("package/dist/index.js") || !files.includes("package/README.md")) {
    throw new Error(`Package ${tarball} is missing its executable or README.`);
  }
  if (files.some((file) => file.startsWith("package/src/"))) {
    throw new Error(`Package ${tarball} includes source files instead of only runtime files.`);
  }
}

try {
  run("pnpm", ["--filter", "@goodfolder/cli", "build"]);
  run("pnpm", ["--filter", "@goodfolder/mcp", "build"]);
  run("pnpm", ["--filter", "@goodfolder/cli", "pack", "--pack-destination", scratch]);
  run("pnpm", ["--filter", "@goodfolder/mcp", "pack", "--pack-destination", scratch]);

  const packageFiles = readdirSync(scratch);
  const cliName = packageFiles.find((name) => name.startsWith("goodfolder-cli-"));
  const mcpName = packageFiles.find((name) => name.startsWith("goodfolder-mcp-"));
  if (!cliName || !mcpName) throw new Error("Expected both package tarballs.");
  const cliTarball = join(scratch, cliName);
  const mcpTarball = join(scratch, mcpName);
  assertPackageContents(cliTarball);
  assertPackageContents(mcpTarball);

  const consumer = join(scratch, "consumer");
  mkdirSync(consumer);
  run("npm", ["init", "--yes"], consumer);
  run("npm", ["install", cliTarball, mcpTarball], consumer);
  const bin = join(consumer, "node_modules", ".bin");
  const help = run("node", [join(bin, "goodfolder"), "--help"], consumer);
  if (!help.includes("goodfolder — keep your folder safe")) throw new Error("CLI help did not run from the package tarball.");
  run("node", [join(bin, "goodfolder-mcp")], consumer, "");

  console.log("package smoke: clean install and both executables passed ✓");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
