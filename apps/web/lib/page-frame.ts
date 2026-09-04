// The frame a web page from a folder is rendered in, and the small runtime
// that goes inside it.
//
// ── The one rule ────────────────────────────────────────────────────────────
// The frame is never given `allow-same-origin`. With it, a page in someone's
// folder would run as the dashboard: read its storage, reach its window, and
// speak to the account API as the signed-in person. Without it the page has
// no origin at all — it can do whatever a page does, to itself, and reach
// nothing of ours. `allow-scripts` alone is safe; `allow-scripts` together
// with `allow-same-origin` is the same as no sandbox at all.
//
// There is a test asserting the exact attribute below. If it ever fails, the
// answer is to change the change, not the test.
//
// Also withheld, and each for a reason: top navigation, so a page can never
// replace the dashboard's own tab with something that looks like it; and
// pointer lock, orientation lock and presentation, which nothing here needs.
//
// ── What the runtime is for ─────────────────────────────────────────────────
// A page with no origin has no storage either — `localStorage` throws rather
// than returning empty — and a great many pages read it on their first line.
// So the runtime stands one up in memory before anything else runs. It also
// carries back what the page did: the errors it hit, the things it asked for
// that were not there, and any click on a link to another page in the same
// folder, which the dashboard answers by reading that page and rendering it,
// so a site of several pages is walked rather than flattened into one.

/** Exactly what the frame is allowed to do. Read the note above before editing. */
export const PAGE_FRAME_SANDBOX =
  "allow-scripts allow-forms allow-modals allow-popups allow-downloads";

export type PageFrameEvent =
  | { kind: "ready"; title: string; height: number }
  | { kind: "request"; id: number; url: string }
  | { kind: "error"; message: string }
  | { kind: "resource"; url: string; element: string }
  | { kind: "navigate"; path: string }
  | { kind: "height"; height: number };

/**
 * Read one message from the frame.
 *
 * Everything here arrives from a page nobody vetted, so nothing is trusted:
 * the shape is checked field by field, strings are cut to a length, and a
 * message that does not carry this exact frame's token is dropped. Returns
 * null for anything that is not a message this frame sent.
 */
export function readPageFrameEvent(data: unknown, token: string): PageFrameEvent | null {
  if (!data || typeof data !== "object") return null;
  const message = data as Record<string, unknown>;
  if (message.__goodfolderPage !== token) return null;
  const text = (value: unknown, limit = 400): string =>
    typeof value === "string" ? value.slice(0, limit) : "";
  const number = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;
  switch (message.kind) {
    case "ready":
      return { kind: "ready", title: text(message.title, 200), height: number(message.height) };
    case "error":
      return { kind: "error", message: text(message.message) };
    case "resource":
      return { kind: "resource", url: text(message.url), element: text(message.element, 20) };
    case "request": {
      const url = text(message.url, 1000);
      const id = number(message.id);
      return url && id ? { kind: "request", id, url } : null;
    }
    case "navigate": {
      const path = text(message.path, 1000);
      return path ? { kind: "navigate", path } : null;
    }
    case "height":
      return { kind: "height", height: number(message.height) };
    default:
      return null;
  }
}

/** One answer to a page's own request for a file beside it. */
export interface PageFrameReply {
  id: number;
  ok: boolean;
  status: number;
  mime: string;
  base64: string;
}

/** Addressed to one frame, so a page cannot be answered by another page. */
export function pageFrameReply(token: string, reply: PageFrameReply): Record<string, unknown> {
  return { __goodfolderPageReply: token, ...reply };
}

/**
 * The script put in front of the page's own.
 *
 * Written plainly and defensively on purpose: it runs inside somebody else's
 * page, before their code, and must not be the reason anything breaks. Every
 * part of it is wrapped, and a failure anywhere leaves the page working.
 */
export function pageFrameRuntime(token: string): string {
  const id = JSON.stringify(token);
  return `(function(){
  var TOKEN = ${id};
  function send(kind, extra) {
    try {
      var message = { __goodfolderPage: TOKEN, kind: kind };
      for (var key in extra) if (Object.prototype.hasOwnProperty.call(extra, key)) message[key] = extra[key];
      parent.postMessage(message, "*");
    } catch (ignored) {}
  }

  // A page with no origin is refused storage rather than given an empty one,
  // and a page that reads it on its first line would break before it drew.
  function memoryStorage() {
    var held = {};
    return {
      getItem: function (key) { return Object.prototype.hasOwnProperty.call(held, String(key)) ? held[String(key)] : null; },
      setItem: function (key, value) { held[String(key)] = String(value); },
      removeItem: function (key) { delete held[String(key)]; },
      clear: function () { held = {}; },
      key: function (index) { var keys = Object.keys(held); return index < keys.length ? keys[index] : null; },
      get length() { return Object.keys(held).length; }
    };
  }
  ["localStorage", "sessionStorage"].forEach(function (name) {
    var works = false;
    try { window[name].setItem("__gf", "1"); window[name].removeItem("__gf"); works = true; } catch (ignored) {}
    if (works) return;
    try { Object.defineProperty(window, name, { value: memoryStorage(), configurable: true }); } catch (ignored) {}
  });

  window.addEventListener("error", function (event) {
    var target = event.target;
    if (target && target !== window && (target.src || target.href)) {
      send("resource", {
        url: String(target.src || target.href).slice(0, 300),
        element: String(target.tagName || "").toLowerCase()
      });
      return;
    }
    var where = event.lineno ? " (line " + event.lineno + ")" : "";
    send("error", { message: String(event.message || "Script error") + where });
  }, true);

  window.addEventListener("unhandledrejection", function (event) {
    var reason = event.reason;
    var text = reason && reason.message ? reason.message : reason;
    send("error", { message: "Unfinished promise: " + String(text) });
  });

  var reportError = console.error;
  console.error = function () {
    try { send("error", { message: Array.prototype.map.call(arguments, String).join(" ") }); } catch (ignored) {}
    return reportError.apply(console, arguments);
  };

  // A link to another page in the same folder goes back to the dashboard,
  // which reads that page and renders it exactly like this one.
  document.addEventListener("click", function (event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    var node = event.target;
    while (node && node.nodeType === 1 && String(node.tagName).toLowerCase() !== "a") node = node.parentNode;
    if (!node || node.nodeType !== 1) return;
    var target = node.getAttribute("data-gf-page");
    if (!target) return;
    if ((node.getAttribute("target") || "") === "_blank") return;
    event.preventDefault();
    send("navigate", { path: target });
  }, true);

  // A page that asks for a file beside it — a script fetching its own data —
  // is asking for something the frame has no address to reach. The request
  // goes back to the dashboard, which reads it out of the folder and answers.
  var nextRequest = 1;
  var waiting = {};
  window.addEventListener("message", function (event) {
    if (event.source !== parent) return;
    var reply = event.data;
    if (!reply || reply.__goodfolderPageReply !== TOKEN) return;
    var pending = waiting[reply.id];
    if (!pending) return;
    delete waiting[reply.id];
    pending(reply);
  });
  function beside(url) {
    var text = String(url == null ? "" : url);
    if (!text || text.charAt(0) === "#") return null;
    if (text.indexOf("//") === 0) return null;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(text)) return null;
    return text;
  }
  var nativeFetch = typeof window.fetch === "function" ? window.fetch.bind(window) : null;
  if (nativeFetch && typeof Response === "function") {
    window.fetch = function (input, init) {
      var relative = beside(typeof input === "string" ? input : input && input.url);
      if (!relative) return nativeFetch(input, init);
      return new Promise(function (resolve) {
        var id = nextRequest++;
        var settled = false;
        waiting[id] = function (reply) {
          settled = true;
          if (!reply.ok) {
            resolve(new Response(null, { status: reply.status || 404, statusText: "Not in this folder" }));
            return;
          }
          var binary = atob(reply.base64 || "");
          var bytes = new Uint8Array(binary.length);
          for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          resolve(new Response(bytes, {
            status: 200,
            headers: { "content-type": reply.mime || "application/octet-stream" }
          }));
        };
        send("request", { id: id, url: relative });
        setTimeout(function () {
          if (settled) return;
          delete waiting[id];
          resolve(new Response(null, { status: 504, statusText: "No answer" }));
        }, 15000);
      });
    };
  }

  function measure() {
    var body = document.body;
    var root = document.documentElement;
    if (!body || !root) return 0;
    return Math.max(body.scrollHeight, root.scrollHeight, body.offsetHeight, root.offsetHeight);
  }
  function announce() { send("height", { height: measure() }); }
  window.addEventListener("load", function () {
    send("ready", { title: String(document.title || ""), height: measure() });
    announce();
  });
  document.addEventListener("DOMContentLoaded", function () {
    send("ready", { title: String(document.title || ""), height: measure() });
    try { new ResizeObserver(announce).observe(document.documentElement); } catch (ignored) {}
  });
})();`;
}
