import Link from "next/link";
import { BrandLockup, BrandMark } from "@/components/brand";
import { Faq, type FaqItem } from "@/components/faq";
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
  ShieldIcon,
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
  { href: "#agents", label: "Agents" },
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

/** The families the dashboard opens today. Kept in step with lib/preview.ts. */
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
    title: "You leave an agent running",
    body: "Every piece of work it finishes becomes its own Save, with its name on it. The first thing you read when you sit back down is what it did.",
  },
  {
    title: "A number turns out to be wrong",
    body: "Restore brings back the version from before and records the return as another Save. If that was the wrong call, you can undo the undo.",
  },
  {
    title: "You come back after two weeks",
    body: "The timeline says what happened, in order, in plain sentences. You don’t have to open eleven files and work it out.",
  },
  {
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

/** The facts a serious visitor needs before handing over a real folder. */
const DETAILS: {
  Glyph: (props: { className?: string }) => React.JSX.Element;
  term: string;
  body: string;
  link?: { href: string; label: string };
}[] = [
  {
    Glyph: ShieldIcon,
    term: "You can read it",
    body: "GoodFolder is open source, all of it, under the AGPL: the part that touches your files, the dashboard, and the server behind them. You don\u2019t have to take our word for what it does, and if you\u2019d rather run the whole thing yourself, you can.",
    link: { href: SOURCE_URL, label: "See the code" },
  },
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
            <div className="mx-auto max-w-3xl text-center">
              <p className="gf-eyebrow">For documents, spreadsheets, decks, photos, and recordings</p>
              <h1 className="gf-display-xl mt-5">
                Let the agent work on your files.
                <br />
                <i>Keep a way back.</i>
              </h1>
              <p className="gf-lead mx-auto mt-7 max-w-2xl">
                GoodFolder gives a folder on your computer a history you can read. When a piece of work is finished,
                it records what changed, who changed it, and a version you can return to.
              </p>
              <div className="mt-9 flex justify-center">
                <Link href="/dashboard" className="gf-button-primary gf-button-lg">
                  Open your folders <ArrowRightIcon />
                </Link>
              </div>
              <p className="gf-faint mt-6 text-[13px]">
                A one-time sign-in link by email. No password, and nothing to install to look around.
              </p>
              <p className="gf-faint mt-2.5 text-[13px]">
                Open source, all of it, under the AGPL.{" "}
                <a href={SOURCE_URL} className="gf-accent underline underline-offset-2">
                  Read the code
                </a>{" "}
                that touches your files, or run the whole thing yourself.
              </p>
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
          <div className="gf-wrap">
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
        </section>

        {/* ----------------------------------------------------------- File types */}
        <section id="files" className="gf-band scroll-mt-16">
          <div className="gf-wrap">
            <div className="gf-head">
              <p className="gf-eyebrow">See it before you trust it with anything</p>
              <h2 className="gf-h2 mt-4">Open the folder in a browser. The files are just there.</h2>
              <p className="gf-lead mt-5">
                Read the headings and tables in a Word file, look at the formula behind a cell, move through a deck
                slide by slide, open a photo at full size, play the video, listen to the recording.
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

            <div className="mt-10 grid gap-5 sm:grid-cols-3">
              {(
                [
                  ["view-document", "A Word file, with its headings, table and image intact."],
                  ["view-spreadsheet", "Every sheet in the workbook, and the formula behind the selected cell."],
                  ["view-slides", "A deck, slide by slide, saying plainly where the layout is approximated."],
                ] as const
              ).map(([id, caption]) => (
                <figure key={id} className="m-0">
                  <Shot id={id} className="gf-shot-plain" />
                  <figcaption className="gf-shot-caption">{caption}</figcaption>
                </figure>
              ))}
            </div>

            <p className="gf-faint mt-6 text-[13px]">
              Those three are real captures of the dashboard, not drawings of it.
            </p>

            <figure className="mx-auto mt-8 max-w-xl">
              <Shot id="view-media" className="gf-shot-plain" />
              <figcaption className="gf-shot-caption">
                Photos, video, and audio open on the page too, so a folder of recordings works like any other.
              </figcaption>
            </figure>

            <div className="gf-notice gf-notice-quiet mt-8">
              <LockIcon />
              <span>
                <b>Read here. Keep editing in the usual app.</b> Word, Excel and PowerPoint files stay read-only in
                the browser, so a preview can’t rewrite the original. You can edit notes, plain text, and simple
                tables here. Every file can receive comments and Change Proposals.
              </span>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------------- Moments */}
        <section className="gf-band gf-band-tint">
          <div className="gf-wrap">
            <div className="gf-head">
              <p className="gf-eyebrow">When it earns its place</p>
              <h2 className="gf-h2 mt-4">Four moments a history pays for itself.</h2>
            </div>
            <ul className="mt-9 grid gap-x-14 gap-y-7 sm:grid-cols-2">
              {MOMENTS.map(({ title, body }) => (
                <li key={title} className="border-t border-[var(--gf-line-strong)] pt-4">
                  <b className="gf-h3 block">{title}</b>
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
              <p className="gf-shot-caption">
                The same folder, in the same place, with the same files in it. That is the whole change.
              </p>
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
                These four actions run on the computer that holds the folder. The dashboard shows what happened and
                tells you which computer to use when an action needs the original files.
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
              <p className="gf-eyebrow">One folder, every computer</p>
              <h2 className="gf-h2 mt-4">Pick up where you left off.</h2>
              <p className="gf-lead mt-5">
                Open the folder on your laptop or desktop and you’ll see the same Saves in the same order. If both
                copies changed, GoodFolder keeps each version, explains the difference, and lets you choose what to
                keep.
              </p>
              <ul className="mt-6 grid gap-2.5">
                {[
                  "The same Saves, in the same order, on every computer you use",
                  "No silent overwrite and no strange markers inside your files",
                  "Keep your version, the other version, or both as clearly named files",
                ].map((line) => (
                  <li key={line} className="flex gap-2.5">
                    <CheckIcon className="gf-check" />
                    <span className="gf-body text-[14.5px]">{line}</span>
                  </li>
                ))}
              </ul>
              <p className="gf-faint mt-6 max-w-xl text-[13px] leading-relaxed">
                For now, this works across your own computers. People you invite use the browser to read files, leave
                comments, and send Change Proposals for you to review.
              </p>
            </div>
            <Shot id="devices" />
          </div>
        </section>

        {/* ------------------------------------------------------ People and agents */}
        <section id="agents" className="gf-band gf-band-tint scroll-mt-16">
          <div className="gf-wrap">
            <div className="gf-head">
              <p className="gf-eyebrow">Human approval stays in the product</p>
              <h2 className="gf-h2 mt-4">An assistant can look. It can’t approve itself.</h2>
              <p className="gf-lead mt-5">
                A browser assistant can read the folder and prepare useful work, but GoodFolder won’t let it accept
                its own proposal or change who has access. That boundary is in the product, not in a setting you have
                to remember to switch on, and you don’t have to believe us about it:{" "}
                <a href={SOURCE_URL} className="gf-accent underline underline-offset-2">
                  the code is public
                </a>
                .
              </p>
            </div>

            <div className="mt-10 grid gap-4 lg:grid-cols-2">
              <div className="gf-card p-7">
                <div className="flex items-center gap-3">
                  <span className="gf-feature-icon">
                    <SparklesIcon />
                  </span>
                  <h3 className="text-[18px] font-bold tracking-[-.02em]">A browser assistant can</h3>
                </div>
                <ul className="mt-5 grid gap-2.5">
                  {AGENT_CAN.map((line) => (
                    <li key={line} className="flex gap-2.5">
                      <CheckIcon className="gf-check" />
                      <span className="gf-body text-[14.5px]">{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
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
                <p className="gf-on-dark-faint mt-6 text-[13px] leading-relaxed">
                  Suggestions wait as Change Proposals. Your folder doesn’t change until you accept one.
                </p>
              </div>
            </div>

            <div className="mt-14 grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,.95fr)]">
              <div>
                <p className="gf-eyebrow">No need to copy and paste the page into chat</p>
                <h3 className="gf-h2 mt-4 text-[1.5rem] sm:text-[1.75rem]">
                  The dashboard can tell an assistant what’s here.
                </h3>
                <p className="gf-body mt-5">
                  Most assistants have to guess how a website works. With WebMCP, GoodFolder gives the browser a list
                  of eighteen named tools as soon as you open a folder.
                </p>
                <p className="mt-6 grid gap-4 sm:grid-cols-2">
                  <span className="block">
                    <b className="gf-figure-num">14</b>
                    <span className="gf-body mt-1.5 block text-[14px]">
                      Read files, timelines, outlines, cell ranges, and Restore previews. They can’t change anything.
                    </span>
                  </span>
                  <span className="block">
                    <b className="gf-figure-num">4</b>
                    <span className="gf-body mt-1.5 block text-[14px]">
                      Add comments or prepare Change Proposals. A person still decides whether to use them.
                    </span>
                  </span>
                </p>
                <p className="gf-faint mt-6 max-w-xl text-[12.5px] leading-relaxed">
                  WebMCP is still a draft from the W3C Web Machine Learning Community Group. It works in ChatGPT’s
                  desktop browser as Site tools, and Chrome has experimental support. If WebMCP isn’t available, the
                  dashboard works normally without it.
                </p>
              </div>
              <AgentPreview />
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
              {DETAILS.map(({ Glyph, term, body, link }) => (
                <div key={term} className="gf-verb">
                  <h3 className="gf-verb-name">
                    <Glyph />
                    {term}
                  </h3>
                  <p className="gf-body text-[14.5px]">
                    {body}
                    {link && (
                      <>
                        {" "}
                        <a href={link.href} className="gf-accent underline underline-offset-2">
                          {link.label}
                        </a>
                        .
                      </>
                    )}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

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
            <BrandMark size={80} inverse title="" />
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
              Source on GitHub
            </a>{" "}
            · AGPL-3.0 · © {new Date().getFullYear()} GoodFolder
          </p>
        </div>
      </footer>
    </div>
  );
}
