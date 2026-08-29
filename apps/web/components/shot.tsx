/* --------------------------------------------------------------------------
   Picture slots on the landing page.

   Every slot below is laid out at its final size and aspect ratio, so the
   page reads correctly before a single picture exists. While `src` is empty
   a labelled placeholder holds the space and states the brief; the moment a
   file lands in `apps/web/public/shots/`, set `src` in SHOTS and the picture
   takes over with no layout shift.

   Two kinds of picture, and the difference is deliberate. The four conceptual
   slots are flat vector illustrations in the mascot's house style — thick
   black contours, three source colours, no text. The three `view-*` window
   slots are REAL SCREENSHOTS of the dashboard: their whole job is to prove
   that a genuine Word file, workbook and deck open here, and a drawing cannot
   prove that. `kind` says which is which, and the generation and capture
   briefs both live in `brand/shot-prompts.md`.

   House rules for every slot:
     • White background, so the card reads the same on white and tinted bands.
     • Keep content 5% clear of every edge; the slot has rounded corners.
     • Illustrations: only black #000000, white #FFFFFF, blue #3B82F6, and pale
       blue #F0F6FF. Straight-on and flat, no perspective, gradients, shadows
       or texture. No text — writing is drawn as plain rounded bars.
     • Screenshots: the real light interface, captured at 2× on a clean
       window. No real customer content, no personal address, and no file path
       that identifies whose machine it is.
-------------------------------------------------------------------------- */

export type ShotId =
  | "workspace"
  | "agent-connect"
  | "view-document"
  | "view-spreadsheet"
  | "view-slides"
  | "view-media"
  | "devices";

interface ShotSpec {
  /** Sits under /public/shots/. Empty until the picture is made. */
  src: string;
  /** How it is made. Screenshots carry proof; illustrations carry the brand. */
  kind: "illustration" | "screenshot";
  /** Read to someone who cannot see the picture. Never decorative-only. */
  alt: string;
  /** width / height. The slot reserves exactly this. */
  ratio: string;
  /** Render width at the widest breakpoint, in CSS pixels. */
  renderWidth: number;
  /** Exact pixel size to export at, comfortably above the render width. */
  exportSize: string;
  /** The brief, shown inside the placeholder until the picture exists. */
  brief: string;
}

export const SHOTS: Record<ShotId, ShotSpec> = {
  workspace: {
    src: "/shots/workspace.png",
    kind: "illustration",
    alt: "The GoodFolder dashboard, with files on the left, a spreadsheet in the middle, and two items waiting for review on the right.",
    ratio: "16 / 10",
    renderWidth: 1240,
    exportSize: "2480 × 1550",
    brief:
      "Hero. One application window, straight on, with the mascot as its app icon. Three columns: a rail of six file tiles (page, grid, slide, photo, video, audio) with one selected, a large spreadsheet grid with one cell ringed in blue, and two review cards. The frame that has to say 'this is for everyday files'.",
  },
  "agent-connect": {
    src: "/shots/agent-connect.png",
    kind: "illustration",
    alt: "A plain folder beside a protected GoodFolder, with the same six files sitting in front of each one.",
    ratio: "3 / 2",
    renderWidth: 560,
    exportSize: "1200 × 800",
    brief:
      "Setup, as before and after. Left: a plain white folder with no face. Right: the identical folder, now blue with the mascot face. The same six file tiles sit in front of both in identical positions — the whole point of the frame is that nothing moved.",
  },
  "view-document": {
    src: "/shots/view-document.png",
    kind: "screenshot",
    alt: "A Word document open in the dashboard, showing headings, body text, a table, and an image.",
    ratio: "4 / 3",
    renderWidth: 352,
    exportSize: "1024 × 768",
    brief:
      "REAL SCREENSHOT, first of a matched trio. A .docx open in the reading surface: headings, body text, a small table, one embedded image, and the visible note that Word's page layout is simplified. Crop tight on the page. Same crop rectangle as the other two window shots.",
  },
  "view-spreadsheet": {
    src: "/shots/view-spreadsheet.png",
    kind: "screenshot",
    alt: "A spreadsheet open in the dashboard, with sheet tabs, row and column headers, and the formula for the selected cell.",
    ratio: "4 / 3",
    renderWidth: 352,
    exportSize: "1024 × 768",
    brief:
      "REAL SCREENSHOT, second of the trio. An .xlsx open: sheet tabs along the bottom, sticky row and column headers, one cell selected with its formula shown. The numbers should look like a real budget, not filler.",
  },
  "view-slides": {
    src: "/shots/view-slides.png",
    kind: "screenshot",
    alt: "A presentation open in the dashboard, with its slide thumbnails beside the current slide.",
    ratio: "4 / 3",
    renderWidth: 352,
    exportSize: "1024 × 768",
    brief:
      "REAL SCREENSHOT, third of the trio. A .pptx open: the thumbnail rail on one side, one slide filling the canvas with a title, a couple of bullets and an image, and the visible note that the layout is an approximation.",
  },
  "view-media": {
    src: "/shots/view-media.png",
    kind: "illustration",
    alt: "A photograph, a video player, and an audio recording open side by side in the dashboard.",
    ratio: "21 / 9",
    renderWidth: 1080,
    exportSize: "2100 × 900",
    brief:
      "One wide strip, three equal panes: a flat illustrated landscape, a video frame with a play control and a scrub bar, and an audio waveform with its own player. This is the frame that proves GoodFolder is not a text tool.",
  },
  devices: {
    src: "/shots/devices.png",
    kind: "illustration",
    alt: "A laptop and desktop showing the same folder history, with a two-way arrow between them.",
    ratio: "3 / 2",
    renderWidth: 560,
    exportSize: "1200 × 800",
    brief:
      "Two machines, one history. A laptop and a desktop monitor, each screen showing the same three numbered rows, row for row and bar for bar. A two-way blue arrow spans the gap, with the mascot small underneath it.",
  },
};

export function Shot({
  id,
  className = "",
  priority = false,
}: {
  id: ShotId;
  className?: string;
  priority?: boolean;
}) {
  const spec = SHOTS[id];

  if (!spec.src) {
    return (
      <div
        className={`gf-shot gf-shot-pending ${className}`}
        style={{ aspectRatio: spec.ratio }}
        role="img"
        aria-label={spec.alt}
      >
        <div className="gf-shot-brief">
          <span className="gf-shot-tag">
            {spec.kind === "screenshot" ? "Screenshot" : "Picture"} · {id}
          </span>
          <p>{spec.brief}</p>
          <span className="gf-shot-meta gf-num">
            {spec.ratio.replace(/\s/g, "")} · export {spec.exportSize}
          </span>
        </div>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={spec.src}
      alt={spec.alt}
      className={`gf-shot ${className}`}
      style={{ aspectRatio: spec.ratio }}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
    />
  );
}
