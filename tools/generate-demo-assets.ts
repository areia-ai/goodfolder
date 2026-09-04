// Builds the real binary assets for the Challenge Dashboard demo:
// AI-generated photography/logos/video/audio via the Higgsfield CLI, real
// charts drawn from the demo's actual numbers, and real PDF/DOCX/XLSX/PPTX
// files built from that content. Everything lands under
// apps/web/public/demo-assets/<folder-slug>/..., which apps/web/lib/demo.ts
// serves as ordinary static files (see the `asset` field on DemoFile).
//
// This script is dev tooling, not part of the running app — only its output
// ships. Re-run it whenever the demo content changes:
//
//   pnpm demo:assets            # everything
//   pnpm demo:assets --only=kestrel-studio
//   pnpm demo:assets --sanity   # one logo + one photo + no video/audio/docs

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import PptxGenJS from "pptxgenjs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import * as XLSX from "xlsx";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "apps/web/public/demo-assets");

const argv = process.argv.slice(2);
const only = argv.find((a) => a.startsWith("--only="))?.slice("--only=".length);
const sanity = argv.includes("--sanity");

/* -------------------------------------------------------------- Higgsfield */

function higgsfieldOnce(args: string[], timeoutMs: number): Record<string, unknown> {
  const raw = execFileSync("higgsfield", [...args, "--wait", "--json"], {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  });
  const jobs = JSON.parse(raw) as Array<Record<string, unknown>>;
  const job = jobs[0];
  if (!job || job.status !== "completed" || typeof job.result_url !== "string") {
    throw new Error(`Higgsfield job ended with status "${job?.status}": ${raw.slice(0, 300)}`);
  }
  return job;
}

/**
 * The safety classifier occasionally flags an entirely benign generation
 * (status "nsfw") — a false positive on the pixels, not the prompt. Retrying
 * the same request produces a fresh generation and usually clears it.
 */
function higgsfield(args: string[], timeoutMs: number, attempts = 3): Record<string, unknown> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return higgsfieldOnce(args, timeoutMs);
    } catch (error) {
      lastError = error;
      console.warn(`  attempt ${attempt}/${attempts} failed: ${(error as Error).message}`);
    }
  }
  throw lastError;
}

async function download(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download failed (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

function write(path: string, bytes: Buffer): void {
  const full = join(OUT, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, bytes);
  console.log(`  wrote ${path} (${(bytes.byteLength / 1024).toFixed(0)} KB)`);
}

/**
 * `--background transparent` on gpt_image_2 renders a soft vignette/glow
 * fading to transparent instead of a clean cutout. A flat "app icon on a
 * solid badge" prompt against the model's normal opaque-white canvas comes
 * out crisp; this flood-fills the near-white canvas from the image border
 * inward and punches it to alpha 0. A glyph inside the badge that happens to
 * also be white survives untouched, since it's enclosed by the badge color
 * and never reachable from the border.
 */
function cutoutWhiteBackground(data: Buffer, width: number, height: number, channels: number): Buffer {
  const isNearWhite = (i: number) => {
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
    return Math.sqrt((255 - r) ** 2 + (255 - g) ** 2 + (255 - b) ** 2) < 18;
  };
  const background = new Uint8Array(width * height);
  const queue: number[] = [];
  const visit = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const idx = y * width + x;
    if (background[idx]) return;
    if (!isNearWhite(idx * channels)) return;
    background[idx] = 1;
    queue.push(idx);
  };
  for (let x = 0; x < width; x += 1) { visit(x, 0); visit(x, height - 1); }
  for (let y = 0; y < height; y += 1) { visit(0, y); visit(width - 1, y); }
  for (let head = 0; head < queue.length; head += 1) {
    const idx = queue[head]!;
    const x = idx % width, y = Math.floor(idx / width);
    visit(x + 1, y); visit(x - 1, y); visit(x, y + 1); visit(x, y - 1);
  }
  const out = Buffer.from(data);
  for (let idx = 0; idx < width * height; idx += 1) {
    if (background[idx]) out[idx * channels + 3] = 0;
  }
  return out;
}

/** Generated media is expensive and slow; a file already on disk from a
 * previous run is left alone so re-running only rebuilds the (free, instant)
 * documents that reference it. Delete the file to force regeneration. */
function alreadyGenerated(path: string): boolean {
  if (!existsSync(join(OUT, path))) return false;
  console.log(`  skip ${path} (already generated)`);
  return true;
}

async function image(
  path: string, prompt: string,
  opts: { transparent?: boolean; aspectRatio?: string } = {},
): Promise<void> {
  console.log(`image: ${path}`);
  if (alreadyGenerated(path)) return;
  const job = higgsfield([
    "generate", "create", "gpt_image_2",
    "--prompt", prompt,
    "--aspect-ratio", opts.aspectRatio ?? "4:3",
    "--resolution", "1k",
  ], 3 * 60_000);
  const bytes = await download(String(job.result_url));
  if (opts.transparent) {
    const { data, info } = await sharp(bytes).ensureAlpha().resize({ width: 1024, withoutEnlargement: true })
      .raw().toBuffer({ resolveWithObject: true });
    const cutout = cutoutWhiteBackground(data, info.width, info.height, info.channels);
    write(path, await sharp(cutout, { raw: { width: info.width, height: info.height, channels: info.channels } })
      .png({ palette: true, colors: 32, compressionLevel: 9 }).toBuffer());
    return;
  }
  write(path, await sharp(bytes).resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer());
}

async function video(path: string, prompt: string, opts: { duration?: number } = {}): Promise<void> {
  console.log(`video: ${path}`);
  if (alreadyGenerated(path)) return;
  const job = higgsfield([
    "generate", "create", "seedance_2_5",
    "--prompt", prompt,
    "--duration", String(opts.duration ?? 6),
    "--resolution", "720p",
    "--aspect-ratio", "16:9",
  ], 12 * 60_000);
  write(path, await download(String(job.result_url)));
}

async function musicClip(path: string, prompt: string, durationSeconds: number): Promise<void> {
  console.log(`audio (music): ${path}`);
  if (alreadyGenerated(path)) return;
  const job = higgsfield([
    "generate", "create", "sonilo_music",
    "--prompt", prompt,
    "--duration", String(durationSeconds),
  ], 3 * 60_000);
  write(path, await download(String(job.result_url)));
}

/** Inworld returns WAV; transcode to AAC/.m4a with ffmpeg so it stays small. */
async function narration(path: string, script: string, voice: string): Promise<void> {
  console.log(`audio (narration): ${path}`);
  if (alreadyGenerated(path)) return;
  const job = higgsfield(["generate", "create", "inworld_text_to_speech", "--prompt", script, "--voice", voice], 3 * 60_000);
  const wav = await download(String(job.result_url));
  const tmp = join(OUT, `${path}.src.wav`);
  mkdirSync(dirname(tmp), { recursive: true });
  writeFileSync(tmp, wav);
  const full = join(OUT, path);
  execFileSync("ffmpeg", ["-y", "-i", tmp, "-c:a", "aac", "-b:a", "96k", full], { stdio: "pipe" });
  execFileSync("rm", [tmp]);
  console.log(`  wrote ${path}`);
}

/* ------------------------------------------------------------------ Charts */

/** A plain, honest bar chart drawn from real numbers — never AI-generated,
 * since a model can't be trusted to render correct figures. */
function barChartSvg(opts: {
  labels: string[]; values: number[]; title: string; valueFormat: (n: number) => string; color: string;
}): string {
  const { labels, values, title, valueFormat, color } = opts;
  const width = 960, height = 560, padding = { top: 70, right: 40, bottom: 70, left: 70 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const max = Math.max(...values) * 1.15;
  const barWidth = plotWidth / values.length * 0.55;
  const gap = plotWidth / values.length;
  const bars = values.map((value, index) => {
    const barHeight = (value / max) * plotHeight;
    const x = padding.left + index * gap + (gap - barWidth) / 2;
    const y = padding.top + plotHeight - barHeight;
    return `
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="4" fill="${color}"/>
      <text x="${(x + barWidth / 2).toFixed(1)}" y="${(y - 12).toFixed(1)}" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif" font-size="17" font-weight="600" fill="#1f2430">${valueFormat(value)}</text>
      <text x="${(x + barWidth / 2).toFixed(1)}" y="${(padding.top + plotHeight + 28).toFixed(1)}" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif" font-size="15" fill="#565f70">${labels[index]}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  <text x="${padding.left}" y="38" font-family="ui-sans-serif, system-ui, sans-serif" font-size="22" font-weight="700" fill="#1f2430">${title}</text>
  <line x1="${padding.left}" y1="${padding.top + plotHeight}" x2="${width - padding.right}" y2="${padding.top + plotHeight}" stroke="#d6dae2" stroke-width="1.5"/>
  ${bars}
</svg>`;
}

async function chart(path: string, svg: string): Promise<void> {
  console.log(`chart: ${path}`);
  write(path, await sharp(Buffer.from(svg)).png({ palette: true, colors: 32, compressionLevel: 9 }).toBuffer());
}

/* -------------------------------------------------------------- Documents */

/** Photos are saved as JPEG, charts/logos as PNG (see `image()`/`chart()`) —
 * sniff the real format rather than assume it, since pdf-lib's embedPng
 * throws on JPEG bytes and vice versa. */
function imageMime(bytes: Buffer): "image/png" | "image/jpeg" {
  return bytes[0] === 0x89 && bytes[1] === 0x50 ? "image/png" : "image/jpeg";
}

async function embedImage(pdf: PDFDocument, bytes: Buffer) {
  return imageMime(bytes) === "image/png" ? pdf.embedPng(bytes) : pdf.embedJpg(bytes);
}

async function pdfWithImage(path: string, opts: {
  title: string; logo?: Buffer; sections: Array<{ heading?: string; body?: string; image?: Buffer; imageCaption?: string }>;
}): Promise<void> {
  console.log(`pdf: ${path}`);
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([612, 792]);
  let y = 730;
  const wrap = (text: string, size: number, f = font, maxWidth = 500): string[] => {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (f.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = candidate;
    }
    if (line) lines.push(line);
    return lines;
  };
  const ensureSpace = (needed: number) => {
    if (y - needed < 60) {
      page = pdf.addPage([612, 792]);
      y = 730;
    }
  };
  if (opts.logo) {
    const embedded = await embedImage(pdf, opts.logo);
    const scale = 48 / embedded.height;
    page.drawImage(embedded, { x: 54, y: y - 48, width: embedded.width * scale, height: 48 });
  }
  page.drawText(opts.title, { x: opts.logo ? 120 : 54, y: y - 30, size: 22, font: bold, color: rgb(0.12, 0.13, 0.18) });
  y -= 80;
  for (const section of opts.sections) {
    if (section.heading) {
      ensureSpace(40);
      page.drawText(section.heading, { x: 54, y, size: 15, font: bold, color: rgb(0.12, 0.13, 0.18) });
      y -= 26;
    }
    if (section.body) {
      for (const line of wrap(section.body, 11)) {
        ensureSpace(18);
        page.drawText(line, { x: 54, y, size: 11, font, color: rgb(0.2, 0.22, 0.27) });
        y -= 16;
      }
      y -= 10;
    }
    if (section.image) {
      const embedded = await embedImage(pdf, section.image);
      const width = 500;
      const height = (embedded.height / embedded.width) * width;
      ensureSpace(height + 30);
      page.drawImage(embedded, { x: 54, y: y - height, width, height });
      y -= height + 8;
      if (section.imageCaption) {
        page.drawText(section.imageCaption, { x: 54, y, size: 9, font, color: rgb(0.45, 0.48, 0.53) });
        y -= 24;
      }
    }
  }
  write(path, Buffer.from(await pdf.save()));
}

async function pptxDeck(path: string, opts: {
  brand: string; accent: string; logo?: Buffer;
  slides: Array<{ title: string; body?: string; bullets?: string[]; image?: Buffer }>;
}): Promise<void> {
  console.log(`pptx: ${path}`);
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = opts.brand;
  pptx.title = opts.slides[0]?.title ?? opts.brand;
  const logoDataUrl = opts.logo ? `data:image/png;base64,${opts.logo.toString("base64")}` : null;
  for (const [index, slide] of opts.slides.entries()) {
    const s = pptx.addSlide();
    s.background = { color: "FFFFFF" };
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.14, fill: { color: opts.accent }, line: { color: opts.accent } });
    if (logoDataUrl) s.addImage({ data: logoDataUrl, x: 11.9, y: 0.4, w: 0.7, h: 0.7 });
    s.addText(slide.title, {
      x: 0.7, y: 0.6, w: 10.8, h: 0.9,
      fontSize: index === 0 ? 34 : 26, bold: true, color: "1F2430", margin: 0,
    });
    let y = index === 0 ? 1.9 : 1.7;
    if (slide.image) {
      const dataUrl = `data:${imageMime(slide.image)};base64,${slide.image.toString("base64")}`;
      s.addImage({ data: dataUrl, x: 7.4, y, w: 5.2, h: 3.7, sizing: { type: "cover", w: 5.2, h: 3.7 } });
    }
    const textWidth = slide.image ? 6.3 : 11.4;
    if (slide.body) s.addText(slide.body, { x: 0.7, y, w: textWidth, h: 1, fontSize: 16, color: "3A3F4B" });
    if (slide.bullets?.length) {
      s.addText(
        slide.bullets.map((text) => ({ text, options: { bullet: { code: "2022" }, breakLine: true } })),
        { x: 0.7, y: y + (slide.body ? 0.9 : 0), w: textWidth, h: 4, fontSize: 15, color: "3A3F4B", lineSpacingMultiple: 1.3 },
      );
    }
    s.addText(opts.brand, { x: 0.7, y: 7.0, w: 4, h: 0.3, fontSize: 9, bold: true, color: opts.accent });
  }
  const buffer = await pptx.write({ outputType: "nodebuffer" }) as Buffer;
  write(path, buffer);
}

async function docxLetter(path: string, opts: {
  brand: string; logo?: Buffer; date: string; paragraphs: string[];
}): Promise<void> {
  console.log(`docx: ${path}`);
  const children: Paragraph[] = [];
  if (opts.logo) {
    children.push(new Paragraph({ children: [new TextRun({ text: opts.brand, bold: true, size: 32 })] }));
  } else {
    children.push(new Paragraph({ text: opts.brand, heading: HeadingLevel.TITLE }));
  }
  children.push(new Paragraph({ text: opts.date, spacing: { after: 300 } }));
  for (const paragraph of opts.paragraphs) {
    children.push(new Paragraph({ children: [new TextRun(paragraph)], spacing: { after: 220 } }));
  }
  const doc = new Document({ sections: [{ children }] });
  write(path, Buffer.from(await Packer.toBuffer(doc)));
}

async function docxWithTable(path: string, opts: {
  title: string; intro: string; tableHeader: string[]; rows: string[][]; outro?: string;
}): Promise<void> {
  console.log(`docx: ${path}`);
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: opts.title, heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ text: opts.intro, spacing: { after: 240 } }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({ children: opts.tableHeader.map((cell) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: cell, bold: true })] })] })) }),
            ...opts.rows.map((row) => new TableRow({ children: row.map((cell) => new TableCell({ children: [new Paragraph(cell)] })) })),
          ],
        }),
        ...(opts.outro ? [new Paragraph({ text: opts.outro, spacing: { before: 240 } })] : []),
      ],
    }],
  });
  write(path, Buffer.from(await Packer.toBuffer(doc)));
}

/** SheetJS's read-only preview shows a cell's cached value, not a live
 * formula result — a `{f}` cell with no `v` renders blank. Every formula
 * cell below carries its real computed value alongside the formula, so the
 * grid shows the number while the formula stays visible on selection.
 * The viewer displays `v` as-is (no number-format support), so round here
 * rather than leave raw floating-point division in the grid. */
const cell = (f: string, v: number, decimals = 2) => ({ f, v: Math.round(v * 10 ** decimals) / 10 ** decimals });

function xlsxWorkbook(path: string, sheets: Array<{ name: string; rows: unknown[][] }>): void {
  console.log(`xlsx: ${path}`);
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name.slice(0, 31));
  }
  write(path, Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })));
}

/* ------------------------------------------------------------- Real numbers */

const MONTHS = ["April", "May", "June", "July", "August"];
const REVENUE = [48200, 51400, 52900, 55100, 57300];
const COSTS = [31100, 30800, 29400, 29900, 28600];
const NET = REVENUE.map((r, i) => r - COSTS[i]!);
const ACTIVE_FOLDERS = [6100, 6700, 7400, 8300, 9400];
const COST_PER_FOLDER = COSTS.map((c, i) => c / ACTIVE_FOLDERS[i]!);

/* ------------------------------------------------------------------ Runner */

type Folder = { slug: string; run: () => Promise<void> };

const folders: Folder[] = [
  {
    slug: "hollow-peak",
    async run() {
      await image("hollow-peak/logo.png",
        "Flat app icon design, like a modern iOS/macOS app icon sticker. A solid opaque dark-teal rounded-square badge containing a simple white triangular mountain-peak shape with a small notch at the top. Flat solid colors only, matte finish, no gradient, no glow, no lighting effects, no bloom, no transparency effects, crisp hard edges, print-ready flat vector illustration, similar to a Notion or Linear app icon. No text.",
        { transparent: true, aspectRatio: "1:1" });
      if (sanity) return;

      await chart("hollow-peak/figures/net-by-month.png", barChartSvg({
        labels: MONTHS, values: NET, title: "Net revenue by month", color: "#1769AA",
        valueFormat: (n) => `$${n.toLocaleString()}`,
      }));
      await chart("hollow-peak/figures/cost-per-folder.png", barChartSvg({
        labels: MONTHS, values: COST_PER_FOLDER, title: "Hosting cost per active folder", color: "#B4622A",
        valueFormat: (n) => `$${n.toFixed(2)}`,
      }));

      const [logoBytes, netChart, costChart] = await Promise.all([
        readAsset("hollow-peak/logo.png"), readAsset("hollow-peak/figures/net-by-month.png"), readAsset("hollow-peak/figures/cost-per-folder.png"),
      ]);

      await pdfWithImage("hollow-peak/Board pack.pdf", {
        title: "Hollow Peak — Q3 Board Pack", logo: logoBytes,
        sections: [
          { heading: "Executive summary", body: "Revenue held steady through the quarter while the cost of running the service fell for the third month in a row. Two large accounts renewed early, and support load per customer is down about a fifth from Q2. The renewal cliff in January is still the number that matters most; nothing this quarter changes that outlook." },
          { heading: "Net revenue by month", image: netChart, imageCaption: "Figures in figures/revenue.csv." },
          { heading: "Hosting cost per active folder", image: costChart, imageCaption: "Active folder count is now the denominator that matters — it keeps shrinking even as raw hosting spend holds flat." },
          { heading: "What to watch", body: "The August figure is still provisional until the last invoice clears. Nobody has checked whether the chart colours survive being printed." },
        ],
      });

      xlsxWorkbook("hollow-peak/Budget.xlsx", [
        {
          name: "Monthly", rows: [
            ["Month", "Revenue", "Costs", "Net", "Active folders", "Cost / active folder"],
            ...MONTHS.map((month, i) => [month, REVENUE[i], COSTS[i], NET[i], ACTIVE_FOLDERS[i], cell(`C${i + 2}/E${i + 2}`, COST_PER_FOLDER[i]!)]),
            ["Total",
              cell("SUM(B2:B6)", REVENUE.reduce((a, b) => a + b, 0)),
              cell("SUM(C2:C6)", COSTS.reduce((a, b) => a + b, 0)),
              cell("SUM(D2:D6)", NET.reduce((a, b) => a + b, 0)),
              "", ""],
          ],
        },
        {
          name: "Headcount", rows: [
            ["Team", "Headcount", "Loaded monthly cost"],
            ["Engineering", 4, 96000],
            ["Support", 2, 34000],
            ["Ops & finance", 1, 21000],
            ["Total", cell("SUM(B2:B4)", 7), cell("SUM(C2:C4)", 151_000)],
          ],
        },
      ]);

      await pptxDeck("hollow-peak/Board deck.pptx", {
        brand: "Hollow Peak", accent: "1769AA", logo: logoBytes,
        slides: [
          { title: "Q3 Board Update", body: "Revenue steady, hosting cost per folder down again, renewal cliff unchanged." },
          { title: "Net revenue by month", image: netChart },
          { title: "Hosting cost per active folder", image: costChart },
          { title: "What's next", bullets: ["Close out the August invoice before finalizing the figure", "Decide whether the January renewal cliff belongs in the front matter or the appendix", "Confirm chart colours print correctly for the physical board copies"] },
        ],
      });

      await docxLetter("hollow-peak/Cover letter.docx", {
        brand: "Hollow Peak", logo: logoBytes, date: "30 August 2026",
        paragraphs: [
          "Enclosed is the Q3 board pack: the summary, the current figures, and the deck for Thursday's meeting.",
          "The headline is steady — revenue held through the quarter, hosting cost per active folder keeps falling, and two of our larger accounts renewed ahead of schedule. The one open question is how prominently we surface the January renewal cliff; I've left it in the appendix for now, but I'd like the board's read before we lock the annual narrative.",
          "Happy to walk through any of the figures beforehand.",
        ],
      });
    },
  },
  {
    slug: "kestrel-studio",
    async run() {
      const shots: Array<[string, string]> = [
        ["exterior/south-elevation.png", "Professional real estate photograph of the south-facing exterior elevation of a renovated mid-century modern house, soft overcast daylight, no people, no text, realistic architectural photography, muted natural tones, wide angle."],
        ["exterior/entrance.png", "Professional real estate photograph of the front entrance of a renovated modern house, wooden door, minimal landscaping, soft overcast daylight, no people, no text, realistic architectural photography."],
        ["exterior/roofline.png", "Professional real estate photograph, low angle shot of a renovated house's roofline and eaves against an overcast sky, no people, no text, realistic architectural photography."],
        ["exterior/detail/brickwork.png", "Close-up architectural detail photograph of restored exterior brickwork on a renovated house, natural daylight, shallow depth of field, no people, no text, realistic photography."],
        ["exterior/detail/window-reveal.png", "Close-up architectural detail photograph of a window reveal and frame on a renovated house exterior, natural daylight, no people, no text, realistic photography."],
        ["interior/hallway.png", "Interior real estate photograph of a bright renovated hallway with natural window light, minimal modern interior design, no people, no text, realistic architectural interior photography."],
        ["interior/stairs.png", "Interior real estate photograph of a renovated staircase with natural window light, minimal modern interior design, no people, no text, realistic architectural interior photography."],
      ];
      await image("kestrel-studio/logo.png",
        "Flat app icon design, like a modern iOS/macOS app icon sticker. A solid opaque charcoal-grey rounded-square badge containing a simple white silhouette of a kestrel bird in flight, wings swept back, minimal geometric shape. Flat solid colors only, matte finish, no gradient, no glow, no lighting effects, no bloom, no transparency effects, crisp hard edges, print-ready flat vector illustration, similar to a Notion or Linear app icon. No text.",
        { transparent: true, aspectRatio: "1:1" });
      if (sanity) {
        await image(`kestrel-studio/${shots[0]![0]}`, shots[0]![1], { aspectRatio: "4:3" });
        return;
      }
      for (const [path, prompt] of shots) await image(`kestrel-studio/${path}`, prompt, { aspectRatio: "4:3" });

      await video("kestrel-studio/walkthrough.mp4",
        "Slow, smooth cinematic camera dolly forward through a bright, minimally renovated hallway into a naturally lit staircase, real estate walkthrough style, steady motion, no people, no text overlays, soft natural daylight, realistic architectural interior.",
        { duration: 7 });

      await narration("kestrel-studio/site-visit.m4a",
        "Site visit, the fourteenth of August. Overcast the whole morning, which was lucky — the south elevation is unshootable in direct sun. Everything in the exterior set is from before eleven. The interior shots still need doing again. The light was gone by the time we got inside, and the flash makes the floor look yellow. Otherwise the framing's in good shape for the client review on Friday.",
        "Hank (en)");

      const [logoBytes, entrance, hallway] = await Promise.all([
        readAsset("kestrel-studio/logo.png"), readAsset("kestrel-studio/exterior/entrance.png"), readAsset("kestrel-studio/interior/hallway.png"),
      ]);

      await pdfWithImage("kestrel-studio/Site report.pdf", {
        title: "Meridian House — Site Report", logo: logoBytes,
        sections: [
          { heading: "Visit summary", body: "Site visit on 14 August. Overcast conditions held through the morning, which suited the south elevation — that face is unshootable in direct sun. The exterior set below is complete; the interior set still needs a reshoot once the afternoon light is better." },
          { heading: "Entrance", image: entrance, imageCaption: "Front entrance, shot before 11am." },
          { heading: "Hallway (needs reshoot)", image: hallway, imageCaption: "Flash-lit; floor reads yellow. Redo with bounced light." },
        ],
      });

      xlsxWorkbook("kestrel-studio/Renovation budget.xlsx", [
        {
          name: "Budget", rows: [
            ["Line item", "Budgeted", "Committed", "Remaining"],
            ["Demolition", 18000, 17200, cell("B2-C2", 800)],
            ["Structural framing", 64000, 61500, cell("B3-C3", 2500)],
            ["Electrical", 22000, 19800, cell("B4-C4", 2200)],
            ["Plumbing", 19000, 18100, cell("B5-C5", 900)],
            ["Windows & doors", 31000, 29400, cell("B6-C6", 1600)],
            ["Finishes", 47000, 12300, cell("B7-C7", 34_700)],
            ["Contingency", 20000, 0, cell("B8-C8", 20_000)],
            ["Total", cell("SUM(B2:B8)", 221_000), cell("SUM(C2:C8)", 158_300), cell("SUM(D2:D8)", 62_700)],
          ],
        },
      ]);

      await pptxDeck("kestrel-studio/Client proposal.pptx", {
        brand: "Kestrel Studio", accent: "3A3F4B", logo: logoBytes,
        slides: [
          { title: "Meridian House — Renovation Proposal", body: "A full renovation of the existing structure, preserving the original massing while opening the ground floor to natural light." },
          { title: "Entrance", image: entrance },
          { title: "Hallway", image: hallway },
          { title: "Timeline & budget", bullets: ["Demolition and structural work: weeks 1-6", "Systems (electrical, plumbing): weeks 5-10", "Finishes and closeout: weeks 10-14", "Total budget: $221,000, see Renovation budget.xlsx for the line-item breakdown"] },
        ],
      });

      await docxLetter("kestrel-studio/Contract.docx", {
        brand: "Kestrel Studio", logo: logoBytes, date: "2 August 2026",
        paragraphs: [
          "This letter confirms Kestrel Studio's engagement for the Meridian House renovation, covering design development, construction documentation, and periodic site observation through substantial completion.",
          "Fees are structured as a fixed percentage of construction cost, invoiced monthly against the schedule of services attached to this agreement. Reimbursable expenses (printing, site visit travel) are billed at cost.",
          "Please countersign and return one copy to begin work on the week of the 10th.",
        ],
      });
    },
  },
  {
    slug: "marrow-salt",
    async run() {
      const photos: Array<[string, string]> = [
        ["photos/loaf.png", "Professional food photograph of a rustic sourdough bread loaf freshly baked, on a wooden board, natural window light, shallow depth of field, no people, no text, realistic bakery photography."],
        ["photos/soup.png", "Professional food photograph of a warm bowl of soup on a rustic wooden table, garnished, natural light, shallow depth of field, no people, no text, realistic restaurant photography."],
        ["photos/pastry-case.png", "Professional interior photograph of a bakery pastry display case filled with baked goods, warm natural light, no people, no text, realistic bakery photography."],
        ["photos/dining-room.png", "Professional interior photograph of a small cozy restaurant dining room, warm ambient lighting, rustic modern decor, no people, no text, realistic hospitality photography."],
      ];
      await image("marrow-salt/logo.png",
        "Flat app icon design, like a modern iOS/macOS app icon sticker. A solid opaque deep-rust rounded-square badge containing a simple white wheat-stalk icon, a few simple grain heads on a single stem, minimal geometric shape. Flat solid colors only, matte finish, no gradient, no glow, no lighting effects, no bloom, no transparency effects, crisp hard edges, print-ready flat vector illustration, similar to a Notion or Linear app icon. No text.",
        { transparent: true, aspectRatio: "1:1" });
      if (sanity) {
        await image(`marrow-salt/${photos[0]![0]}`, photos[0]![1], { aspectRatio: "4:3" });
        return;
      }
      for (const [path, prompt] of photos) await image(`marrow-salt/${path}`, prompt, { aspectRatio: "4:3" });

      await video("marrow-salt/promo.mp4",
        "Slow cinematic push-in shot of a bakery pastry display case with warm golden light, followed by steam rising from a fresh loaf of bread on a wooden counter, appetizing food commercial style, no people, no text overlays, warm cozy lighting.",
        { duration: 6 });

      await musicClip("marrow-salt/dining-playlist.mp3",
        "Warm, cozy instrumental acoustic music with soft nylon guitar, gentle upright bass, and brushed percussion, relaxed bakery cafe ambiance, no vocals, mid tempo.", 25);

      const [logoBytes, loaf, pastryCase] = await Promise.all([
        readAsset("marrow-salt/logo.png"), readAsset("marrow-salt/photos/loaf.png"), readAsset("marrow-salt/photos/pastry-case.png"),
      ]);

      await pdfWithImage("marrow-salt/Winter menu.pdf", {
        title: "Marrow & Salt — Winter Menu", logo: logoBytes,
        sections: [
          { heading: "Bread", body: "Sunday loaf — $9. Slow-fermented, baked to order, recipe in sunday-bread.md." },
          { heading: "Soup", body: "Root vegetable & barley — $12. A rotating winter soup, always with our sourdough on the side." },
          { image: loaf },
        ],
      });

      xlsxWorkbook("marrow-salt/Menu costing.xlsx", [
        {
          name: "Costing", rows: [
            ["Dish", "Menu price", "Ingredient cost", "Margin (%)"],
            ["Sunday loaf", 9, 2.1, cell("100*(1-(C2/B2))", 100 * (1 - 2.1 / 9), 1)],
            ["Root vegetable & barley soup", 12, 3.4, cell("100*(1-(C3/B3))", 100 * (1 - 3.4 / 12), 1)],
            ["Pastry case item (avg)", 5.5, 1.3, cell("100*(1-(C4/B4))", 100 * (1 - 1.3 / 5.5), 1)],
            ["Set dinner (3-course)", 42, 14.5, cell("100*(1-(C5/B5))", 100 * (1 - 14.5 / 42), 1)],
          ],
        },
      ]);

      await pptxDeck("marrow-salt/Investor one-pager.pptx", {
        brand: "Marrow & Salt", accent: "B4622A", logo: logoBytes,
        slides: [
          { title: "Marrow & Salt", body: "An independent bakery and restaurant opening a second location, funded by the winter menu's early performance." },
          { title: "The room", image: pastryCase },
          { title: "Unit economics", bullets: ["Average check: $34", "Food cost: 29% of menu price", "Break-even at 62 covers/day; currently averaging 71"] },
        ],
      });

      await docxLetter("marrow-salt/Supplier letter.docx", {
        brand: "Marrow & Salt", logo: logoBytes, date: "5 September 2026",
        paragraphs: [
          "We'd like to increase our standing flour order to match the new winter menu volumes — please quote the weekly rate at the higher tier.",
          "We're also interested in a fixed six-month price on the barley, given how central it is to the new soup.",
        ],
      });
    },
  },
  {
    slug: "fernweh",
    async run() {
      const renders: Array<[string, string]> = [
        ["renders/product-hero.png", "Professional studio product photograph of a compact retro-modern travel camera in matte olive green and tan leather, three-quarter angle, plain neutral studio background, soft even studio lighting, no people, no text, realistic commercial product photography."],
        ["renders/product-detail.png", "Close-up studio product photograph of a compact retro-modern travel camera's lens and dial details, matte olive green and tan leather, soft studio lighting, plain neutral background, no people, no text, realistic commercial product photography."],
        ["renders/lifestyle-shot.png", "Lifestyle product photograph of a compact retro-modern travel camera resting on a wooden table next to a passport and a leather travel journal, warm natural window light, no people, no text, realistic commercial lifestyle photography."],
      ];
      await image("fernweh/logo.png",
        "Flat app icon design, like a modern iOS/macOS app icon sticker. A solid opaque burnt-orange rounded-square badge containing a simple white compass-needle icon, a diamond needle shape pointing up with a small circle at its center, minimal geometric shape. Flat solid colors only, matte finish, no gradient, no glow, no lighting effects, no bloom, no transparency effects, crisp hard edges, print-ready flat vector illustration, similar to a Notion or Linear app icon. No text.",
        { transparent: true, aspectRatio: "1:1" });
      if (sanity) {
        await image(`fernweh/${renders[0]![0]}`, renders[0]![1], { aspectRatio: "4:3" });
        return;
      }
      for (const [path, prompt] of renders) await image(`fernweh/${path}`, prompt, { aspectRatio: "4:3" });

      await video("fernweh/demo.mp4",
        "Slow cinematic rotating studio shot of a compact retro-modern travel camera on a plain background, soft dramatic studio lighting highlighting matte olive and leather textures, commercial product video style, no people, no text overlays.",
        { duration: 6 });

      await musicClip("fernweh/launch-sting.mp3",
        "Short upbeat modern tech brand audio sting, clean synth pluck and light percussion hit, confident and minimal, no vocals, high-end consumer tech product launch feel.", 10);

      const [logoBytes, hero, lifestyle] = await Promise.all([
        readAsset("fernweh/logo.png"), readAsset("fernweh/renders/product-hero.png"), readAsset("fernweh/renders/lifestyle-shot.png"),
      ]);

      await pdfWithImage("fernweh/One-pager.pdf", {
        title: "Fernweh Wayfarer — Investor One-Pager", logo: logoBytes,
        sections: [
          { heading: "What it is", body: "A compact travel camera built for people who'd rather remember a trip than manage a feed — no app, no cloud upload, a single button, and a battery that lasts the flight." },
          { image: hero },
          { heading: "Where we are", body: "1,400 units pre-sold at $249, first production run shipping in November. CAC is currently $38 against a $249 average order value." },
        ],
      });

      xlsxWorkbook("fernweh/Financials.xlsx", [
        {
          name: "Financials", rows: [
            ["Month", "Revenue", "Burn", "Cash on hand"],
            ["June", 41000, 68000, 412000],
            ["July", 58000, 71000, 399000],
            ["August", 87000, 74000, 412000],
            ["Runway (months)", "", "", cell("D4/AVERAGE(C2:C4)", 412_000 / ((68000 + 71000 + 74000) / 3), 1)],
          ],
        },
      ]);

      await pptxDeck("fernweh/Pitch deck.pptx", {
        brand: "Fernweh", accent: "B4622A", logo: logoBytes,
        slides: [
          { title: "Fernweh Wayfarer", body: "A travel camera for people who want the photo, not the feed.", image: hero },
          { title: "Why now", bullets: ["Phone cameras are good enough that the gap is no longer image quality — it's attention", "1,400 units pre-sold before a single ad ran", "CAC of $38 against a $249 AOV"] },
          { title: "The product", image: lifestyle },
          { title: "The ask", bullets: ["Raising $1.2M to fund the second production run", "18-month runway at current burn", "Use of funds: inventory (60%), team (25%), marketing (15%)"] },
        ],
      });

      await docxLetter("fernweh/Investor update.docx", {
        brand: "Fernweh", logo: logoBytes, date: "1 September 2026",
        paragraphs: [
          "August revenue came in at $87k, up from $58k in July, driven mostly by the pre-order page going live on the second week of the month.",
          "The first production run is on track for a November ship date. We've locked pricing on the injection-molded body and are finalizing the leather supplier for the strap.",
          "We're opening a small round to fund the second production run — details in the attached one-pager.",
        ],
      });
    },
  },
];

async function readAsset(path: string): Promise<Buffer> {
  const { readFile } = await import("node:fs/promises");
  return readFile(join(OUT, path));
}

const failures: string[] = [];
for (const folder of folders) {
  if (only && folder.slug !== only) continue;
  console.log(`\n=== ${folder.slug} ===`);
  try {
    await folder.run();
  } catch (error) {
    failures.push(folder.slug);
    console.error(`  ${folder.slug} failed: ${(error as Error).message}`);
  }
}
console.log(failures.length ? `\ndone, with failures in: ${failures.join(", ")}` : "\ndone.");
if (failures.length) process.exitCode = 1;
