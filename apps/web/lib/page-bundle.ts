// Turning a web page in a folder into one page that can stand on its own.
//
// The dashboard renders a page inside a frame with no address of its own, so
// nothing the page points at resolves: `style.css` is not a place, and there
// is no origin to ask for it. Everything a page needs therefore has to be
// carried inside it before it is handed over — read out of the folder, and
// written back in as `data:` addresses, which resolve anywhere.
//
// `data:` and not `blob:`, and that is not a preference. The frame is denied
// a same-origin identity (see page-frame.ts for why), and an object address
// minted by this page belongs to this page's origin — a frame with no origin
// cannot read one. `data:` carries its own bytes and belongs to nobody.
//
// What this deliberately does not do: bundle a page's own imports. A module
// that imports another module by a relative path is left alone and named in
// the report, because rewriting inside JavaScript means parsing JavaScript,
// and a wrong rewrite there breaks a working page silently.

import { isRenderablePage } from "./preview.ts";
import {
  attributeOf,
  removeAttribute,
  renderHtml,
  setAttribute,
  tokenizeHtml,
  type HtmlToken,
} from "./page-html.ts";

/** Bytes written into the page itself before the rest is left out. */
export const PAGE_BUNDLE_BYTE_BUDGET = 8_000_000;

/**
 * At or above this, a file named by a markup attribute is not written into
 * the page at all.
 *
 * A film carried as base64 is a third larger than the film, and the whole of
 * it has to be parsed as part of the document before anything at all appears.
 * A 1.6 MB walk-through took about twenty-five seconds to open that way. So
 * anything this size is left for the frame to ask for once it is running: the
 * dashboard hands over the bytes, and the frame makes an address for them out
 * of its own origin, which it is allowed to read. The page then streams and
 * seeks like any other video.
 *
 * `url()` inside a stylesheet is deliberately not treated this way — there is
 * no element to hang a later address on — so a very large background picture
 * is still written in, and still bounded by the budget above.
 */
export const STREAM_BYTE_FLOOR = 128_000;

/**
 * Elements whose file may arrive after the page has started.
 *
 * Deliberately not `script` or `link`: a stylesheet that arrives late is a
 * flash of the wrong page, and a script that arrives late does not run at
 * all, because nothing re-executes it. Those are always written in, however
 * big they are — bounded only by the budget.
 */
const STREAMABLE = new Set([
  "img", "video", "audio", "source", "track", "embed", "object", "iframe", "input",
]);

/** How far `@import` inside a stylesheet is followed. */
const CSS_IMPORT_DEPTH = 4;

export interface PageFileReader {
  /** Every file the folder holds, with its size — so a reference that names
   *  nothing is known to be missing, and one that names something far too
   *  big is left out, both without asking the server for anything. */
  files: ReadonlyArray<{ path: string; size: number }>;
  readText(path: string): Promise<string | null>;
  readBytes(path: string): Promise<Uint8Array | null>;
}

export interface PageBundle {
  /** The whole page, ready to be handed to a frame. */
  html: string;
  /** Folder paths that were read and carried in. */
  included: string[];
  /** Folder paths left for the frame to ask for once it is running. */
  streamed: string[];
  /** References that named nothing in the folder. */
  missing: string[];
  /** Addresses left for the network to answer, exactly as the page wrote them. */
  external: string[];
  /** Files left out because the budget ran out first. */
  omitted: string[];
  /** What was read, in bytes. */
  bytes: number;
}

/* ------------------------------------------------------------------ paths */

function directoryOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "" : path.slice(0, cut);
}

/** `a/b` + `../c/./d.png` → `a/c/d.png`; null when it climbs out of the folder. */
function normalize(segments: string[]): string | null {
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.join("/");
}

/**
 * Where a reference points, as a folder path, given the directory it was
 * written in.
 *
 * Returns null for anything that is not a place in this folder: an anchor, an
 * address with a scheme, a protocol-relative address, or a path that climbs
 * out above the folder's own root. A leading `/` means the folder's root, not
 * the computer's.
 */
export function resolveIn(directory: string, reference: string): string | null {
  const trimmed = reference.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  if (trimmed.startsWith("//")) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return null;
  const withoutFragment = trimmed.split("#")[0]!.split("?")[0]!;
  if (!withoutFragment) return null;
  let decoded = withoutFragment;
  try {
    decoded = decodeURIComponent(withoutFragment);
  } catch {
    /* a reference that is not valid percent-encoding is taken as written */
  }
  const from = decoded.startsWith("/") ? [] : directory.split("/");
  return normalize([...from, ...decoded.split("/")]);
}

/** The same, for a reference written inside the file at `fromPath`. */
export function resolveFolderPath(fromPath: string, reference: string): string | null {
  return resolveIn(directoryOf(fromPath), reference);
}

/* ------------------------------------------------------------------ bytes */

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Base64 without Buffer or atob, so the same code runs in a test and a tab. */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += BASE64[a >> 2]! + BASE64[((a & 3) << 4) | (b >> 4)]!;
    out += i + 1 < bytes.length ? BASE64[((b & 15) << 2) | (c >> 6)]! : "=";
    out += i + 2 < bytes.length ? BASE64[c & 63]! : "=";
  }
  return out;
}

const MIMES: Record<string, string> = {
  css: "text/css", js: "text/javascript", mjs: "text/javascript", cjs: "text/javascript",
  json: "application/json", map: "application/json", txt: "text/plain", csv: "text/csv",
  html: "text/html", htm: "text/html", xml: "application/xml", svg: "image/svg+xml",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", bmp: "image/bmp", ico: "image/x-icon",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", eot: "application/vnd.ms-fontobject",
  mp4: "video/mp4", webm: "video/webm", ogv: "video/ogg", mov: "video/quicktime",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg", flac: "audio/flac",
  pdf: "application/pdf", wasm: "application/wasm", vtt: "text/vtt",
};

/** Content type for a carried file; `application/octet-stream` when unknown. */
export function assetMimeFor(path: string): string {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "application/octet-stream";
  return MIMES[base.slice(dot + 1).toLowerCase()] ?? "application/octet-stream";
}

function isText(path: string): boolean {
  const mime = assetMimeFor(path);
  return mime.startsWith("text/") || mime === "application/json" || mime === "application/xml";
}

function dataUri(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

/* -------------------------------------------------------------------- css */

/** Every `url(...)` and `@import` a stylesheet points at, replaced in place. */
async function rewriteCss(
  css: string,
  directory: string,
  carry: (path: string) => Promise<string | null>,
  depth: number,
): Promise<string> {
  const jobs: Array<Promise<void>> = [];
  const swaps = new Map<string, string>();
  const seen = new Set<string>();

  const note = (reference: string) => {
    if (seen.has(reference)) return;
    seen.add(reference);
    const target = resolveIn(directory, reference);
    if (!target) return;
    jobs.push(
      (async () => {
        const uri = await carry(target);
        if (uri) swaps.set(reference, uri);
      })(),
    );
  };

  const URL_CALL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]+))\s*\)/g;
  const IMPORT = /@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)')\s*\)?/g;
  for (const match of css.matchAll(URL_CALL)) note(match[1] ?? match[2] ?? match[3] ?? "");
  if (depth > 0) for (const match of css.matchAll(IMPORT)) note(match[1] ?? match[2] ?? "");
  await Promise.all(jobs);

  return css.replace(URL_CALL, (whole, a?: string, b?: string, c?: string) => {
    const reference = a ?? b ?? c ?? "";
    const swap = swaps.get(reference);
    return swap ? `url("${swap}")` : whole;
  }).replace(IMPORT, (whole, a?: string, b?: string) => {
    const reference = a ?? b ?? "";
    const swap = swaps.get(reference);
    return swap ? `@import url("${swap}")` : whole;
  });
}

/* ----------------------------------------------------------------- markup */

/** Attributes that name another file, by element. */
const REFERENCE_ATTRIBUTES: Record<string, readonly string[]> = {
  link: ["href"],
  script: ["src"],
  img: ["src"],
  source: ["src"],
  video: ["src", "poster"],
  audio: ["src"],
  track: ["src"],
  embed: ["src"],
  object: ["data"],
  iframe: ["src"],
  input: ["src"],
  image: ["href", "xlink:href"],
  use: ["href", "xlink:href"],
};

/** Elements whose address is a place to go, not a thing to carry. */
const NAVIGATION = new Set(["a", "area"]);

function splitSrcset(value: string): Array<{ url: string; descriptor: string }> {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const space = entry.search(/\s/);
      return space === -1
        ? { url: entry, descriptor: "" }
        : { url: entry.slice(0, space), descriptor: entry.slice(space) };
    });
}

/* ------------------------------------------------------------------ build */

export interface BundleOptions {
  /** Read as much as this before leaving the rest out. */
  budget?: number;
  /** Put in front of the page's own scripts; see page-frame.ts. */
  runtime?: string;
}

/**
 * Read one page and everything in the folder it points at, and give back a
 * page that needs nothing else.
 */
export async function bundlePage(
  entryPath: string,
  html: string,
  reader: PageFileReader,
  options: BundleOptions = {},
): Promise<PageBundle> {
  const budget = options.budget ?? PAGE_BUNDLE_BYTE_BUDGET;
  const sizes = new Map(reader.files.map((file) => [file.path, file.size]));
  const included = new Set<string>();
  const streamed = new Set<string>();
  const missing = new Set<string>();
  const external = new Set<string>();
  const omitted = new Set<string>();
  const carried = new Map<string, Promise<string | null>>();
  let bytes = 0;

  /**
   * Read one file, once, and say how it was handled: written into the page as
   * a `data:` address, or left for the frame to ask for.
   */
  function carry(path: string, cssDepth = CSS_IMPORT_DEPTH): Promise<string | null> {
    const existing = carried.get(path);
    if (existing) return existing;
    const job = (async (): Promise<string | null> => {
      const size = sizes.get(path);
      if (size === undefined) {
        missing.add(path);
        return null;
      }
      // Checked before anything is read: a page pointing at a film should not
      // pull half a gigabyte through the browser to find out it was too big.
      if (bytes + size > budget) {
        omitted.add(path);
        return null;
      }
      if (isText(path)) {
        const text = await reader.readText(path);
        if (text === null) {
          missing.add(path);
          return null;
        }
        const encoded = new TextEncoder().encode(text);
        bytes += encoded.byteLength;
        included.add(path);
        if (assetMimeFor(path) === "text/css") {
          const rewritten = await rewriteCss(
            text,
            directoryOf(path),
            (next) => carry(next, cssDepth - 1),
            cssDepth,
          );
          return dataUri("text/css", new TextEncoder().encode(rewritten));
        }
        return dataUri(assetMimeFor(path), encoded);
      }
      const raw = await reader.readBytes(path);
      if (raw === null) {
        missing.add(path);
        return null;
      }
      bytes += raw.byteLength;
      included.add(path);
      return dataUri(assetMimeFor(path), raw);
    })();
    carried.set(path, job);
    return job;
  }

  const tokens = tokenizeHtml(html);

  // A page may move its own root with <base>. Everything after this resolves
  // against that instead. A <base> pointing somewhere on the web puts every
  // relative address out of this folder's reach, and they are left alone.
  let baseDir = directoryOf(entryPath);
  let baseIsElsewhere = false;
  for (const token of tokens) {
    if (token.kind !== "tag" || token.name !== "base" || token.closing) continue;
    const href = attributeOf(token, "href");
    if (!href) continue;
    if (/^([a-zA-Z][a-zA-Z0-9+.-]*:|\/\/)/.test(href.trim())) {
      baseIsElsewhere = true;
      break;
    }
    const moved = resolveIn(baseDir, href.endsWith("/") ? href.slice(0, -1) : href);
    if (moved !== null) baseDir = moved;
    break;
  }

  const jobs: Array<Promise<void>> = [];
  const swap = (
    token: Extract<HtmlToken, { kind: "tag" }>,
    attribute: string,
    reference: string,
  ) => {
    const target = baseIsElsewhere ? null : resolveIn(baseDir, reference);
    if (target === null) {
      external.add(reference.trim());
      return;
    }
    const size = sizes.get(target);
    if (
      STREAMABLE.has(token.name) &&
      size !== undefined &&
      size >= STREAM_BYTE_FLOOR &&
      size <= budget
    ) {
      // Too big to write into the document. The address the frame will use is
      // one only the frame can make, so it is named here and resolved there;
      // the one the page wrote resolves to nothing and would only fail loudly.
      streamed.add(target);
      included.add(target);
      bytes += size;
      setAttribute(token, `data-gf-${attribute}`, target);
      removeAttribute(token, attribute);
      return;
    }
    jobs.push(
      (async () => {
        const uri = await carry(target);
        if (uri) setAttribute(token, attribute, uri);
      })(),
    );
  };

  for (const token of tokens) {
    if (token.kind !== "tag" || token.closing) continue;

    const style = attributeOf(token, "style");
    if (style && style.includes("url(")) {
      jobs.push(
        (async () => {
          const rewritten = await rewriteCss(style, baseDir, (path) => carry(path), 0);
          if (rewritten !== style) setAttribute(token, "style", rewritten);
        })(),
      );
    }

    if (NAVIGATION.has(token.name)) {
      // A link stays a link. The frame's runtime hands a local one back to the
      // dashboard, which reads that page from the folder the same way as this
      // one — so a site of several pages is walked, not flattened into one.
      const href = attributeOf(token, "href");
      if (href) {
        const target = baseIsElsewhere ? null : resolveIn(baseDir, href);
        // Only another page: the frame walks to those. A link to a file of
        // any other kind stays exactly as written rather than being turned
        // into bytes nobody asked to carry.
        if (target !== null && sizes.has(target) && isRenderablePage(target)) {
          setAttribute(token, "data-gf-page", target);
        }
      }
      continue;
    }

    for (const attribute of REFERENCE_ATTRIBUTES[token.name] ?? []) {
      const value = attributeOf(token, attribute);
      if (value) swap(token, attribute, value);
    }

    const srcset = attributeOf(token, "srcset");
    if (srcset) {
      const entries = splitSrcset(srcset);
      jobs.push(
        (async () => {
          const rebuilt = await Promise.all(
            entries.map(async (entry) => {
              const target = baseIsElsewhere ? null : resolveIn(baseDir, entry.url);
              if (target === null) {
                external.add(entry.url);
                return `${entry.url}${entry.descriptor}`;
              }
              const uri = await carry(target);
              return `${uri ?? entry.url}${entry.descriptor}`;
            }),
          );
          setAttribute(token, "srcset", rebuilt.join(", "));
        })(),
      );
    }
  }

  // Stylesheets written into the page point at their own neighbours too.
  for (let i = 0; i < tokens.length; i += 1) {
    const open = tokens[i]!;
    if (open.kind !== "tag" || open.name !== "style" || open.closing) continue;
    const body = tokens[i + 1];
    if (!body || body.kind !== "text" || !body.raw.includes("url(")) continue;
    jobs.push(
      (async () => {
        body.raw = await rewriteCss(body.raw, baseDir, (path) => carry(path), CSS_IMPORT_DEPTH);
      })(),
    );
  }

  await Promise.all(jobs);
  // A carried stylesheet can pull in more work than the first pass knew about.
  await Promise.all([...carried.values()]);

  let out = renderHtml(tokens);
  if (options.runtime) out = insertRuntime(tokens, options.runtime);

  return {
    html: out,
    included: [...included].sort(),
    streamed: [...streamed].sort(),
    missing: [...missing].sort(),
    external: [...external].sort(),
    omitted: [...omitted].sort(),
    bytes,
  };
}

/**
 * Put the frame's own script in front of the page's.
 *
 * It has to run first — it stands in for the storage a page with no origin
 * cannot have, and a page that reads `localStorage` on its first line would
 * otherwise be broken before anything could help it.
 */
function insertRuntime(tokens: HtmlToken[], runtime: string): string {
  const script = `<script>${runtime}</script>`;
  const head = tokens.findIndex(
    (token) => token.kind === "tag" && token.name === "head" && !token.closing,
  );
  if (head !== -1) {
    const before = renderHtml(tokens.slice(0, head + 1));
    return before + script + renderHtml(tokens.slice(head + 1));
  }
  const html = tokens.findIndex(
    (token) => token.kind === "tag" && token.name === "html" && !token.closing,
  );
  if (html !== -1) {
    const before = renderHtml(tokens.slice(0, html + 1));
    return before + script + renderHtml(tokens.slice(html + 1));
  }
  return script + renderHtml(tokens);
}
