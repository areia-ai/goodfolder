/* --------------------------------------------------------------------------
   Static illustrations of the real interface, drawn with the same tokens the
   product uses. Nothing here is focusable or interactive and none of it calls
   an API — the content is example content, labelled as such.
-------------------------------------------------------------------------- */

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronRightIcon,
  ClockIcon,
  FolderIcon,
  ProposalIcon,
  ViewColumnsIcon,
  ViewGalleryIcon,
  ViewIconsIcon,
  ViewListIcon,
} from "@/components/icons";

function Chrome({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="gf-preview" aria-hidden="true">
      <div className="gf-preview-bar">
        <span className="gf-preview-dot" />
        <span className="gf-preview-dot" />
        <span className="gf-preview-dot" />
        <span className="ml-2">{label}</span>
      </div>
      <div className="gf-preview-body">{children}</div>
    </div>
  );
}

const SAVES = [
  {
    seq: 24,
    actor: "Saved by Codex",
    label: "Added the pricing table and tightened the summary",
    counts: "2 added · 3 changed · 1 removed",
    paths: "report.md · pricing/notes.md",
    when: "Today at 14:32",
  },
  {
    seq: 23,
    actor: "Saved by Priya",
    label: "Accepted a suggestion on the introduction",
    counts: "1 changed",
    paths: "report.md",
    when: "Today at 11:04",
  },
  {
    seq: 22,
    actor: "Saved on Carlos's laptop",
    label: "Went back to how the report looked before the rewrite",
    counts: "4 changed · 2 removed",
    paths: "report.md · outline.md",
    when: "Yesterday at 18:20",
    restore: true,
  },
];

/**
 * The window, as the dashboard actually draws it.
 *
 * This used to be a plain browser frame labelled "Q3 report · Timeline", which
 * described a destination the dashboard no longer has — the timeline moved
 * into the panel beside the listing when the dashboard became a file browser.
 * The shape here now matches the real one: places down the left, a toolbar
 * with the view switcher, the panel about what is selected, and a path with a
 * count at the foot.
 *
 * One picture carries all four verbs: two Saves, one of them made on another
 * computer, and a third that went back.
 */
export function TimelinePreview() {
  return (
    <figure className="m-0">
      <div className="gf-mock" aria-hidden="true">
        <div className="gf-mock-bar">
          <span className="gf-preview-dot" />
          <span className="gf-preview-dot" />
          <span className="gf-preview-dot" />
          <ArrowLeftIcon />
          <ArrowRightIcon />
          <span className="gf-mock-title">Q3 Report</span>
          <span className="gf-mock-views">
            <span><ViewIconsIcon /></span>
            <span className="on"><ViewListIcon /></span>
            <span><ViewColumnsIcon /></span>
            <span><ViewGalleryIcon /></span>
          </span>
        </div>

        <div className="gf-mock-body">
          <div className="gf-mock-side">
            <p className="gf-mock-heading">Locations</p>
            <span className="gf-mock-place"><FolderIcon /><b>All folders</b></span>
            <p className="gf-mock-heading">Smart</p>
            <span className="gf-mock-place">
              <ProposalIcon /><b>Review</b>
              <span className="gf-mock-count">2</span>
            </span>
            <span className="gf-mock-place"><ClockIcon /><b>Recent</b></span>
            <p className="gf-mock-heading">To hand</p>
            <span className="gf-mock-place on"><FolderIcon /><b>Q3 Report</b></span>
          </div>

          <div className="gf-mock-panel">
            <div className="gf-mock-tabs">
              <span>Info</span>
              <span>Review</span>
              <span className="on">History</span>
              <span>People</span>
            </div>
            <ol className="mt-3.5 grid gap-2">
              {SAVES.map((s) => (
                <li key={s.seq} className="gf-mock-save">
                  <div className="gf-mock-save-head">
                    <span className="gf-mock-seq">#{s.seq}</span>
                    <span className="gf-mock-actor">{s.actor}</span>
                    {s.restore && <span className="gf-mock-back">Went back</span>}
                    <span className="gf-mock-when">{s.when}</span>
                  </div>
                  <p className="gf-mock-label">{s.label}</p>
                  <p className="gf-mock-counts">{s.counts} · {s.paths}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="gf-mock-foot">
          <span>GoodFolder</span>
          <ChevronRightIcon />
          <span className="now">Q3 Report</span>
          <span className="ml-auto"><b>7 items</b> · 4.4 MB</span>
        </div>
      </div>
      <figcaption className="gf-preview-caption">Example content. No real files or activity shown.</figcaption>
    </figure>
  );
}

/* --------------------------------------------------------------------------
   How a session with an agent actually reads. Every line below is example
   content; the tool names are the real ones the dashboard registers.
-------------------------------------------------------------------------- */

const EXCHANGE: Array<{ who: "person" | "agent"; text: string; tool?: string; note?: string }> = [
  { who: "person", text: "What did Codex change in the Q3 report yesterday?" },
  {
    who: "agent",
    tool: "get_timeline",
    text: "Save #24 was two hours ago. Codex added the pricing table, tightened the summary, and touched report.md and pricing/notes.md. That came to 2 files added, 3 changed, and 1 removed.",
  },
  { who: "person", text: "The opening paragraph is flabby. Suggest something tighter." },
  {
    who: "agent",
    tool: "propose_document_change",
    text: "Sent as a Change Proposal, with the current text beside my suggestion.",
    note: "The document hasn’t changed. This proposal is waiting for you to accept or reject it.",
  },
];

export function AgentPreview() {
  return (
    <figure className="m-0">
      <Chrome label="Your browser’s assistant, on the dashboard">
        <ol className="grid gap-2.5">
          {EXCHANGE.map((line, i) => (
            <li
              key={i}
              className={`min-w-0 rounded-[var(--gf-radius)] border p-3.5 ${
                line.who === "person"
                  ? "border-[var(--gf-line)] bg-[var(--gf-surface-sunken)]"
                  : "border-[var(--gf-blue-line-soft)] bg-white"
              }`}
            >
              <span className="gf-faint mb-1.5 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[.09em]">
                {line.who === "person" ? "You" : "Assistant"}
                {line.tool && <code className="gf-tool-chip">{line.tool}</code>}
              </span>
              <p className="text-[13.5px] leading-snug">{line.text}</p>
              {line.note && (
                <p className="gf-accent mt-2 text-[12.5px] font-semibold leading-snug">{line.note}</p>
              )}
            </li>
          ))}
        </ol>
      </Chrome>
      <figcaption className="gf-preview-caption">
        Sample conversation. The tool names match the ones registered by this site.
      </figcaption>
    </figure>
  );
}
