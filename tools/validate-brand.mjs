import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const svgPaths = [
  path.join(root, "apps/web/app/icon.svg"),
  path.join(root, "apps/web/app/apple-icon.svg"),
];
const publicBrand = path.join(root, "apps/web/public/brand");
if (fs.existsSync(publicBrand)) {
  for (const name of fs.readdirSync(publicBrand).filter((entry) => entry.endsWith(".svg"))) {
    svgPaths.push(path.join(publicBrand, name));
  }
}

const allowedColors = new Set(["#3b82f6", "#ffffff", "#000000", "none"]);
const forbidden = /<(?:script|image|text|foreignObject|style|filter|linearGradient|radialGradient|pattern|use)\b|(?:href|xlink:href)\s*=|url\(|data:image|@font-face/i;

function attributes(tag) {
  const attrs = new Map();
  for (const match of tag.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*["']([^"']*)["']/g)) attrs.set(match[1].toLowerCase(), match[2]);
  return attrs;
}

function validateSvg(filePath) {
  const source = fs.readFileSync(filePath, "utf8").trim();
  if (!source.startsWith("<svg") || !source.endsWith("</svg>")) throw new Error("must have one svg root");
  if (!/\bviewBox\s*=\s*["'][^"']+["']/i.test(source)) throw new Error("missing viewBox");
  if (forbidden.test(source)) throw new Error("contains a forbidden live dependency or external reference");
  if (/<(?!\/?(?:svg|path)\b)/i.test(source)) throw new Error("artwork must contain only path elements");

  const rootTag = source.match(/^<svg\b[^>]*>/i)?.[0];
  if (!rootTag) throw new Error("malformed svg root");
  const rootAttrs = attributes(rootTag);
  if (!rootAttrs.get("viewbox")) throw new Error("missing viewBox");

  for (const match of source.matchAll(/\b(fill|stroke)\s*=\s*["']([^"']+)["']/gi)) {
    const value = match[2].trim().toLowerCase();
    if (!allowedColors.has(value)) throw new Error(`unsupported ${match[1]} color ${match[2]}`);
  }
  for (const match of source.matchAll(/\bstyle\s*=\s*["']([^"']+)["']/gi)) {
    for (const color of match[1].matchAll(/(?:fill|stroke)\s*:\s*([^;]+)/gi)) {
      if (!allowedColors.has(color[1].trim().toLowerCase())) throw new Error(`unsupported style color ${color[1]}`);
    }
  }
  const paths = [...source.matchAll(/<path\b[^>]*>/gi)];
  if (paths.length === 0) throw new Error("artwork has no paths");
  for (const pathTag of paths) {
    if (!/\bd\s*=\s*["'][^"']+\S[^"']*["']/i.test(pathTag[0])) throw new Error("path is missing geometry");
  }

  const stack = [];
  for (const match of source.matchAll(/<\/?([A-Za-z][\w:.-]*)(?:\s[^<>]*?)?\/?\s*>/g)) {
    const token = match[0];
    const name = match[1].toLowerCase();
    if (token.startsWith("</")) {
      if (stack.pop() !== name) throw new Error(`mismatched closing tag ${name}`);
    } else if (!token.endsWith("/>") && name !== "path") {
      stack.push(name);
    }
  }
  if (stack.length !== 0) throw new Error(`unclosed tag ${stack.at(-1)}`);
}

let failed = false;
for (const filePath of svgPaths) {
  try {
    validateSvg(filePath);
    console.log(`brand svg: ${path.relative(root, filePath)} ✓`);
  } catch (error) {
    failed = true;
    console.error(`brand svg: ${path.relative(root, filePath)} ✗ ${(error).message}`);
  }
}
if (failed) process.exitCode = 1;
