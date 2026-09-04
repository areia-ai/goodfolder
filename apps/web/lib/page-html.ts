// Reading HTML well enough to rewrite what it points at.
//
// A page in a folder refers to its neighbours the way every web page does —
// `<link href="style.css">`, `<img src="photos/roof.png">`, `url(...)` inside
// a stylesheet. None of those addresses mean anything once the page is put
// inside the isolated frame the dashboard renders it in, because that frame
// has no address of its own to resolve them against. Every reference has to
// be turned into the file's own bytes before the page is handed over.
//
// So this file does one job: take HTML apart far enough to find and replace
// those addresses, and put it back together byte-identical everywhere else.
// It is not a browser's parser and does not try to be — it never builds a
// tree, corrects nothing, and preserves whatever it did not understand.
//
// Why not the browser's own parser, which is right there in `DOMParser`?
// Because then none of this could be tested without a browser, and the part
// most likely to be wrong is the address arithmetic, not the tag scanning.

/** Elements whose content is text, not markup — scanned past, never into. */
const RAW_TEXT = new Set(["script", "style", "textarea", "title"]);

export interface HtmlAttribute {
  name: string;
  /** The value with entities resolved; null for a bare attribute like `defer`. */
  value: string | null;
  /** Exactly as it appeared, so an attribute nobody touched is written back
   *  byte for byte rather than re-quoted and re-escaped into something that
   *  only means the same thing. */
  raw: string;
  /** Set by `setAttribute`; nothing else may write it. */
  changed?: boolean;
}

export type HtmlToken =
  | { kind: "text"; raw: string }
  | { kind: "comment"; raw: string }
  | { kind: "tag"; raw: string; name: string; attributes: HtmlAttribute[]; closing: boolean; selfClosing: boolean };

const NAME_START = /[a-zA-Z]/;
const ATTR_NAME = /[^\s/>=]/;

/**
 * Split HTML into text, comments and tags.
 *
 * Round-trips exactly: joining every token's `raw` gives the input back. That
 * property is what makes the rewrite safe, and there is a test for it.
 */
export function tokenizeHtml(html: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  let i = 0;
  let textFrom = 0;

  const flushText = (until: number) => {
    if (until > textFrom) tokens.push({ kind: "text", raw: html.slice(textFrom, until) });
  };

  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) break;
    const after = html[lt + 1] ?? "";

    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      const stop = end === -1 ? html.length : end + 3;
      flushText(lt);
      tokens.push({ kind: "comment", raw: html.slice(lt, stop) });
      i = textFrom = stop;
      continue;
    }
    if (after === "!" || after === "?") {
      const end = html.indexOf(">", lt);
      const stop = end === -1 ? html.length : end + 1;
      flushText(lt);
      tokens.push({ kind: "comment", raw: html.slice(lt, stop) });
      i = textFrom = stop;
      continue;
    }

    const closing = after === "/";
    const nameAt = lt + (closing ? 2 : 1);
    if (!NAME_START.test(html[nameAt] ?? "")) {
      // A bare `<` in prose, or `if (a<b)`. Not a tag; leave it in the text.
      i = lt + 1;
      continue;
    }

    let j = nameAt;
    while (j < html.length && /[^\s/>]/.test(html[j]!)) j += 1;
    const name = html.slice(nameAt, j).toLowerCase();

    const attributes: HtmlAttribute[] = [];
    while (j < html.length) {
      while (j < html.length && /\s/.test(html[j]!)) j += 1;
      const ch = html[j];
      if (ch === undefined || ch === ">") break;
      if (ch === "/" && html[j + 1] === ">") break;
      const attrFrom = j;
      while (j < html.length && ATTR_NAME.test(html[j]!)) j += 1;
      if (j === attrFrom) {
        // Nothing consumed — a stray character. Step over it rather than spin.
        j += 1;
        continue;
      }
      const attrName = html.slice(attrFrom, j).toLowerCase();
      let k = j;
      while (k < html.length && /\s/.test(html[k]!)) k += 1;
      if (html[k] !== "=") {
        attributes.push({ name: attrName, value: null, raw: html.slice(attrFrom, j) });
        continue;
      }
      k += 1;
      while (k < html.length && /\s/.test(html[k]!)) k += 1;
      const quote = html[k];
      if (quote === '"' || quote === "'") {
        const end = html.indexOf(quote, k + 1);
        const stop = end === -1 ? html.length : end;
        j = Math.min(stop + 1, html.length);
        attributes.push({
          name: attrName,
          value: decodeEntities(html.slice(k + 1, stop)),
          raw: html.slice(attrFrom, j),
        });
      } else {
        let end = k;
        while (end < html.length && /[^\s>]/.test(html[end]!)) end += 1;
        attributes.push({
          name: attrName,
          value: decodeEntities(html.slice(k, end)),
          raw: html.slice(attrFrom, end),
        });
        j = end;
      }
    }

    let selfClosing = false;
    if (html[j] === "/" && html[j + 1] === ">") {
      selfClosing = true;
      j += 2;
    } else if (html[j] === ">") {
      j += 1;
    }

    flushText(lt);
    tokens.push({ kind: "tag", raw: html.slice(lt, j), name, attributes, closing, selfClosing });
    i = textFrom = j;

    if (!closing && !selfClosing && RAW_TEXT.has(name)) {
      const close = html.toLowerCase().indexOf(`</${name}`, j);
      const stop = close === -1 ? html.length : close;
      if (stop > j) tokens.push({ kind: "text", raw: html.slice(j, stop) });
      i = textFrom = stop;
    }
  }
  flushText(html.length);
  return tokens;
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
};

/** `&amp;` back to `&`, enough for the addresses that appear in attributes. */
export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function encodeAttribute(value: string): string {
  return `"${value.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`;
}

/** Read one attribute's resolved value. */
export function attributeOf(
  token: Extract<HtmlToken, { kind: "tag" }>,
  name: string,
): string | null {
  return token.attributes.find((attribute) => attribute.name === name)?.value ?? null;
}

/** Point an attribute somewhere else, adding it when the tag had none. */
export function setAttribute(
  token: Extract<HtmlToken, { kind: "tag" }>,
  name: string,
  value: string,
): void {
  const existing = token.attributes.find((attribute) => attribute.name === name);
  if (existing) {
    existing.value = value;
    existing.changed = true;
    return;
  }
  token.attributes.push({ name, value, raw: "", changed: true });
}

/** Take an attribute off a tag, for one that would only fail if left on. */
export function removeAttribute(
  token: Extract<HtmlToken, { kind: "tag" }>,
  name: string,
): void {
  const at = token.attributes.findIndex((attribute) => attribute.name === name);
  if (at === -1) return;
  token.attributes.splice(at, 1);
  // Something must be marked changed or the tag is written back verbatim.
  if (token.attributes.length) token.attributes[0]!.changed = true;
  else token.attributes.push({ name: "data-gf-emptied", value: "", raw: "", changed: true });
}

/**
 * Write one tag back out. A tag nobody rewrote comes back exactly as it went
 * in — quoting, spacing, entities and all.
 */
export function renderTag(token: Extract<HtmlToken, { kind: "tag" }>): string {
  if (token.closing || !token.attributes.some((attribute) => attribute.changed)) {
    return token.raw;
  }
  const parts = token.attributes.map((attribute) => {
    if (!attribute.changed) return attribute.raw;
    return attribute.value === null
      ? attribute.name
      : `${attribute.name}=${encodeAttribute(attribute.value)}`;
  });
  const head = parts.length ? `<${token.name} ${parts.join(" ")}` : `<${token.name}`;
  return token.selfClosing ? `${head} />` : `${head}>`;
}

export function renderHtml(tokens: HtmlToken[]): string {
  return tokens.map((token) => (token.kind === "tag" ? renderTag(token) : token.raw)).join("");
}
