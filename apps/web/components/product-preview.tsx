/* --------------------------------------------------------------------------
   Static illustrations of the real interface, drawn with the same tokens the
   product uses. Nothing here is focusable or interactive and none of it calls
   an API — the content is example content, labelled as such.
-------------------------------------------------------------------------- */

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

export function TimelinePreview() {
  return (
    <figure className="m-0">
      <Chrome label="Q3 report · Timeline">
        <ol className="grid gap-2">
          {SAVES.map((s) => (
            <li key={s.seq} className="gf-card min-w-0 p-3.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="gf-badge gf-badge-quiet gf-num">#{s.seq}</span>
                <span className="text-[12.5px] font-semibold">{s.actor}</span>
                {s.restore && <span className="gf-badge gf-badge-open">Went back</span>}
                <span className="gf-faint ml-auto text-[11.5px]">{s.when}</span>
              </div>
              <p className="mt-1.5 text-[13.5px] font-medium leading-snug">{s.label}</p>
              <p className="gf-faint mt-1.5 truncate text-[11.5px]">
                {s.counts} · {s.paths}
              </p>
            </li>
          ))}
        </ol>
      </Chrome>
      <figcaption className="gf-preview-caption">Sample timeline. No real files or activity shown.</figcaption>
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
