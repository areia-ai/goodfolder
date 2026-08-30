// A folder to build the window against, when there is no real one to hand.
//
// The dashboard cannot be looked at without a signed-in account and a real
// server, which makes every visual change to it either guesswork or a trip
// through production. This answers the same addresses the real server does,
// with invented content, so the whole surface can be opened, clicked through
// and checked on a laptop with nothing running.
//
// Two things keep it honest:
//
//   1. It is removed from a production build. `NODE_ENV` is replaced with a
//      literal at build time, so the guard below folds to `false` and every
//      byte of this file is dropped. Nothing here can be reached on the
//      hosted service, with or without the address that switches it on.
//   2. It answers at the transport, not above it. The real client in
//      `gf-api.ts` runs unchanged — same requests, same parsing, same error
//      paths — so what you see is the real screen with invented content, not
//      a second implementation that can quietly drift.

import { previewKindFor } from "./preview.ts";
import type {
  AccountPlan, ChangeProposal, Folder, FolderFile, PlanCode, PlanDefinition, SaveRow,
} from "./gf-api.ts";

/** Built out of production entirely. Never true on the hosted service. */
export const DEMO_BUILD = process.env.NODE_ENV !== "production";

const FLAG = "demo";
const REMEMBERED = "goodfolder.demo";

/**
 * On when the address says so, and stays on while you click around, because
 * the window rewrites the address as you move and would otherwise drop out
 * of the example on the first navigation.
 */
export function demoActive(search = typeof window === "undefined" ? "" : window.location.search): boolean {
  if (!DEMO_BUILD) return false;
  const asked = new URLSearchParams(search).get(FLAG);
  try {
    if (asked === "0" || asked === "off") {
      window.sessionStorage.removeItem(REMEMBERED);
      return false;
    }
    if (asked !== null) {
      window.sessionStorage.setItem(REMEMBERED, "1");
      return true;
    }
    return window.sessionStorage.getItem(REMEMBERED) === "1";
  } catch {
    return asked !== null && asked !== "0" && asked !== "off";
  }
}

/* ------------------------------------------------------------ The content */

const EDITABLE = /\.(md|markdown|txt|csv|tsv)$/i;

const NOW = Date.parse("2026-08-30T11:00:00Z");
const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

interface DemoFile {
  path: string;
  size: number;
  /** Text files carry their content; everything else is drawn or described. */
  content?: string;
}

interface DemoFolder {
  folder: Folder;
  files: DemoFile[];
  saves: SaveRow[];
  proposals: ChangeProposal[];
  people: Array<{ email: string; role: "owner" | "contributor" }>;
}

const REPORT_SUMMARY = `# Q3 report

Revenue held steady through the quarter while the cost of running the service
fell for the third month in a row. The detail sits in \`figures/revenue.csv\`,
and the two charts in \`figures/\` are drawn from it.

## What changed since Q2

- Support load per customer fell by about a fifth.
- Two large accounts renewed early.
- Hosting cost per active folder is now the smallest line in the table.

## What to watch

The renewal cliff in January is still the number that matters most. Nothing
in this quarter changes it, and the plan for it is unchanged.
`;

const REVENUE_CSV = `Month,Revenue,Costs,Net
April,48200,31100,17100
May,51400,30800,20600
June,52900,29400,23500
July,55100,29900,25200
August,57300,28600,28700
`;

const OPEN_QUESTIONS = `# Open questions

- Do we name the January renewal cliff in the board pack, or keep it in the
  appendix? Priya thinks the front.
- The August figure is still provisional until the last invoice clears.
- Nobody has checked whether the chart colours survive being printed.
`;

const RECIPE = `# Sunday bread

A slow loaf. Nothing about it is difficult, and all of it takes time.

## What you need

- 500g strong white flour
- 350g water, just warm
- 10g salt
- 3g dried yeast

## How

1. Mix everything and leave it alone for half an hour.
2. Fold it over on itself four times, then rest. Repeat three more times,
   forty minutes apart.
3. Shape it, and leave it in the fridge overnight.
4. Bake at 240°C in a covered pot for twenty minutes, then twenty more
   with the lid off.
`;

const SHOOT_NOTES = `Site visit, 14 August

Overcast the whole morning, which was lucky — the south elevation is
unshootable in direct sun. Everything in \`exterior/\` is from before eleven.

The interior shots need doing again. The light was gone by the time we got
inside and the flash makes the floor look yellow.
`;

const SCRIPT = `#!/usr/bin/env python3
"""Redraw the quarter's charts from the figures beside this file."""

import csv
from pathlib import Path

HERE = Path(__file__).parent


def read_months(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def main() -> None:
    months = read_months(HERE / "revenue.csv")
    for month in months:
        net = int(month["Revenue"]) - int(month["Costs"])
        print(f"{month['Month']:>10}  {net:>8,}")


if __name__ == "__main__":
    main()
`;

function save(
  seq: number, createdAt: string, label: string, changedPaths: string[],
  extra: Partial<SaveRow> = {},
): SaveRow {
  return {
    seq, label, createdAt, changedPaths,
    labelSource: "model",
    topPaths: changedPaths.slice(0, 3),
    changedCount: changedPaths.length,
    ...extra,
  };
}

function makeFolders(): DemoFolder[] {
  return [
    {
      folder: {
        id: "demo-report", name: "Q3 Report", createdAt: daysAgo(96),
        lastSeq: 24, lastSaveAt: hoursAgo(2), role: "owner",
        contributorCount: 2, openProposalCount: 2,
      },
      files: [
        { path: "summary.md", size: REPORT_SUMMARY.length, content: REPORT_SUMMARY },
        { path: "open-questions.md", size: OPEN_QUESTIONS.length, content: OPEN_QUESTIONS },
        { path: "Board pack.pdf", size: 1_842_000 },
        { path: "figures/revenue.csv", size: REVENUE_CSV.length, content: REVENUE_CSV },
        { path: "figures/net-by-month.png", size: 184_320 },
        { path: "figures/cost-per-folder.png", size: 156_112 },
        { path: "figures/redraw.py", size: SCRIPT.length, content: SCRIPT },
        { path: "figures/archive/q2-revenue.csv", size: 412, content: REVENUE_CSV },
        { path: "figures/archive/q1-revenue.csv", size: 398, content: REVENUE_CSV },
        { path: "Budget.xlsx", size: 44_100 },
        { path: "Board deck.pptx", size: 2_310_000 },
        { path: "Cover letter.docx", size: 28_400 },
      ],
      saves: [
        save(24, hoursAgo(2), "Rewrote the summary and refreshed the August figure", ["summary.md", "figures/revenue.csv"], { harness: "claude-code" }),
        save(23, hoursAgo(9), "Added the two charts and the script that draws them", ["figures/net-by-month.png", "figures/cost-per-folder.png", "figures/redraw.py"], { deviceName: "Carlos's laptop" }),
        save(22, daysAgo(2), "Accepted a suggestion on the opening paragraph", ["summary.md"], { harness: "codex" }),
        save(21, daysAgo(5), "Moved last quarter's figures into an archive folder", ["figures/archive/q2-revenue.csv", "figures/archive/q1-revenue.csv"], { deviceName: "Carlos's laptop" }),
        save(20, daysAgo(19), "First draft of the board pack", ["Board pack.pdf", "Board deck.pptx", "Cover letter.docx"], { deviceName: "Carlos's laptop" }),
      ],
      proposals: [
        {
          id: "demo-proposal-1",
          title: "Suggested changes to summary.md",
          explanation: "The opening sentence buries the thing a reader most needs.",
          status: "open",
          createdAt: hoursAgo(4),
          authorEmail: "priya@example.com",
          suggestions: [{
            id: "demo-suggestion-1",
            path: "summary.md",
            kind: "text_replace",
            before: "Revenue held steady through the quarter while the cost of running the service\nfell for the third month in a row.",
            replacement: "Costs fell for the third month running, and revenue held steady — so the net\nfigure is the best it has been all year.",
            explanation: "Leads with the number the board asks about first.",
            status: "open",
          }],
        },
        {
          id: "demo-proposal-2",
          title: "Suggested changes to figures/revenue.csv",
          explanation: "August is still provisional and should say so.",
          status: "open",
          createdAt: daysAgo(1),
          authorEmail: "assistant@example.com",
          suggestions: [{
            id: "demo-suggestion-2",
            path: "figures/revenue.csv",
            kind: "table_update",
            before: "57300",
            replacement: "57300 (provisional)",
            operation: { kind: "table_update", changes: [{ address: "B6", before: "57300", replacement: "57300 (provisional)" }] },
            explanation: "The last invoice has not cleared.",
            status: "open",
          }],
        },
      ],
      people: [
        { email: "carlos@trygoodfolder.com", role: "owner" },
        { email: "priya@example.com", role: "contributor" },
      ],
    },
    {
      folder: {
        id: "demo-photos", name: "Site Photos", createdAt: daysAgo(41),
        lastSeq: 8, lastSaveAt: daysAgo(3), role: "owner",
        contributorCount: 0, openProposalCount: 0,
      },
      files: [
        { path: "notes.txt", size: SHOOT_NOTES.length, content: SHOOT_NOTES },
        { path: "exterior/south-elevation.png", size: 3_120_000 },
        { path: "exterior/entrance.png", size: 2_845_000 },
        { path: "exterior/roofline.png", size: 2_990_000 },
        { path: "exterior/detail/brickwork.png", size: 1_420_000 },
        { path: "exterior/detail/window-reveal.png", size: 1_388_000 },
        { path: "interior/hallway.png", size: 2_240_000 },
        { path: "interior/stairs.png", size: 2_180_000 },
        { path: "walkthrough.mp4", size: 48_200_000 },
        { path: "site-visit.m4a", size: 6_400_000 },
      ],
      saves: [
        save(8, daysAgo(3), "Added the exterior set from the second visit", ["exterior/south-elevation.png", "exterior/entrance.png", "exterior/roofline.png"], { deviceName: "Carlos's laptop" }),
        save(7, daysAgo(3), "Added the walkthrough and the voice note", ["walkthrough.mp4", "site-visit.m4a"], { deviceName: "Carlos's laptop" }),
        save(6, daysAgo(16), "Wrote up what needs reshooting", ["notes.txt"], { harness: "claude-code" }),
      ],
      proposals: [],
      people: [{ email: "carlos@trygoodfolder.com", role: "owner" }],
    },
    {
      folder: {
        id: "demo-recipes", name: "Recipe Book", createdAt: daysAgo(220),
        lastSeq: 0, lastSaveAt: null, role: "contributor",
        contributorCount: 1, openProposalCount: 0,
      },
      files: [{ path: "sunday-bread.md", size: RECIPE.length, content: RECIPE }],
      saves: [],
      proposals: [],
      people: [
        { email: "ugnius@example.com", role: "owner" },
        { email: "carlos@trygoodfolder.com", role: "contributor" },
      ],
    },
  ];
}

const PLANS: Record<PlanCode, PlanDefinition> = {
  starter: { code: "starter", name: "Starter", includedBytes: 10_000_000_000, overageCentsPerGbMonth: 10, monthlyPriceCents: 900, annualPriceCents: 9000 },
  plus: { code: "plus", name: "Plus", includedBytes: 50_000_000_000, overageCentsPerGbMonth: 10, monthlyPriceCents: 1900, annualPriceCents: 19000 },
  studio: { code: "studio", name: "Studio", includedBytes: 250_000_000_000, overageCentsPerGbMonth: 8, monthlyPriceCents: 4900, annualPriceCents: 49000 },
};

const PLAN: AccountPlan = {
  billingMode: "stripe", enforcement: "observe", status: "active", planCode: "plus",
  access: "full", canWrite: true, reason: null, observedReason: null,
  includedBytes: 50_000_000_000, authorizedBytes: 50_000_000_000,
  usageBytes: 12_400_000_000, reservedBytes: 0,
  overageCapCents: 2000, accruedOverageCents: 0, accruedExcessGbMonth: 0,
  trialEndsAt: null, currentPeriodEnd: daysAgo(-18),
  writeAccessEndsAt: null, retentionEndsAt: null,
};

/* --------------------------------------------------------- Drawn content */

/**
 * Real bytes for the picture files, drawn on request.
 *
 * Thumbnails, the gallery and the image viewer all read the same address a
 * real photograph would, so their loading, sizing and caching get exercised
 * rather than stubbed.
 */
function drawImage(path: string): Blob {
  const name = path.split("/").pop() ?? path;
  const seed = [...path].reduce((total, character) => total + character.charCodeAt(0), 0);
  const hue = seed % 360;
  const tilt = (seed % 40) - 20;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 420" width="640" height="420">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="hsl(${hue} 62% 74%)"/>
    <stop offset="1" stop-color="hsl(${(hue + 48) % 360} 58% 52%)"/>
  </linearGradient></defs>
  <rect width="640" height="420" fill="url(#g)"/>
  <g transform="rotate(${tilt} 320 210)" opacity="0.35">
    <rect x="150" y="120" width="340" height="180" rx="18" fill="hsl(${(hue + 180) % 360} 70% 96%)"/>
  </g>
  <text x="320" y="396" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif"
        font-size="20" fill="hsl(${hue} 40% 18%)">${name.replace(/[<>&]/g, "")}</text>
</svg>`;
  return new Blob([svg], { type: "image/svg+xml" });
}

/* ------------------------------------------------------------- The server */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const fail = (status: number, code: string, message: string) =>
  json({ error: { code, message } }, status);

let state: DemoFolder[] | null = null;
const folders = (): DemoFolder[] => (state ??= makeFolders());
const findFolder = (id: string) => folders().find((entry) => entry.folder.id === id) ?? null;

function fileRow(file: DemoFile): FolderFile {
  const kind = previewKindFor(file.path);
  return {
    path: file.path,
    size: file.size,
    sha: `demo-${file.path}`,
    editable: EDITABLE.test(file.path),
    proposable: kind === "text",
    previewable: kind !== null,
    previewKind: kind,
  };
}

function nextSave(entry: DemoFolder, label: string, paths: string[]): number {
  const seq = (entry.saves[0]?.seq ?? 0) + 1;
  entry.saves.unshift(save(seq, new Date().toISOString(), label, paths, { deviceName: "GoodFolder web" }));
  entry.folder.lastSeq = seq;
  entry.folder.lastSaveAt = entry.saves[0]!.createdAt;
  return seq;
}

function countOpen(entry: DemoFolder): number {
  return entry.proposals.filter((p) => p.status === "open" || p.status === "needs-review").length;
}

const comments = new Map<string, Array<{ id: string; path: string; quotedText?: string | null; body: string; createdAt: string; authorEmail: string }>>();

async function handle(pathname: string, search: URLSearchParams, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};

  if (pathname === "/api/me") return json({ id: "demo-account", email: "you@example.com" });
  if (pathname === "/api/auth/logout") return json({ ok: true });
  if (pathname === "/api/plans") return json(PLANS);
  if (pathname === "/api/account/plan") return json(PLAN);
  if (pathname === "/api/projects" && method === "GET") {
    return json(folders().map((entry) => ({ ...entry.folder, openProposalCount: countOpen(entry) })));
  }
  if (pathname === "/api/projects" && method === "POST") {
    const name = String(body.name ?? "New Folder").slice(0, 80) || "New Folder";
    const id = `demo-${Math.abs(Date.parse(new Date().toISOString()))}`;
    folders().unshift({
      folder: { id, name, createdAt: new Date().toISOString(), lastSeq: 0, lastSaveAt: null, role: "owner", contributorCount: 0, openProposalCount: 0 },
      files: [], saves: [], proposals: [], people: [{ email: "you@example.com", role: "owner" }],
    });
    return json({ projectId: id, deviceId: "demo-device", token: "demo-credential", repo: "demo" });
  }

  const parts = pathname.split("/").filter(Boolean); // api projects :id …
  if (parts[0] !== "api" || parts[1] !== "projects" || !parts[2]) {
    return fail(404, "not-found", "This example does not answer that address.");
  }
  const entry = findFolder(parts[2]);
  if (!entry) return fail(404, "not-found", "no such folder on this account");
  const rest = parts.slice(3).join("/");
  const path = search.get("path") ?? "";
  const file = entry.files.find((item) => item.path === path);

  if (rest === "files") {
    return json({ role: entry.folder.role ?? "owner", head: `demo-head-${entry.folder.lastSeq}`, files: entry.files.map(fileRow) });
  }
  if (rest === "saves") {
    const full = search.get("paths") === "full";
    return json(entry.saves.map((row) => (full ? row : { ...row, changedPaths: [] })));
  }
  if (rest === "people") return json({ role: entry.folder.role ?? "owner", people: entry.people });
  if (rest === "proposals" && method === "GET") {
    return json({ role: entry.folder.role ?? "owner", proposals: entry.proposals });
  }
  if (rest === "proposals" && method === "POST") {
    const operation = (body.operation ?? {}) as Record<string, string>;
    const id = `demo-proposal-${entry.proposals.length + 3}`;
    entry.proposals.unshift({
      id,
      title: String(body.title ?? "Suggested change"),
      explanation: String(operation.explanation ?? ""),
      status: "open",
      createdAt: new Date().toISOString(),
      authorEmail: "you@example.com",
      suggestions: [{
        id: `${id}-1`, path: String(operation.path ?? ""),
        kind: (operation.kind as "text_replace") ?? "text_replace",
        before: String(operation.before ?? ""), replacement: String(operation.replacement ?? ""),
        explanation: String(operation.explanation ?? ""), status: "open",
      }],
    });
    return json({ ok: true, proposalId: id, suggestionCount: 1, url: "" });
  }
  if (rest.startsWith("proposals/") && rest.endsWith("/review")) {
    const proposal = entry.proposals.find((item) => item.id === parts[4]);
    if (!proposal) return fail(404, "not-found", "no such proposal");
    const accept = body.action === "accept";
    proposal.status = accept ? "accepted" : "rejected";
    for (const suggestion of proposal.suggestions) suggestion.status = proposal.status;
    if (!accept) return json({ ok: true, status: proposal.status, acceptedSuggestionIds: [], head: null, saveNumber: null });
    const target = entry.files.find((item) => item.path === proposal.suggestions[0]?.path);
    if (target?.content && proposal.suggestions[0]) {
      target.content = target.content.replace(proposal.suggestions[0].before, proposal.suggestions[0].replacement);
      target.size = target.content.length;
    }
    const seq = nextSave(entry, `Accepted ${proposal.title}`, proposal.suggestions.map((s) => s.path));
    return json({ ok: true, status: "accepted", acceptedSuggestionIds: proposal.suggestions.map((s) => s.id), head: `demo-head-${seq}`, saveNumber: seq });
  }
  if (rest.startsWith("proposals/") && rest.endsWith("/comments")) return json({ ok: true });

  if (rest === "document/comments" && method === "GET") {
    return json(comments.get(`${entry.folder.id}:${path}`) ?? []);
  }
  if (rest === "document/comments" && method === "POST") {
    const key = `${entry.folder.id}:${String(body.path ?? "")}`;
    const list = comments.get(key) ?? [];
    const id = `demo-comment-${list.length + 1}`;
    list.push({
      id, path: String(body.path ?? ""), quotedText: (body.quotedText as string) ?? null,
      body: String(body.body ?? ""), createdAt: new Date().toISOString(), authorEmail: "you@example.com",
    });
    comments.set(key, list);
    return json({ ok: true, commentId: id });
  }
  if (rest === "document/save") {
    const target = entry.files.find((item) => item.path === body.path);
    const content = String(body.content ?? "");
    if (target) {
      target.content = content;
      target.size = content.length;
    } else {
      entry.files.push({ path: String(body.path ?? "untitled.md"), size: content.length, content });
    }
    const seq = nextSave(entry, String(body.label ?? "Saved from the browser"), [String(body.path ?? "")]);
    return json({ ok: true, head: `demo-head-${seq}`, saveNumber: seq });
  }
  if (rest === "invitations") {
    entry.people.push({ email: String(body.email ?? "someone@example.com"), role: "contributor" });
    entry.folder.contributorCount = entry.people.length - 1;
    return json({ ok: true });
  }

  if (rest === "file") {
    if (!file) return fail(404, "not-found", "file not found");
    const kind = previewKindFor(file.path);
    if (file.content === undefined) {
      return json({ path: file.path, size: file.size, sha: `demo-${file.path}`, role: entry.folder.role ?? "owner", previewable: false, previewKind: null, storedForDevice: true });
    }
    return json({
      path: file.path, size: file.size, sha: `demo-${file.path}`, role: entry.folder.role ?? "owner",
      previewable: true, editable: EDITABLE.test(file.path), proposable: kind === "text",
      previewKind: kind, content: file.content,
    });
  }
  if (rest === "file/raw") {
    if (!file) return fail(404, "not-found", "file not found");
    if (previewKindFor(file.path) === "image") {
      const blob = drawImage(file.path);
      return new Response(blob, { status: 200, headers: { "content-type": "image/svg+xml" } });
    }
    // Everything else is described rather than invented: the window's honest
    // "kept safe, open it on a connected computer" state is worth seeing too.
    return json({ path: file.path, size: file.size, sha: `demo-${file.path}`, role: entry.folder.role ?? "owner", previewable: false, previewKind: null, storedForDevice: true });
  }

  return fail(404, "not-found", "This example does not answer that address.");
}

/* ------------------------------------------------------------- Switch-on */

let installed = false;

/**
 * Answer GoodFolder's own addresses from the content above, and let every
 * other address through untouched.
 */
export function installDemoTransport(apiOrigin: string): void {
  if (!DEMO_BUILD || installed || typeof window === "undefined") return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!href.startsWith(apiOrigin)) return original(input, init);
    const url = new URL(href);
    const request = input instanceof Request ? { method: input.method, body: init?.body } : init;
    try {
      return await handle(url.pathname, url.searchParams, request);
    } catch (error) {
      return fail(500, "demo", `The example could not answer that: ${(error as Error).message}`);
    }
  };
}

/** Start the example over — used by the sign-out control while it is on. */
export function resetDemo(): void {
  state = null;
  comments.clear();
}
