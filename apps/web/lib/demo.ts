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
  AccountPlan, ChangeProposal, Folder, FolderFile, PlanCode, PlanDefinition, SaveRow, WorkspaceProposal,
} from "./gf-api.ts";

/**
 * This browser-only workspace is intentionally public for the WebMCP
 * challenge. It does not run unless the address explicitly asks for `demo=1`,
 * and it never talks to a GoodFolder account or the hosted API.
 */
export const DEMO_BUILD = true;

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
  /** Text files carry their content; accepted binary files keep their exact bytes. */
  content?: string;
  blob?: Blob;
  /** A real static file under apps/web/public/demo-assets/, for binary files
   * generated ahead of time (see tools/generate-demo-assets.ts) rather than
   * invented at request time like `drawImage()` below. */
  asset?: string;
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
- The deck now opens on the Hollow Peak mark — worth a last look before
  Thursday in case it doesn't render on the projector.
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

const KESTREL_NOTES = `# Site visit, 14 August

Overcast the whole morning, which was lucky — the south elevation is
unshootable in direct sun. Everything in \`exterior/\` is from before eleven.

The interior shots need doing again. The light was gone by the time we got
inside and the flash makes the floor look yellow.

The walkthrough video and the voice memo are both from this visit — the
voice memo says everything that matters faster than typing it up would have.
`;

const WINTER_MENU_NOTES = `# Winter menu notes

Three changes from last winter's menu, in order of how nervous they make me.

## The soup

Root vegetable and barley, replacing the squash soup. It holds better on the
stove through a full dinner service, and it's fifteen cents cheaper a bowl —
see \`Menu costing.xlsx\`. Photo of a test batch is in \`photos/soup.png\`.

## The pastry case

Adding two items, cutting one. The case photo in \`photos/pastry-case.png\` is
from Tuesday's bake, before we'd settled the final lineup — treat it as
roughly right, not exact.

## The loaf

Unchanged. It's the one thing on this menu nobody is allowed to touch.
See \`sunday-bread.md\` for the recipe, such as it is.
`;

const FERNWEH_README = `# Fernweh Wayfarer

A compact travel camera for people who'd rather remember a trip than manage
a feed. No app, no cloud upload, one button, a battery that lasts the
flight.

Renders are in \`renders/\`. The one-pager and pitch deck pull from the same
set — see \`One-pager.pdf\` and \`Pitch deck.pptx\`.

Current status: first production run shipping in November. \`Financials.xlsx\`
has the burn and runway numbers behind that date.
`;

const FERNWEH_ROADMAP = `# Roadmap

## Shipped
- Final injection-molded body tooling locked
- 1,400 units pre-sold at $249

## In progress
- Leather supplier for the strap — two quotes in, deciding by the 10th
- Production QA checklist for the first run

## Next
- Second production run, contingent on the raise in \`Pitch deck.pptx\`
- A firmware update for battery reporting accuracy (currently over-reports
  by roughly 8% near empty — cosmetic, but worth fixing before the next run)
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

/** A path under apps/web/public/demo-assets/, generated by
 * tools/generate-demo-assets.ts and served as an ordinary static file. */
/* --------------------------------------------- A deliverable that is a page */

// More and more of what people hand to a client is a web page rather than a
// document. This folder is one: a research practice's report, written as
// index.html with its stylesheet, its mark, its data and a second page beside
// it. It is here so the rendered-page view has something real to render — a
// page with styling, a script that draws, data the script reads at the moment
// it runs, and a link to another page in the same folder.

const ASTER_INDEX = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Where small teams keep their work — Aster &amp; Vale</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="masthead">
    <img class="mark" src="mark.svg" alt="Aster and Vale">
    <p class="kicker">Prepared for Northbay Partners &middot; August 2026</p>
    <h1>Where small teams keep their work</h1>
    <p class="standfirst">
      Two hundred and forty people at firms of under fifty were asked one
      question: when a piece of work matters, where does it live? The answers
      were not tidy, and the untidiness is the finding.
    </p>
  </header>

  <main>
    <section>
      <h2>The short version</h2>
      <p>
        Nobody keeps one copy of anything. The median respondent named
        <strong>three</strong> places the same document might be, and a third
        of them named four or more. Almost everyone described a moment in the
        last year when the version they sent was not the version they meant.
      </p>
      <figure>
        <div id="chart" class="chart" role="img"
             aria-label="Where a finished document is kept, by share of respondents"></div>
        <figcaption>Where a finished piece of work is kept. Respondents could name more than one.</figcaption>
      </figure>
    </section>

    <section>
      <h2>What people actually said</h2>
      <blockquote>
        &ldquo;It is in the shared drive, and also in my downloads, and the one
        the client has is neither.&rdquo;
        <cite>Partner, six-person design practice</cite>
      </blockquote>
      <blockquote>
        &ldquo;We name them v2-final-final. Everybody knows it is a joke.
        Nobody has a better idea.&rdquo;
        <cite>Operations lead, forty-person agency</cite>
      </blockquote>
    </section>

    <section>
      <h2>What we think it means</h2>
      <p>
        The tools these teams have are built for storing files, and storing a
        file is not the problem they have. The problem is knowing which one is
        the real one, and being able to get back the one from before. That is
        a different product, and almost none of them are using one.
      </p>
      <p class="more"><a href="methodology.html">How this was done &rarr;</a></p>
    </section>
  </main>

  <footer>
    <p>Aster &amp; Vale &middot; research@asterandvale.example &middot; This page is the deliverable.</p>
  </footer>

  <script src="chart.js"></script>
</body>
</html>
`;

const ASTER_METHOD = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Method — Aster &amp; Vale</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="masthead">
    <img class="mark" src="mark.svg" alt="Aster and Vale">
    <p class="kicker">Method note</p>
    <h1>How this was done</h1>
  </header>
  <main>
    <section>
      <h2>Who was asked</h2>
      <p>
        Two hundred and forty people at firms of fewer than fifty, across
        design, law, accountancy, architecture and consulting. Recruited from
        our own list and from two professional bodies. Nobody was paid.
      </p>
    </section>
    <section>
      <h2>What was asked</h2>
      <p>
        One structured interview of about twenty minutes, and a short form
        afterwards. The chart on the front page comes from the form; the
        quotations come from the interviews, used with permission and with
        firm names removed.
      </p>
    </section>
    <section>
      <h2>What this does not show</h2>
      <p>
        Firms of over fifty behave differently and were deliberately left out.
        Nothing here says anything about them, and the figures should not be
        read across.
      </p>
      <p class="more"><a href="index.html">&larr; Back to the report</a></p>
    </section>
  </main>
</body>
</html>
`;

const ASTER_STYLES = `:root {
  --ink: #14161a;
  --muted: #5b6270;
  --line: #e2e5ea;
  --accent: #2b4a8b;
  --wash: #f6f7f9;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 0 24px 72px;
  font: 16px/1.65 "Iowan Old Style", "Palatino Linotype", Georgia, serif;
  color: var(--ink);
  background: #fff;
}
.masthead {
  max-width: 46rem; margin: 0 auto; padding: 56px 0 32px;
  border-bottom: 1px solid var(--line);
}
.mark { height: 34px; width: auto; display: block; margin-bottom: 28px; }
.kicker {
  margin: 0 0 12px; font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 12.5px; letter-spacing: .09em; text-transform: uppercase; color: var(--muted);
}
h1 { margin: 0 0 18px; font-size: clamp(30px, 5vw, 46px); line-height: 1.12; letter-spacing: -.02em; }
.standfirst { margin: 0; font-size: 19px; color: var(--muted); }
main { max-width: 46rem; margin: 0 auto; }
section { padding: 34px 0; border-bottom: 1px solid var(--line); }
h2 {
  margin: 0 0 14px; font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 13px; letter-spacing: .08em; text-transform: uppercase; color: var(--accent);
}
p { margin: 0 0 14px; }
figure { margin: 26px 0 0; }
figcaption {
  margin-top: 12px; font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 12.5px; color: var(--muted);
}
.chart { display: grid; gap: 10px; }
.bar { display: grid; grid-template-columns: 11rem 1fr auto; align-items: center; gap: 12px; }
.bar span:first-child { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 13.5px; }
.bar .track { display: block; height: 22px; background: var(--wash); border-radius: 4px; overflow: hidden; }
.bar .fill {
  display: block; height: 100%; width: 0; background: var(--accent); border-radius: 4px;
  transition: width .7s cubic-bezier(.2, .7, .3, 1);
}
.bar .value {
  font-family: ui-sans-serif, system-ui, sans-serif; font-size: 13px;
  color: var(--muted); font-variant-numeric: tabular-nums;
}
blockquote {
  margin: 0 0 22px; padding-left: 18px; border-left: 3px solid var(--accent);
  font-size: 19px; color: var(--ink);
}
blockquote cite {
  display: block; margin-top: 8px; font-style: normal;
  font-family: ui-sans-serif, system-ui, sans-serif; font-size: 13px; color: var(--muted);
}
.more a { color: var(--accent); text-decoration: none; font-weight: 600; }
.more a:hover { text-decoration: underline; }
footer {
  max-width: 46rem; margin: 0 auto; padding-top: 28px;
  font-family: ui-sans-serif, system-ui, sans-serif; font-size: 12.5px; color: var(--muted);
}
@media (prefers-color-scheme: dark) {
  :root { --ink: #f2f3f5; --muted: #a3aab8; --line: #2a2f38; --accent: #8fb0ea; --wash: #212630; }
  body { background: #14161a; }
}
`;

const ASTER_CHART = `// Draws the chart on the front page from figures.json, which sits beside this
// file. Read when the page runs rather than written into the markup, so the
// numbers and the page can be corrected separately.
(async function () {
  var target = document.getElementById("chart");
  if (!target) return;

  var figures;
  try {
    var answer = await fetch("figures.json");
    if (!answer.ok) throw new Error("figures.json answered " + answer.status);
    figures = await answer.json();
  } catch (problem) {
    target.textContent = "The figures for this chart could not be read.";
    console.error("chart: " + problem.message);
    return;
  }

  var largest = figures.places.reduce(function (top, place) {
    return Math.max(top, place.share);
  }, 0);

  figures.places.forEach(function (place, index) {
    var row = document.createElement("div");
    row.className = "bar";

    var label = document.createElement("span");
    label.textContent = place.name;

    var track = document.createElement("span");
    track.className = "track";
    var fill = document.createElement("span");
    fill.className = "fill";
    track.appendChild(fill);

    var value = document.createElement("span");
    value.className = "value";
    value.textContent = place.share + "%";

    row.appendChild(label);
    row.appendChild(track);
    row.appendChild(value);
    target.appendChild(row);

    setTimeout(function () {
      fill.style.width = (100 * place.share / largest) + "%";
    }, 90 + index * 110);
  });

  target.setAttribute("aria-label", figures.places.map(function (place) {
    return place.name + ", " + place.share + " per cent";
  }).join("; "));
})();
`;

const ASTER_FIGURES = `{
  "question": "Where is a finished piece of work kept?",
  "respondents": 240,
  "places": [
    { "name": "Shared drive", "share": 78 },
    { "name": "Email to a client", "share": 64 },
    { "name": "Someone's laptop", "share": 57 },
    { "name": "Chat thread", "share": 41 },
    { "name": "Printed copy", "share": 12 }
  ]
}
`;

const ASTER_MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 40" width="220" height="40">
  <style>
    .rule { stroke: #2b4a8b; }
    .name { fill: #14161a; }
    @media (prefers-color-scheme: dark) {
      .rule { stroke: #8fb0ea; }
      .name { fill: #f2f3f5; }
    }
  </style>
  <circle class="rule" cx="20" cy="20" r="13" fill="none" stroke-width="2.4"/>
  <path class="rule" d="M20 7v26M7 20h26" stroke-width="2.4" stroke-linecap="round"/>
  <text class="name" x="46" y="26" font-family="Georgia, serif" font-size="19">Aster &amp; Vale</text>
</svg>
`;

const ASTER_NOTES = `# Northbay report

The deliverable is \`index.html\`. It opens in a browser and needs nothing
installed, which is the whole reason we stopped sending these as documents.

Before it goes out:

- The August figure in \`figures.json\` is the one Priya corrected. Do not
  take the number off the old slide.
- \`methodology.html\` has to go with it. The client asked for the method note
  in writing and it is the second page, not an attachment.
- Everything is relative, so the folder can be zipped and sent as it is.
`;

const asset = (slug: string, path: string): string => `/demo-assets/${slug}/${path}`;

function makeFolders(): DemoFolder[] {
  return [
    {
      folder: {
        id: "demo-report", name: "Q3 Board Pack", createdAt: daysAgo(96),
        lastSeq: 24, lastSaveAt: hoursAgo(2), role: "owner",
        contributorCount: 2, openProposalCount: 0,
      },
      files: [
        { path: "summary.md", size: REPORT_SUMMARY.length, content: REPORT_SUMMARY },
        { path: "open-questions.md", size: OPEN_QUESTIONS.length, content: OPEN_QUESTIONS },
        { path: "figures/revenue.csv", size: REVENUE_CSV.length, content: REVENUE_CSV },
        { path: "figures/net-by-month.png", size: 9_423, asset: asset("hollow-peak", "figures/net-by-month.png") },
        { path: "figures/cost-per-folder.png", size: 9_558, asset: asset("hollow-peak", "figures/cost-per-folder.png") },
        { path: "figures/redraw.py", size: SCRIPT.length, content: SCRIPT },
        { path: "figures/archive/q2-revenue.csv", size: 412, content: REVENUE_CSV },
        { path: "figures/archive/q1-revenue.csv", size: 398, content: REVENUE_CSV },
        { path: "logo.png", size: 352_006, asset: asset("hollow-peak", "logo.png") },
        { path: "Board pack.pdf", size: 512_044, asset: asset("hollow-peak", "Board pack.pdf") },
        { path: "Budget.xlsx", size: 18_588, asset: asset("hollow-peak", "Budget.xlsx") },
        { path: "Board deck.pptx", size: 1_497_725, asset: asset("hollow-peak", "Board deck.pptx") },
        { path: "Cover letter.docx", size: 8_877, asset: asset("hollow-peak", "Cover letter.docx") },
      ],
      saves: [
        save(24, hoursAgo(2), "Rewrote the summary and refreshed the August figure", ["summary.md", "figures/revenue.csv"], { harness: "claude-code" }),
        save(23, hoursAgo(9), "Added the two charts and the script that draws them", ["figures/net-by-month.png", "figures/cost-per-folder.png", "figures/redraw.py"], { deviceName: "Carlos's laptop" }),
        save(22, daysAgo(2), "Accepted a suggestion on the opening paragraph", ["summary.md"], { harness: "codex" }),
        save(21, daysAgo(5), "Moved last quarter's figures into an archive folder", ["figures/archive/q2-revenue.csv", "figures/archive/q1-revenue.csv"], { deviceName: "Carlos's laptop" }),
        save(20, daysAgo(12), "Brought in the Hollow Peak mark and rebuilt the board pack around it", ["logo.png", "Board pack.pdf", "Board deck.pptx", "Cover letter.docx"], { deviceName: "Carlos's laptop" }),
        save(19, daysAgo(19), "First draft of the board pack", ["Board pack.pdf", "Board deck.pptx", "Cover letter.docx"], { deviceName: "Carlos's laptop" }),
      ],
      proposals: [],
      people: [
        { email: "carlos@trygoodfolder.com", role: "owner" },
        { email: "priya@example.com", role: "contributor" },
      ],
    },
    {
      folder: {
        id: "demo-photos", name: "Meridian House", createdAt: daysAgo(41),
        lastSeq: 11, lastSaveAt: daysAgo(1), role: "owner",
        contributorCount: 0, openProposalCount: 0,
      },
      files: [
        { path: "notes.md", size: KESTREL_NOTES.length, content: KESTREL_NOTES },
        { path: "logo.png", size: 438_602, asset: asset("kestrel-studio", "logo.png") },
        { path: "exterior/south-elevation.png", size: 273_310, asset: asset("kestrel-studio", "exterior/south-elevation.png") },
        { path: "exterior/entrance.png", size: 154_461, asset: asset("kestrel-studio", "exterior/entrance.png") },
        { path: "exterior/roofline.png", size: 116_265, asset: asset("kestrel-studio", "exterior/roofline.png") },
        { path: "exterior/detail/brickwork.png", size: 197_538, asset: asset("kestrel-studio", "exterior/detail/brickwork.png") },
        { path: "exterior/detail/window-reveal.png", size: 122_451, asset: asset("kestrel-studio", "exterior/detail/window-reveal.png") },
        { path: "interior/hallway.png", size: 118_813, asset: asset("kestrel-studio", "interior/hallway.png") },
        { path: "interior/stairs.png", size: 136_383, asset: asset("kestrel-studio", "interior/stairs.png") },
        { path: "walkthrough.mp4", size: 1_666_762, asset: asset("kestrel-studio", "walkthrough.mp4") },
        { path: "site-visit.m4a", size: 330_949, asset: asset("kestrel-studio", "site-visit.m4a") },
        { path: "Site report.pdf", size: 859_736, asset: asset("kestrel-studio", "Site report.pdf") },
        { path: "Renovation budget.xlsx", size: 17_046, asset: asset("kestrel-studio", "Renovation budget.xlsx") },
        { path: "Client proposal.pptx", size: 2_098_800, asset: asset("kestrel-studio", "Client proposal.pptx") },
        { path: "Contract.docx", size: 8_858, asset: asset("kestrel-studio", "Contract.docx") },
      ],
      saves: [
        save(11, daysAgo(1), "Brought in the Kestrel Studio mark and rebuilt the client proposal around it", ["logo.png", "Client proposal.pptx"], { deviceName: "Carlos's laptop" }),
        save(10, daysAgo(2), "Added the renovation budget and the countersigned contract", ["Renovation budget.xlsx", "Contract.docx"], { deviceName: "Carlos's laptop" }),
        save(9, daysAgo(2), "Wrote up the site report from the second visit", ["Site report.pdf"], { deviceName: "Carlos's laptop" }),
        save(8, daysAgo(3), "Added the exterior set from the second visit", ["exterior/south-elevation.png", "exterior/entrance.png", "exterior/roofline.png"], { deviceName: "Carlos's laptop" }),
        save(7, daysAgo(3), "Added the walkthrough and the voice memo", ["walkthrough.mp4", "site-visit.m4a"], { deviceName: "Carlos's laptop" }),
        save(6, daysAgo(16), "Wrote up what needs reshooting", ["notes.md"], { harness: "claude-code" }),
      ],
      proposals: [],
      people: [{ email: "carlos@trygoodfolder.com", role: "owner" }],
    },
    {
      // A folder big enough to be worth measuring against: the transport caps
      // one answer at a thousand entries, and this sits just under it.
      folder: {
        id: "demo-big", name: "Big Project", createdAt: daysAgo(300),
        lastSeq: 140, lastSaveAt: daysAgo(1), role: "owner",
        contributorCount: 0, openProposalCount: 0,
      },
      files: Array.from({ length: 960 }, (_, index) => {
        const area = ["src", "src/components", "src/lib", "tests", "docs", "assets"][index % 6]!;
        const extension = ["ts", "tsx", "md", "json", "css", "png"][index % 6]!;
        return { path: `${area}/file-${String(index).padStart(4, "0")}.${extension}`, size: 400 + index * 7 };
      }),
      saves: [save(140, daysAgo(1), "Reworked the components", ["src/components/file-0001.tsx"])],
      proposals: [],
      people: [{ email: "carlos@trygoodfolder.com", role: "owner" }],
    },
    {
      folder: {
        id: "demo-recipes", name: "Winter Menu Launch", createdAt: daysAgo(220),
        lastSeq: 6, lastSaveAt: daysAgo(1), role: "contributor",
        contributorCount: 1, openProposalCount: 0,
      },
      files: [
        { path: "sunday-bread.md", size: RECIPE.length, content: RECIPE },
        { path: "winter-menu-notes.md", size: WINTER_MENU_NOTES.length, content: WINTER_MENU_NOTES },
        { path: "logo.png", size: 383_554, asset: asset("marrow-salt", "logo.png") },
        { path: "photos/loaf.png", size: 202_719, asset: asset("marrow-salt", "photos/loaf.png") },
        { path: "photos/soup.png", size: 160_903, asset: asset("marrow-salt", "photos/soup.png") },
        { path: "photos/pastry-case.png", size: 218_824, asset: asset("marrow-salt", "photos/pastry-case.png") },
        { path: "photos/dining-room.png", size: 179_326, asset: asset("marrow-salt", "photos/dining-room.png") },
        { path: "promo.mp4", size: 2_317_142, asset: asset("marrow-salt", "promo.mp4") },
        { path: "dining-playlist.mp3", size: 945_158, asset: asset("marrow-salt", "dining-playlist.mp3") },
        { path: "Menu costing.xlsx", size: 16_537, asset: asset("marrow-salt", "Menu costing.xlsx") },
        { path: "Winter menu.pdf", size: 723_287, asset: asset("marrow-salt", "Winter menu.pdf") },
        { path: "Investor one-pager.pptx", size: 1_432_616, asset: asset("marrow-salt", "Investor one-pager.pptx") },
        { path: "Supplier letter.docx", size: 8_727, asset: asset("marrow-salt", "Supplier letter.docx") },
      ],
      saves: [
        save(6, daysAgo(1), "Added the promo video and the dining room playlist", ["promo.mp4", "dining-playlist.mp3"], { deviceName: "Carlos's laptop" }),
        save(5, daysAgo(2), "Brought in the Marrow & Salt mark and put together the investor one-pager", ["logo.png", "Investor one-pager.pptx"], { deviceName: "Carlos's laptop" }),
        save(4, daysAgo(3), "Photographed the new menu items", ["photos/loaf.png", "photos/soup.png", "photos/pastry-case.png", "photos/dining-room.png"], { deviceName: "Carlos's laptop" }),
        save(3, daysAgo(4), "Costed out the winter menu and laid out the menu card", ["Menu costing.xlsx", "Winter menu.pdf"], { deviceName: "Carlos's laptop" }),
        save(2, daysAgo(5), "Wrote up the winter menu notes", ["winter-menu-notes.md"], { harness: "claude-code" }),
        save(1, daysAgo(220), "Added the Sunday bread recipe", ["sunday-bread.md"], { deviceName: "Carlos's laptop" }),
      ],
      proposals: [],
      people: [
        { email: "juno@example.com", role: "owner" },
        { email: "carlos@trygoodfolder.com", role: "contributor" },
      ],
    },
    {
      folder: {
        id: "demo-launch", name: "Wayfarer Launch", createdAt: daysAgo(60),
        lastSeq: 9, lastSaveAt: hoursAgo(6), role: "owner",
        contributorCount: 1, openProposalCount: 0,
      },
      files: [
        { path: "README.md", size: FERNWEH_README.length, content: FERNWEH_README },
        { path: "roadmap.md", size: FERNWEH_ROADMAP.length, content: FERNWEH_ROADMAP },
        { path: "logo.png", size: 397_878, asset: asset("fernweh", "logo.png") },
        { path: "renders/product-hero.png", size: 97_385, asset: asset("fernweh", "renders/product-hero.png") },
        { path: "renders/product-detail.png", size: 156_174, asset: asset("fernweh", "renders/product-detail.png") },
        { path: "renders/lifestyle-shot.png", size: 140_212, asset: asset("fernweh", "renders/lifestyle-shot.png") },
        { path: "demo.mp4", size: 1_033_198, asset: asset("fernweh", "demo.mp4") },
        { path: "launch-sting.mp3", size: 377_908, asset: asset("fernweh", "launch-sting.mp3") },
        { path: "Financials.xlsx", size: 16_501, asset: asset("fernweh", "Financials.xlsx") },
        { path: "One-pager.pdf", size: 624_937, asset: asset("fernweh", "One-pager.pdf") },
        { path: "Pitch deck.pptx", size: 1_901_190, asset: asset("fernweh", "Pitch deck.pptx") },
        { path: "Investor update.docx", size: 8_814, asset: asset("fernweh", "Investor update.docx") },
      ],
      saves: [
        save(9, hoursAgo(6), "Cut the product demo video and the launch sting", ["demo.mp4", "launch-sting.mp3"], { deviceName: "Carlos's laptop" }),
        save(8, daysAgo(1), "Brought in the Fernweh mark and rebuilt the pitch deck around the renders", ["logo.png", "renders/product-hero.png", "Pitch deck.pptx"], { deviceName: "Carlos's laptop" }),
        save(7, daysAgo(2), "Shot the lifestyle and detail renders", ["renders/product-detail.png", "renders/lifestyle-shot.png"], { deviceName: "Carlos's laptop" }),
        save(6, daysAgo(3), "Updated the financials and the investor one-pager", ["Financials.xlsx", "One-pager.pdf"], { deviceName: "Carlos's laptop" }),
        save(5, daysAgo(4), "Sent the August investor update", ["Investor update.docx"], { harness: "claude-code" }),
        save(4, daysAgo(5), "Wrote the roadmap", ["roadmap.md"], { deviceName: "Carlos's laptop" }),
        save(3, daysAgo(6), "Wrote the README", ["README.md"], { deviceName: "Carlos's laptop" }),
      ],
      proposals: [],
      people: [
        { email: "carlos@trygoodfolder.com", role: "owner" },
        { email: "sana@example.com", role: "contributor" },
      ],
    },
    {
      folder: {
        id: "demo-page", name: "Northbay Report", createdAt: daysAgo(28),
        lastSeq: 7, lastSaveAt: hoursAgo(4), role: "owner",
        contributorCount: 1, openProposalCount: 0,
      },
      files: [
        { path: "index.html", size: ASTER_INDEX.length, content: ASTER_INDEX },
        { path: "methodology.html", size: ASTER_METHOD.length, content: ASTER_METHOD },
        { path: "styles.css", size: ASTER_STYLES.length, content: ASTER_STYLES },
        { path: "chart.js", size: ASTER_CHART.length, content: ASTER_CHART },
        { path: "figures.json", size: ASTER_FIGURES.length, content: ASTER_FIGURES },
        { path: "mark.svg", size: ASTER_MARK.length, blob: new Blob([ASTER_MARK], { type: "image/svg+xml" }) },
        { path: "notes.md", size: ASTER_NOTES.length, content: ASTER_NOTES },
      ],
      saves: [
        save(7, hoursAgo(4), "Corrected the August figure and the sentence about it", ["figures.json", "index.html"], { harness: "claude-code" }),
        save(6, daysAgo(1), "Drew the chart from the data instead of writing it into the page", ["chart.js", "figures.json", "index.html"], { harness: "codex" }),
        save(5, daysAgo(2), "Wrote the method note as a second page", ["methodology.html"], { deviceName: "Carlos's laptop" }),
        save(4, daysAgo(4), "Set the type and the dark treatment", ["styles.css"], { deviceName: "Carlos's laptop" }),
        save(3, daysAgo(6), "Brought in the Aster and Vale mark", ["mark.svg", "index.html"], { deviceName: "Carlos's laptop" }),
        save(2, daysAgo(9), "First pass at the report", ["index.html", "styles.css"], { deviceName: "Carlos's laptop" }),
        save(1, daysAgo(28), "Started the folder", ["notes.md"], { deviceName: "Carlos's laptop" }),
      ],
      proposals: [],
      people: [
        { email: "carlos@trygoodfolder.com", role: "owner" },
        { email: "priya@example.com", role: "contributor" },
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
/** A demo save keeps an immutable view of its files, including generated bytes. */
const saveSnapshots = new Map<string, DemoFile[]>();

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

function nextSave(
  entry: DemoFolder,
  label: string,
  paths: string[],
  counts: Partial<Pick<SaveRow, "addedCount" | "changedCount" | "removedCount">> = {},
): number {
  const seq = (entry.saves[0]?.seq ?? 0) + 1;
  entry.saves.unshift(save(seq, new Date().toISOString(), label, paths, {
    commitSha: `demo-head-${seq}`,
    deviceName: "GoodFolder web",
    changedCount: 0,
    ...counts,
  }));
  entry.folder.lastSeq = seq;
  entry.folder.lastSaveAt = entry.saves[0]!.createdAt;
  saveSnapshots.set(`${entry.folder.id}:${seq}`, entry.files.map((file) => ({ ...file })));
  return seq;
}

function countOpen(entry: DemoFolder): number {
  return entry.proposals.filter((p) => p.status === "open" || p.status === "needs-review").length;
}

const comments = new Map<string, Array<{ id: string; path: string; quotedText?: string | null; body: string; createdAt: string; authorEmail: string }>>();
/** Bytes waiting for a person's review. The demo keeps them so accepted files remain real. */
const staged = new Map<string, { name: string; size: number; blob?: Blob }>();
const workspaceProposals: WorkspaceProposal[] = [];

function blobFromDataUrl(content: unknown): Blob | null {
  const dataUrl = content && typeof content === "object" && "dataUrl" in content
    ? (content as { dataUrl?: unknown }).dataUrl
    : null;
  const match = typeof dataUrl === "string" ? /^data:([^;,]+);base64,([a-z0-9+/=\r\n]+)$/i.exec(dataUrl.trim()) : null;
  if (!match) return null;
  try {
    const binary = atob(match[2]!.replace(/\s/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: match[1]!.toLowerCase() });
  } catch {
    return null;
  }
}

function generatedSize(content: unknown): number {
  const dataUrl = content && typeof content === "object" && "dataUrl" in content
    ? (content as { dataUrl?: unknown }).dataUrl
    : null;
  if (typeof dataUrl === "string") {
    const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor((encoded.length * 3) / 4) - padding);
  }
  return new Blob([JSON.stringify(content ?? {})]).size;
}

async function handle(pathname: string, search: URLSearchParams, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  // An added file arrives as bytes, not as JSON. Everything else is JSON.
  const dropped = init?.body instanceof Blob ? init.body : null;
  const body = init?.body && !dropped
    ? JSON.parse(String(init.body)) as Record<string, unknown>
    : {};

  if (pathname === "/api/me") return json({ id: "demo-account", email: "you@example.com" });
  if (pathname === "/api/auth/logout") return json({ ok: true });
  if (pathname === "/api/plans") return json(PLANS);
  if (pathname === "/api/account/plan") return json(PLAN);
  if (pathname === "/api/projects" && method === "GET") {
    return json(folders().map((entry) => ({ ...entry.folder, openProposalCount: countOpen(entry) })));
  }
  if (pathname === "/api/workspace-proposals" && method === "GET") return json({ proposals: workspaceProposals });
  if (pathname === "/api/workspace-proposals" && method === "POST") {
    const name = String(body.name ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!name) return fail(422, "name", "Give the new folder a name.");
    const id = `demo-workspace-${workspaceProposals.length + 1}`;
    workspaceProposals.unshift({ id, name, explanation: String(body.explanation ?? "").slice(0, 1000), status: "open", createdAt: new Date().toISOString(), authorEmail: "assistant@example.com" });
    return json({ ok: true, proposalId: id });
  }
  if (pathname.startsWith("/api/workspace-proposals/") && pathname.endsWith("/review") && method === "POST") {
    const id = pathname.split("/")[3] ?? "";
    const proposal = workspaceProposals.find((item) => item.id === id);
    if (!proposal) return fail(404, "not-found", "no such workspace proposal");
    const action = body.action === "accept" ? "accept" : body.action === "reject" ? "reject" : null;
    if (!action) return fail(422, "action", "Choose accept or reject.");
    proposal.status = action === "accept" ? "accepted" : "rejected";
    if (action === "accept") {
      const projectId = `demo-${Date.now()}`;
      proposal.createdProjectId = projectId;
      folders().unshift({ folder: { id: projectId, name: proposal.name, createdAt: new Date().toISOString(), lastSeq: 0, lastSaveAt: null, role: "owner", contributorCount: 0, openProposalCount: 0 }, files: [], saves: [], proposals: [], people: [{ email: "you@example.com", role: "owner" }] });
      return json({ ok: true, status: proposal.status, projectId });
    }
    return json({ ok: true, status: proposal.status });
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
  let file = entry.files.find((item) => item.path === path) ?? null;
  const ref = search.get("ref");
  const sequence = ref ? /^demo-head-(\d+)$/.exec(ref)?.[1] : undefined;
  if (sequence) {
    file = saveSnapshots.get(`${entry.folder.id}:${sequence}`)?.find((item) => item.path === path) ?? null;
  }

  if (rest === "" && method === "DELETE") {
    if (entry.folder.role !== "owner") return fail(404, "not-found", "no such folder on this account");
    if (body.name !== entry.folder.name) {
      return fail(409, "confirmation", "Type the folder's exact name to confirm permanent deletion.");
    }
    const at = folders().indexOf(entry);
    if (at >= 0) folders().splice(at, 1);
    return json({ ok: true, projectId: entry.folder.id, name: entry.folder.name });
  }

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
  if (rest === "staged-files" && method === "POST") {
    const id = `demo-waiting-${staged.size + 1}`;
    staged.set(id, { name: search.get("name") ?? "file", size: dropped?.size ?? 0, blob: dropped ?? undefined });
    return json({ ok: true, stagingId: id, size: dropped?.size ?? 0 });
  }
  if (rest === "generated-files" && method === "POST") {
    const path = String(body.path ?? "").trim();
    if (!path) return fail(422, "invalid", "Give the generated file a path.");
    const id = `demo-waiting-${staged.size + 1}`;
    const blob = blobFromDataUrl(body.content);
    const size = blob?.size ?? generatedSize(body.content);
    staged.set(id, { name: path.split("/").pop() || "generated-file", size, blob: blob ?? undefined });
    return json({ ok: true, stagingId: id, size });
  }
  if (rest === "proposals" && method === "POST") {
    const operations = Array.isArray(body.suggestions)
      ? body.suggestions as Array<Record<string, string>>
      : [(body.operation ?? {}) as Record<string, string>];
    const id = `demo-proposal-${entry.proposals.length + 3}`;
    entry.proposals.unshift({
      id,
      title: String(body.title ?? "Suggested change"),
      explanation: String(body.explanation ?? operations[0]?.explanation ?? ""),
      status: "open",
      createdAt: new Date().toISOString(),
      authorEmail: "you@example.com",
      suggestions: operations.map((operation, index) => {
        const waiting = operation.stagingId ? staged.get(String(operation.stagingId)) : undefined;
        return {
          id: `${id}-${index + 1}`, path: String(operation.path ?? ""),
          kind: (operation.kind as "text_replace") ?? "text_replace",
          before: String(operation.before ?? ""), replacement: String(operation.replacement ?? ""),
          explanation: String(operation.explanation ?? ""), status: "open" as const,
          operation: {
            kind: (operation.kind as "text_replace") ?? "text_replace",
            ...(operation.to ? { to: String(operation.to) } : {}),
            ...(waiting ? { sizeBytes: waiting.size, fileName: waiting.name, stagingId: String(operation.stagingId) } : {}),
          },
        };
      }),
    });
    return json({ ok: true, proposalId: id, suggestionCount: operations.length, url: "" });
  }
  if (rest.startsWith("proposals/") && rest.endsWith("/review")) {
    const proposal = entry.proposals.find((item) => item.id === parts[4]);
    if (!proposal) return fail(404, "not-found", "no such proposal");
    const accept = body.action === "accept";
    proposal.status = accept ? "accepted" : "rejected";
    for (const suggestion of proposal.suggestions) suggestion.status = proposal.status;
    if (!accept) return json({ ok: true, status: proposal.status, acceptedSuggestionIds: [], head: null, saveNumber: null });
    for (const suggestion of proposal.suggestions) {
      const at = String(suggestion.path ?? "");
      const target = entry.files.find((item) => item.path === at);
      if (suggestion.kind === "path_remove") {
        entry.files = entry.files.filter((item) => item.path !== at);
      } else if (suggestion.kind === "path_rename") {
        const to = String(suggestion.operation?.to ?? "");
        if (target && to) target.path = to;
      } else if (suggestion.kind === "asset_replace") {
        const size = Number(suggestion.operation?.sizeBytes ?? 0);
        const stagedFile = staged.get(String(suggestion.operation?.stagingId ?? ""));
        if (target) {
          target.size = size;
          target.blob = stagedFile?.blob;
        } else entry.files.push({ path: at, size, blob: stagedFile?.blob });
      } else if (target?.content !== undefined) {
        target.content = target.content.replace(suggestion.before, suggestion.replacement);
        target.size = target.content.length;
      }
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
  if (rest === "files/upload" && method === "POST") {
    const name = path.split("/").pop() || "file";
    const size = dropped?.size ?? 0;
    const readable = /\.(md|markdown|txt|csv|tsv)$/i.test(name);
    const content = readable && dropped ? await dropped.text() : undefined;
    const target = entry.files.find((item) => item.path === path);
    if (target) {
      target.size = size;
      target.content = content;
      target.blob = readable ? undefined : dropped ?? undefined;
    } else {
      entry.files.push({ path, size, content, blob: readable ? undefined : dropped ?? undefined });
    }
    const seq = nextSave(entry, target ? `Replaced ${name}` : `Added ${name}`, [path],
      target ? { changedCount: 1 } : { addedCount: 1 });
    return json({ ok: true, path, head: `demo-head-${seq}`, saveNumber: seq });
  }
  if (rest === "files/rename" && method === "POST") {
    const from = String(body.from ?? "");
    const to = String(body.to ?? "");
    const moving = entry.files.filter((item) => item.path === from || item.path.startsWith(`${from}/`));
    if (moving.length === 0) return fail(404, "not-found", `“${from.split("/").pop()}” isn’t in this folder any more.`);
    for (const item of moving) item.path = `${to}${item.path.slice(from.length)}`;
    const seq = nextSave(entry, `Renamed ${from.split("/").pop()} to ${to.split("/").pop()}`,
      moving.map((item) => item.path), { changedCount: moving.length });
    return json({ ok: true, from, to, head: `demo-head-${seq}`, saveNumber: seq });
  }
  if (rest === "files/remove" && method === "POST") {
    const asked = Array.isArray(body.paths) ? body.paths.map(String) : [];
    const going = entry.files
      .filter((item) => asked.some((name) => item.path === name || item.path.startsWith(`${name}/`)))
      .map((item) => item.path);
    if (going.length === 0) return fail(404, "not-found", "That isn’t in this folder any more. Nothing was changed.");
    entry.files = entry.files.filter((item) => !going.includes(item.path));
    const label = going.length === 1 ? `Took out ${going[0]!.split("/").pop()}` : `Took out ${going.length} files`;
    const seq = nextSave(entry, label, going, { removedCount: going.length });
    return json({ ok: true, removed: going, head: `demo-head-${seq}`, saveNumber: seq });
  }
  if (rest === "invitations") {
    entry.people.push({ email: String(body.email ?? "someone@example.com"), role: "contributor" });
    entry.folder.contributorCount = entry.people.length - 1;
    return json({ ok: true });
  }

  if (rest === "file") {
    if (!file) return fail(404, "not-found", "file not found");
    const kind = previewKindFor(file.path);
    if (file.content === undefined && !file.blob && !file.asset) {
      return json({ path: file.path, size: file.size, sha: `demo-${file.path}`, role: entry.folder.role ?? "owner", previewable: false, previewKind: null, storedForDevice: true });
    }
    return json({
      path: file.path, size: file.size, sha: `demo-${file.path}`, role: entry.folder.role ?? "owner",
      previewable: kind !== null, editable: EDITABLE.test(file.path), proposable: kind === "text",
      previewKind: kind, content: file.content,
    });
  }
  if (rest === "file/raw") {
    if (!file) return fail(404, "not-found", "file not found");
    if (file.blob) {
      return new Response(file.blob, { status: 200, headers: { "content-type": file.blob.type || "application/octet-stream" } });
    }
    if (file.asset) {
      // A real file generated ahead of time (tools/generate-demo-assets.ts),
      // served like any other same-origin static asset. `fetch` here is the
      // patched `window.fetch`, but the patch only intercepts `apiOrigin`
      // addresses — a relative /demo-assets/ path already passes straight
      // through to the real network.
      const response = await fetch(file.asset);
      return new Response(response.body, {
        status: response.status,
        headers: { "content-type": response.headers.get("content-type") ?? "application/octet-stream" },
      });
    }
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
  staged.clear();
  saveSnapshots.clear();
}
