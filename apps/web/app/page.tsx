import Image from "next/image";
import Link from "next/link";
import { BrandLockup, BrandMark } from "@/components/brand";
import { Faq, type FaqItem } from "@/components/faq";
import { MascotPose } from "@/components/folder-mascot";
import { ForEngineers } from "@/components/for-engineers";
import { PricingTiers } from "@/components/pricing";
import { AgentPreview, TimelinePreview } from "@/components/product-preview";
import { Shot } from "@/components/shot";
import {
  ArrowRightIcon,
  AudioIcon,
  CheckIcon,
  ClockIcon,
  ComputerIcon,
  CrossCircleIcon,
  DocumentIcon,
  FolderIcon,
  GitHubIcon,
  ImageIcon,
  LockIcon,
  NoteIcon,
  PdfIcon,
  RestoreIcon,
  SaveIcon,
  SheetIcon,
  SlidesIcon,
  SparklesIcon,
  SyncIcon,
  TerminalIcon,
  TimelineIcon,
  VideoIcon,
} from "@/components/icons";

/** The AGPL obliges us to offer this to anyone using the hosted service. */
const SOURCE_URL = "https://github.com/areia-ai/goodfolder";

const NAV = [
  { href: "#files", label: "Your files" },
  { href: "#how", label: "How it works" },
  { href: "#webmcp", label: "WebMCP" },
  { href: "#questions", label: "Questions" },
];

/** What a folder can't tell you today. The reason the rest of the page exists. */
const GAPS = [
  {
    title: "The agent finished",
    body: "It worked through the folder while you were somewhere else. The only record of what it did is the files themselves.",
  },
  {
    title: "Nobody knows which one",
    body: "The newest version of the deck is the one called final_v3. Or final_v3b. Somebody renamed it and moved on.",
  },
  {
    title: "Yesterday is gone",
    body: "You want the numbers from before the rewrite, and the only copy is whatever the app happened to keep for you.",
  },
];

/**
 * The families the dashboard opens today.
 *
 * Source files also open now, and are deliberately NOT listed here. This row
 * sits two screens under an eyebrow that says what GoodFolder is for, and
 * adding "Code" to it would argue with that line rather than extend it. The
 * technical block near the foot of the page covers it, for the reader who came
 * looking. Keep this list in step with lib/preview.ts for the kinds it names.
 */
const FILE_KINDS = [
  { Glyph: DocumentIcon, name: "Documents", note: "Word" },
  { Glyph: SheetIcon, name: "Spreadsheets", note: "Excel" },
  { Glyph: SlidesIcon, name: "Presentations", note: "PowerPoint" },
  { Glyph: ImageIcon, name: "Images", note: "10 formats" },
  { Glyph: PdfIcon, name: "PDFs", note: "" },
  { Glyph: VideoIcon, name: "Video", note: "" },
  { Glyph: AudioIcon, name: "Audio", note: "" },
  { Glyph: NoteIcon, name: "Notes & tables", note: "editable here" },
];

/** Relevance, as situations rather than features. */
const MOMENTS = [
  {
    Glyph: SparklesIcon,
    title: "You leave an agent running",
    body: "Every piece of work it finishes becomes its own Save, with its name on it. The first thing you read when you sit back down is what it did.",
  },
  {
    Glyph: RestoreIcon,
    title: "A number turns out to be wrong",
    body: "Restore brings back the version from before and records the return as another Save. If that was the wrong call, you can undo the undo.",
  },
  {
    Glyph: ClockIcon,
    title: "You come back after two weeks",
    body: "The timeline says what happened, in order, in plain sentences. You don’t have to open eleven files and work it out.",
  },
  {
    Glyph: ComputerIcon,
    title: "You move to the other computer",
    body: "Sync carries the same history across, so the folder picks up in the same place instead of starting a second copy of the truth.",
  },
];

const STEPS = [
  {
    title: "Point an agent at a folder",
    body: "Codex, Claude Code, and other agents that speak the same protocol can set it up. Nothing is moved and nothing is renamed.",
  },
  {
    title: "Work the way you already do",
    body: "Same files, same apps. When a piece of work is finished, GoodFolder records a Save with a short description and the name of whoever did it.",
  },
  {
    title: "Read the history when you need it",
    body: "Open the timeline to see who did what and when, and to bring back any earlier version of the folder.",
  },
];

const ACTIONS = [
  {
    Glyph: SaveIcon,
    name: "Save",
    body: "Capture the folder as it looks now. GoodFolder adds a short summary and the name of the person or agent who did the work.",
  },
  {
    Glyph: SyncIcon,
    name: "Sync",
    body: "Use the folder on another computer and pick up where you left off. If both copies changed, GoodFolder keeps both and tells you what happened.",
  },
  {
    Glyph: TimelineIcon,
    name: "Timeline",
    body: "See every Save in order, with the author, the time, and a plain description of what changed.",
  },
  {
    Glyph: RestoreIcon,
    name: "Restore",
    body: "Bring back any earlier version. GoodFolder records the return as another Save, so you can change your mind later.",
  },
];

const AGENT_CAN = [
  "Read any file in the folder you have open",
  "Explain any Save in the timeline",
  "Pull out an outline, a passage, or a range of cells",
  "Show what Restore would change before it runs",
  "Leave a comment or send a Change Proposal",
];

const ONLY_YOU_CAN = [
  "Save work straight into the folder",
  "Accept or reject a Change Proposal",
  "Invite people or change who has access",
  "Restore or undo from the computer where the folder lives",
  "Delete anything",
];

const SOURCE_PARTS = [
  "The command-line tool on your computer",
  "The agent server and all eighteen WebMCP tools",
  "The dashboard and hosted-service code",
  "The storage service and Docker setup",
];

/** The facts a serious visitor needs before handing over a real folder. */
const DETAILS: {
  Glyph: (props: { className?: string }) => React.JSX.Element;
  term: string;
  body: string;
}[] = [
  {
    Glyph: ComputerIcon,
    term: "What you need",
    body: "A folder on your own computer, and either an agent that speaks the Model Context Protocol or a terminal you’re willing to type one line into. The dashboard itself needs nothing but a browser.",
  },
  {
    Glyph: FolderIcon,
    term: "Where your files sit",
    body: "Where they already are, in the formats they already have. GoodFolder keeps a copy of the folder’s history so the same folder can open on your other computers.",
  },
  {
    Glyph: CrossCircleIcon,
    term: "What it isn’t",
    body: "It isn’t a cloud drive and it isn’t a backup service. It remembers what happened inside a working folder. Keep the backup you already trust.",
  },
  {
    Glyph: ClockIcon,
    term: "How early it is",
    body: "Early. There’s no installer and no desktop app yet, so a folder is set up from the computer it lives on. It has had the most use on macOS. After setup, the dashboard works in any browser.",
  },
];

const QUESTIONS: FaqItem[] = [
  {
    question: "What happens when I open my folders?",
    defaultOpen: true,
    answer: [
      "You give an email address and we send a one-time sign-in link. There’s no password to make up and nothing to install.",
      "Once you’re in, you’ll see the folders you own and any folder someone has shared with you. If a colleague invited you, sign in with the address they used.",
    ],
  },
  {
    question: "What happens if an AI agent makes a mistake?",
    answer: [
      "The mistake gets its own Save in the timeline. You can see that Codex made it, which files it touched, and when it happened.",
      "On the computer where the folder lives, you can undo the latest Save or return to any earlier one. GoodFolder shows a preview first and records the return as a new Save, which means you can undo that too.",
    ],
  },
  {
    question: "What can someone I invite actually do?",
    answer: [
      "They work in the browser. They can read the files, follow the timeline, leave comments, and send you a Change Proposal.",
      "They can’t save into your folder, accept their own proposal, or change who has access. Those stay with you, on the computer where the folder lives.",
    ],
  },
  {
    question: "Do I have to move my files into a new editor?",
    answer: [
      "No. The folder stays where it is, and every file keeps its original format.",
      "Word, Excel and PowerPoint files open as read-only previews in the browser, so GoodFolder can’t rewrite the originals. You can edit notes, plain text, and simple tables in the dashboard. For everything else, keep using the app you use now.",
    ],
  },
  {
    question: "Can my AI assistant use GoodFolder directly?",
    answer: [
      "Yes, in two places. On your computer, GoodFolder uses the Model Context Protocol, so Codex, Claude Code, and other compatible agents can protect a folder, Save, Sync, and Restore.",
      "The dashboard also gives a browser assistant eighteen WebMCP tools. Fourteen only read; the other four can add a comment or prepare a Change Proposal, but a person still has to accept it.",
      "WebMCP comes from the W3C Web Machine Learning Community Group and is still a draft. If your browser doesn’t support it, the dashboard works normally without those tools.",
    ],
  },
  {
    question: "Can I keep code in a GoodFolder?",
    answer: [
      "Yes. A folder with an app in it saves, syncs and restores like any other, source files open in the browser, and an assistant can send you a Change Proposal for one.",
      "Some things are left out of a Save on purpose: the packages a project downloads, the output its own tools rebuild, and anything shaped like a password or a key. Nothing you would want to keep is dropped silently, and you can ask for any of it back.",
      "It is not a replacement for the tools an engineering team already uses, and it does not deploy anything. If you use one of those, keep it. This sits beside it.",
    ],
  },
  {
    question: "Is this a cloud drive or a backup service?",
    answer: [
      "No. GoodFolder isn’t a replacement for your cloud drive or backup, so keep the backup you already trust.",
      "Its job is to remember what happened inside a working folder and help you recover an earlier version. It keeps a copy so you can use the same folder on your other computers, but it isn’t meant as a place to dump files for storage.",
    ],
  },
  {
    question: "Do earlier versions disappear after 90 days?",
    answer: [
      "No. While your hosted account is active and within its authorized capacity, current files and earlier versions stay protected without an arbitrary expiry date.",
      "If hosted access ends, the account moves to read and export mode for 30 days before scheduled deletion. We send reminders at the start of that period, seven days before deletion, and 24 hours before deletion.",
    ],
  },
];

export default function Landing() {
  return (
    <div className="bg-white">
      <a href="#main" className="gf-skip-link">
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-[var(--gf-line)] bg-white/90 backdrop-blur-xl">
        <div className="gf-wrap flex h-16 items-center justify-between gap-4">
          <Link href="/" aria-label="GoodFolder home" className="-m-2 flex items-center p-2">
            {/* Nobody knows this brand yet, so the name earns its place on a phone
                too. The lockup is 172px and the Dashboard button 102px, so the
                pair needs about 330px; below 360 the mark carries it alone, and
                above it the full lockup fits at every width. Re-measure this and
                the nav breakpoint if the button's label ever changes. */}
            <BrandMark size={36} className="min-[360px]:hidden" title="GoodFolder" />
            <BrandLockup size={36} className="hidden min-[360px]:inline-flex" />
          </Link>
          {/* Not md: the right side now holds GitHub and Dashboard, so the row
              needs 172 + 392 + 208 plus gaps and padding, about 860px. 900 is
              that plus a margin. Re-measure if either label changes. */}
          <nav aria-label="Sections" className="hidden items-center gap-1 min-[900px]:flex">
            {NAV.map((item) => (
              <a key={item.href} href={item.href} className="gf-button-ghost">
                {item.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-1.5">
            {/* Ghost, not a button: the page has one primary action and this is
                not it. No star count either, which would read as a scoreboard
                rather than an invitation. */}
            <a
              href={SOURCE_URL}
              className="gf-button-ghost hidden sm:inline-flex"
              aria-label="GoodFolder source code on GitHub"
            >
              <GitHubIcon className="h-[17px] w-[17px]" />
              GitHub
            </a>
            <Link href="/dashboard" className="gf-button-secondary">
              Dashboard
            </Link>
          </div>
        </div>
      </header>

      <main id="main">
        {/* ---------------------------------------------------------------- Hero */}
        <section className="overflow-hidden pt-16 sm:pt-24">
          <div className="gf-wrap">
            <div className="mx-auto grid max-w-5xl items-center gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6">
              <div className="text-center lg:text-left">
                <p className="gf-eyebrow">For documents, spreadsheets, decks, photos, and recordings</p>
                <h1 className="gf-display-xl mt-5">
                  Let the AI agent work on your files.
                  <br />
                  <i>Keep a way back.</i>
                </h1>
                <p className="gf-lead mx-auto mt-7 max-w-2xl lg:mx-0">
                  GoodFolder gives a folder on your computer a history you can read. When a piece of work is finished,
                  it records what changed, who changed it, and a version you can return to.
                </p>
                <div className="mt-9 flex justify-center lg:justify-start">
                  <Link href="/dashboard" className="gf-button-primary gf-button-lg">
                    Open your folders <ArrowRightIcon />
                  </Link>
                </div>
              </div>
              <MascotPose
                pose="hero"
                priority
                className="mx-auto w-[230px] -scale-x-100 sm:w-[270px] lg:w-[320px] lg:-translate-x-3"
              />
            </div>
          </div>

          <div className="gf-wrap mt-14 sm:mt-20">
            <div className="gf-stage mx-auto max-w-[1240px]">
              <Shot id="workspace" priority />
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------------- Problem */}
        <section className="gf-band gf-band-tight gf-band-tint">
          <div className="gf-wrap grid items-center gap-9 lg:grid-cols-[minmax(0,1fr)_240px] lg:gap-10">
            <div>
              <div className="gf-head">
                <p className="gf-eyebrow">Why this exists</p>
                <h2 className="gf-h2 mt-4">A folder doesn’t remember anything.</h2>
                <p className="gf-lead mt-5">
                  It shows you the files as they are this second. Not how they looked on Tuesday, not who touched them,
                  not what the agent you left running actually did.
                </p>
              </div>
              <ul className="mt-9 grid gap-6 sm:grid-cols-3 sm:gap-7">
                {GAPS.map(({ title, body }) => (
                  <li key={title} className="border-t border-[var(--gf-line-strong)] pt-4">
                    <b className="gf-h3 block">{title}</b>
                    <span className="gf-body mt-1.5 block text-[14px]">{body}</span>
                  </li>
                ))}
              </ul>
            </div>
            <MascotPose pose="pixel" className="mx-auto w-[190px] [image-rendering:pixelated] sm:w-[220px] lg:w-[240px]" />
          </div>
        </section>

        {/* ----------------------------------------------------------- File types */}
        <section id="files" className="gf-band scroll-mt-16">
          <div className="gf-wrap">
            <div className="gf-head">
              {/* The belief this block has to create is "my kind of work is
                  handled properly here". Everything a reader has been told so
                  far — a readable history, a way back, an agent changing files
                  — describes a thing they have only ever seen built for code,
                  so the objection forming right here is "that isn't my work".
                  The answer is the breadth, and the browser view is the
                  evidence for it rather than the point of it. */}
              <p className="gf-eyebrow">Most of a real folder isn’t text</p>
              <h2 className="gf-h2 mt-4">Every kind of file gets the same history. Not just the ones made of words.</h2>
              <p className="gf-lead mt-5">
                A Word file, a spreadsheet, a slide deck, a photograph, a video, a voice note — each one keeps its own
                format, and each one gets the same readable history. Open any of them here when you want to see what
                an agent did, then carry on in the app you already use.
              </p>
            </div>

            <ul className="mt-9 flex flex-wrap gap-2.5">
              {FILE_KINDS.map(({ Glyph, name, note }) => (
                <li key={name} className="gf-kind">
                  <Glyph />
                  {name}
                  {note && <small>{note}</small>}
                </li>
              ))}
            </ul>

            {/* No caption: the row of file kinds above already names what is
                in the picture, and saying it twice was the section explaining
                its own illustration. The read-only reassurance that used to
                sit under it is an objection, and it is answered where
                objections are answered — in the questions near the foot. */}
            <figure className="mx-auto mt-10 max-w-5xl">
              <Image
                src="/shots/file-previews-illustrated.png"
                width={1672}
                height={941}
                alt="A graphical GoodFolder browser showing a document, spreadsheet, presentation, photo, video, and audio file"
                className="gf-shot"
                sizes="(max-width: 1120px) calc(100vw - 40px), 1000px"
              />
            </figure>
          </div>
        </section>

        {/* -------------------------------------------------------------- Moments */}
        <section className="gf-band gf-band-tint">
          <div className="gf-wrap grid items-center gap-10 lg:grid-cols-[minmax(0,.78fr)_minmax(0,1.22fr)] lg:gap-14">
            <div>
              <div className="gf-head">
                <p className="gf-eyebrow">When it earns its place</p>
                <h2 className="gf-h2 mt-4">Four moments a history pays for itself.</h2>
              </div>
              <MascotPose pose="moments" className="mx-auto mt-7 w-full max-w-[440px]" />
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {MOMENTS.map(({ Glyph, title, body }) => (
                <li key={title} className="rounded-[var(--gf-radius)] border border-[var(--gf-line)] bg-white p-5">
                  <span className="gf-feature-icon"><Glyph /></span>
                  <b className="gf-h3 mt-4 block">{title}</b>
                  <span className="gf-body mt-1.5 block text-[14.5px]">{body}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* --------------------------------------------------------------- Setup */}
        <section id="how" className="gf-band scroll-mt-16">
          <div className="gf-wrap grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,.86fr)] lg:gap-16">
            <div>
              <p className="gf-eyebrow">Start with the folder you have</p>
              <h2 className="gf-h2 mt-4">Three steps, and nothing moves.</h2>
              <p className="gf-lead mt-5">
                Setup happens on the computer where the folder lives. Ask your agent to do it, or type it yourself.
              </p>
              <div className="mt-7 grid gap-2.5">
                <p className="gf-prompt">
                  <SparklesIcon />
                  <span>Protect my “Q3 Report” folder with GoodFolder.</span>
                </p>
                <p className="gf-prompt gf-prompt-alt">
                  <TerminalIcon />
                  <span>
                    <span className="gf-faint">or type it yourself · </span>goodfolder connect
                  </span>
                </p>
              </div>
              <ol className="mt-8 grid gap-5">
                {STEPS.map((step, i) => (
                  <li key={step.title} className="flex gap-4">
                    <span className="gf-step-number gf-num shrink-0">{i + 1}</span>
                    <span className="min-w-0">
                      <span className="gf-h3 block">{step.title}</span>
                      <span className="gf-body mt-1 block text-[14px]">{step.body}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <Shot id="agent-connect" />
            </div>
          </div>
        </section>

        {/* --------------------------------------------- Save · Sync · Timeline · Restore */}
        <section className="gf-band gf-band-tint">
          <div className="gf-wrap grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,.95fr)] lg:items-center lg:gap-16">
            <div>
              <div className="gf-head">
                <p className="gf-eyebrow">No expert mode hiding underneath</p>
                <h2 className="gf-h2 mt-4">You only need four words.</h2>
                <p className="gf-lead mt-5">
                  Save, Sync, Timeline, and Restore. That’s it.
                </p>
              </div>
              <div className="mt-9">
                {ACTIONS.map(({ Glyph, name, body }) => (
                  <div key={name} className="gf-verb">
                    <h3 className="gf-verb-name">
                      <Glyph />
                      {name}
                    </h3>
                    <p className="gf-body text-[14.5px]">{body}</p>
                  </div>
                ))}
              </div>
              <p className="gf-faint mt-6 max-w-xl text-[13px] leading-relaxed">
                Sync and Restore happen on the computer that holds the folder. The dashboard shows what happened,
                and tells you which computer to use when an action needs the original files.
              </p>
            </div>
            <div>
              <TimelinePreview />
            </div>
          </div>
        </section>

        {/* ----------------------------------------------------- One history, every computer */}
        <section className="gf-band">
          <div className="gf-wrap grid items-center gap-12 lg:grid-cols-[minmax(0,.92fr)_minmax(0,1fr)] lg:gap-16">
            <div>
              <p className="gf-eyebrow">One folder, every agent</p>
              <h2 className="gf-h2 mt-4">Change agents without starting over.</h2>
              <p className="gf-lead mt-5">
                An agent remembers nothing about last week. The folder does — every Save in order, with the name of
                whoever made it. Point the next one at the same folder and it reads what happened before it touches
                anything.
              </p>
              <ul className="mt-6 grid gap-2.5">
                {[
                  "Codex finishes on your laptop. Tomorrow another agent carries on, already knowing what changed",
                  "The drafts, the notes and the decisions live in the folder, not inside one agent’s memory",
                  "Nothing is quietly overwritten, and no strange markers are left inside your files",
                ].map((line) => (
                  <li key={line} className="flex gap-2.5">
                    <CheckIcon className="gf-check" />
                    <span className="gf-body text-[14.5px]">{line}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-7 rounded-[var(--gf-radius)] border border-[var(--gf-blue-line-soft)] bg-[var(--gf-blue-wash)] p-5">
                <b className="block text-[15px]">Wherever the agent runs.</b>
                <p className="gf-body mt-2 text-[14px]">
                  Codex, Claude Code, OpenClaw and Hermes Agent all speak MCP. Each one connects to GoodFolder on a
                  computer that has the folder, and gets the same actions and the same timeline.
                </p>
              </div>
            </div>
            <div>
              {/* Agent, folder, agent. The two ends change; the middle is what
                  makes the handoff possible, so it is the one drawn in blue.
                  Only marks from a project's own public material are used —
                  the agents without one get an honest glyph instead. */}
              <div className="gf-relay">
                <div className="gf-relay-node">
                  <span className="gf-relay-mark gf-relay-mark-dark"><TerminalIcon /></span>
                  <b>Codex</b>
                  <small>On your laptop</small>
                </div>
                <span className="gf-relay-arrow" aria-hidden="true"><ArrowRightIcon /></span>
                <div className="gf-relay-node gf-relay-hub">
                  <span className="gf-relay-mark"><BrandMark size={42} title="GoodFolder" /></span>
                  <b>Q3 Report</b>
                  <small>24 Saves, in order</small>
                </div>
                <span className="gf-relay-arrow" aria-hidden="true"><ArrowRightIcon /></span>
                <div className="gf-relay-node">
                  <span className="gf-relay-pair">
                    <a href="https://openclaw.ai/" aria-label="OpenClaw">
                      <Image src="/partners/openclaw.svg" alt="" aria-hidden="true" width={42} height={42} />
                    </a>
                    <a href="https://hermes-agent.nousresearch.com/" aria-label="Hermes Agent">
                      <Image src="/partners/hermes-agent.png" alt="" aria-hidden="true" width={42} height={42} />
                    </a>
                  </span>
                  <b>OpenClaw, Hermes Agent</b>
                  <small>In the cloud, through MCP</small>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* --------------------------------------------------------------- WebMCP */}
        <section id="webmcp" className="gf-band gf-band-tint scroll-mt-16">
          <div className="gf-wrap grid items-center gap-12 lg:grid-cols-[minmax(0,.92fr)_minmax(0,1.08fr)] lg:gap-16">
            <div>
              <p className="gf-eyebrow">No copy and paste</p>
              <h2 className="gf-h2 mt-4">WebMCP gives your assistant 18 tools for the folder you have open.</h2>
              <p className="gf-lead mt-5">
                Ask in normal language. Nothing is uploaded to a chat — the assistant reads the folder already in
                front of you.
              </p>

              {/* The counts are the permission story, and the only numbers in
                  this section that a reader can check. The three numbered
                  steps that used to sit above them said what the sentence
                  above already says. */}
              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                <div className="rounded-[var(--gf-radius)] border border-[var(--gf-line)] bg-white p-5">
                  <b className="flex items-baseline gap-2 text-[16px]">
                    <span className="gf-figure-num text-[2rem]">14</span> read and explain
                  </b>
                  <p className="gf-body mt-2 text-[13.5px]">
                    Files, tables, Saves, proposals, Restore previews. Nothing changes.
                  </p>
                </div>
                <div className="rounded-[var(--gf-radius)] border border-[var(--gf-blue-line-soft)] bg-white p-5">
                  <b className="flex items-baseline gap-2 text-[16px]">
                    <span className="gf-figure-num text-[2rem]">4</span> comment or propose
                  </b>
                  <p className="gf-body mt-2 text-[13.5px]">
                    Comments and Change Proposals. They never approve themselves.
                  </p>
                </div>
              </div>

              <p className="gf-faint mt-6 max-w-xl text-[12.5px] leading-relaxed">
                ChatGPT’s built-in browser, ChatGPT Work and Codex find these as{" "}
                <a href="https://learn.chatgpt.com/docs/webmcp" className="underline underline-offset-2">
                  Site tools
                </a>
                .{" "}
                <a href="https://webmachinelearning.github.io/webmcp/" className="underline underline-offset-2">
                  WebMCP
                </a>{" "}
                is a W3C Community Group draft; without it the dashboard works as usual.
              </p>
            </div>
            <AgentPreview />
          </div>
        </section>

        {/* ------------------------------------------------------ Human approval */}
        <section id="agents" className="gf-band scroll-mt-16">
          <div className="gf-wrap">
            <div className="gf-head">
              <p className="gf-eyebrow">Human approval stays in GoodFolder</p>
              <h2 className="gf-h2 mt-4">The assistant can prepare the work. You decide what changes.</h2>
              <p className="gf-lead mt-5">
                Comments and Change Proposals can arrive from the browser. The actions that change a real folder stay
                with the person who owns it.
              </p>
            </div>

            <div className="mt-10 grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_220px_minmax(0,.9fr)] lg:gap-10">
              <div>
                <div className="flex items-center gap-3">
                  <span className="gf-feature-icon"><SparklesIcon /></span>
                  <h3 className="text-[18px] font-bold tracking-[-.02em]">The assistant can</h3>
                </div>
                <ul className="mt-5 grid gap-2.5">
                  {AGENT_CAN.map((line) => (
                    <li key={line} className="flex gap-2.5 border-t border-[var(--gf-line)] pt-2.5">
                      <CheckIcon className="gf-check" />
                      <span className="gf-body text-[14.5px]">{line}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <MascotPose pose="review" className="mx-auto w-[170px] sm:w-[200px] lg:w-[220px]" />

              <div className="gf-panel-dark p-7">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-[10px] border border-[var(--gf-line-on-dark)]">
                    <LockIcon className="h-5 w-5" />
                  </span>
                  <h3 className="text-[18px] font-bold tracking-[-.02em]">Only you can</h3>
                </div>
                <ul className="mt-5 grid gap-2.5">
                  {ONLY_YOU_CAN.map((line) => (
                    <li key={line} className="flex gap-2.5">
                      <CheckIcon className="gf-check" />
                      <span className="gf-on-dark text-[14.5px] leading-relaxed">{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <p className="gf-notice mt-9 text-[15px] font-semibold">
              A suggestion waits as a Change Proposal. Your folder stays unchanged until you accept it.
            </p>
            <p className="gf-faint mt-4 max-w-2xl text-[12.5px] leading-relaxed">
              People you invite work in the browser. They read, comment and send Change Proposals; the folder itself
              stays on your own computers.
            </p>
          </div>
        </section>

        {/* --------------------------------------------------------- Open source */}
        <section className="gf-band">
          <div className="gf-wrap">
            <div className="gf-panel-dark grid gap-10 px-7 py-10 sm:px-10 sm:py-12 lg:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)] lg:items-center lg:px-14">
              <div>
                <p className="gf-eyebrow gf-on-dark-faint">Public by design</p>
                <h2 className="gf-h2 mt-4">Open source, all the way down.</h2>
                <p className="gf-on-dark mt-5 max-w-xl text-[16px] leading-relaxed">
                  GoodFolder doesn’t publish a small client and keep the interesting parts private. The code that
                  touches your files, serves the dashboard, stores history, and runs the hosted service is public under
                  the AGPL.
                </p>
                <a href={SOURCE_URL} className="gf-button-secondary mt-7">
                  <GitHubIcon className="h-[17px] w-[17px]" />
                  Explore the source
                </a>
                <p className="gf-on-dark-faint mt-4 text-[12.5px] leading-relaxed">
                  Prefer your own server? Docker Compose runs the full stack without a cloud account, mail provider,
                  billing provider, or AI key.
                </p>
              </div>
              <ul className="grid gap-3 sm:grid-cols-2">
                {SOURCE_PARTS.map((part) => (
                  <li key={part} className="rounded-[var(--gf-radius)] border border-[var(--gf-line-on-dark)] p-4">
                    <CheckIcon className="gf-check" />
                    <span className="gf-on-dark mt-2 block text-[13.5px] leading-snug">{part}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* --------------------------------------------------------------- Pricing */}
        <section id="pricing" className="gf-band gf-band-tint scroll-mt-16">
          <div className="gf-wrap">
            <div className="gf-head">
              <p className="gf-eyebrow">Run it yourself, or let us run it</p>
              <h2 className="gf-h2 mt-4">Three hosted plans. No folder or contributor limits.</h2>
              <p className="gf-lead mt-5">
                You pay for the protected data inside your folders, not how many folders you make. Documents often use little capacity; photos and video use more.
              </p>
            </div>

            <PricingTiers selfHostUrl={SOURCE_URL} />
          </div>
        </section>

        {/* ----------------------------------------------------- Decision details */}
        <section className="gf-band">
          <div className="gf-wrap">
            <div className="gf-head">
              <p className="gf-eyebrow">Before you hand over a real folder</p>
              <h2 className="gf-h2 mt-4">What you need, and where this is today.</h2>
            </div>
            <div className="mt-9 max-w-4xl">
              {DETAILS.map(({ Glyph, term, body }) => (
                <div key={term} className="gf-verb">
                  <h3 className="gf-verb-name">
                    <Glyph />
                    {term}
                  </h3>
                  <p className="gf-body text-[14.5px]">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* --------------------------------------------------- What it is underneath */}
        {/* Deliberately this far down, and deliberately the only block that
            names the engine. The reader here is the person a colleague has to
            convince, not the person who will use it. See the component. */}
        <ForEngineers sourceUrl={SOURCE_URL} />

        {/* -------------------------------------------------------------------- FAQ */}
        <section id="questions" className="gf-band gf-band-tint scroll-mt-16">
          <div className="gf-wrap">
            <div className="mx-auto max-w-3xl">
              <p className="gf-eyebrow">Questions</p>
              <h2 className="gf-h2 mt-4">Fair questions before you trust it with a folder.</h2>
              <Faq items={QUESTIONS} />
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------------- Final CTA */}
        <section className="gf-wrap py-[var(--gf-section-y)]">
          <div className="gf-panel-dark flex flex-col items-center px-6 py-14 text-center sm:px-14 sm:py-20">
            <span className="grid h-[190px] w-[190px] place-items-center rounded-full bg-white p-2">
              <MascotPose pose="wave" className="w-[180px]" />
            </span>
            <h2 className="gf-h2 mt-7 max-w-2xl">Start with a folder you already use.</h2>
            <p className="gf-on-dark mt-5 max-w-lg text-[16px] leading-relaxed">
              Sign in and look around first. When you’re ready, one sentence to Codex or Claude Code protects a folder
              on your computer, and it shows up here.
            </p>
            <Link href="/dashboard" className="gf-button-secondary gf-button-lg mt-9">
              Open your folders <ArrowRightIcon />
            </Link>
            <p className="gf-on-dark-faint mt-6 text-[13px]">
              A one-time link by email. No password, and your files stay where they are.
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--gf-line)]">
        <div className="gf-wrap flex flex-col items-start justify-between gap-5 py-10 sm:flex-row sm:items-center">
          <BrandLockup size={30} />
          <p className="gf-faint text-[13px]">
            <a href={SOURCE_URL} className="underline underline-offset-2 hover:text-black">
              Proudly open source
            </a>{" "}
            · AGPL-3.0 · © {new Date().getFullYear()} GoodFolder
          </p>
        </div>
      </footer>
    </div>
  );
}
