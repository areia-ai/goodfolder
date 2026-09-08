import Image from "next/image";
import type { Metadata } from "next";
import { PRODUCT_DESCRIPTION, SITE_URL } from "@/lib/discovery";
import Link from "next/link";
import { BrandLockup, BrandMark } from "@/components/brand";
import { RecoveryDemo } from "@/components/recovery-demo";
import { CtaScope } from "@/components/cta-scope";
import { Faq, type FaqItem } from "@/components/faq";
import { MascotPose } from "@/components/folder-mascot";
import { ForEngineers } from "@/components/for-engineers";
import { HeroAgentDemo } from "@/components/hero-agent-demo";
import { PricingTiers } from "@/components/pricing";
import { Shot } from "@/components/shot";
import {
  ArrowRightIcon,
  AudioIcon,
  DocumentIcon,
  GitHubIcon,
  ImageIcon,
  NoteIcon,
  PdfIcon,
  RestoreIcon,
  SaveIcon,
  SheetIcon,
  SlidesIcon,
  SparklesIcon,
  SyncIcon,
  TimelineIcon,
  VideoIcon,
  WebPageIcon,
} from "@/components/icons";

/** The AGPL obliges us to offer this to anyone using the hosted service. */
const SOURCE_URL = "https://github.com/areia-ai/goodfolder";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: { type: "website", url: SITE_URL, title: "GoodFolder", description: PRODUCT_DESCRIPTION },
};

const NAV = [
  { href: "#files", label: "Your files" },
  { href: "#how", label: "How it works" },
  { href: "#webmcp", label: "Review changes" },
  { href: "#pricing", label: "Pricing" },
  { href: "#questions", label: "Questions" },
];

/**
 * The families the dashboard opens today.
 *
 * Source files also open now, and are deliberately NOT listed here. This row
 * sits two screens under an eyebrow that says what GoodFolder is for, and
 * adding "Code" to it would argue with that line rather than extend it. The
 * technical block near the foot of the page covers it, for the reader who came
 * looking. HTML belongs here as a rendered deliverable, alongside documents.
 * Keep this list in step with lib/preview.ts for the kinds it names.
 */
const FILE_KINDS = [
  { Glyph: DocumentIcon, name: "Documents", note: "Word" },
  { Glyph: SheetIcon, name: "Spreadsheets", note: "Excel" },
  { Glyph: SlidesIcon, name: "Presentations", note: "PowerPoint" },
  { Glyph: ImageIcon, name: "Images", note: "10 formats" },
  { Glyph: PdfIcon, name: "PDFs", note: "" },
  { Glyph: WebPageIcon, name: "Web pages", note: "HTML + JavaScript" },
  { Glyph: VideoIcon, name: "Video", note: "" },
  { Glyph: AudioIcon, name: "Audio", note: "" },
  { Glyph: NoteIcon, name: "Notes & tables", note: "editable here" },
];

const STEPS = [
  {
    title: "Point an agent at a folder",
    body: "Follow the agent setup guide, then ask Codex, Claude Code, or another compatible agent to connect your folder. It keeps its name and location.",
  },
  {
    title: "Work the way you already do",
    body: "Keep using your files and apps. Ask your agent to Save when it finishes a piece of work, or make a Save yourself.",
  },
  {
    title: "Read the history when you need it",
    body: "Read the timeline in your browser. To return to an earlier saved version, ask your agent to Restore on the computer holding the folder.",
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
    body: "Bring back an earlier saved version. GoodFolder records the return as another Save, so you can change your mind later.",
  },
];

const QUESTIONS: FaqItem[] = [
  {
    question: "What do I need to get started?",
    defaultOpen: true,
    answer: [
      "You need a folder on your computer and a compatible agent such as Codex or Claude Code. Follow the Agent setup guide linked on this page to install GoodFolder from source and connect your folder.",
      "There’s no desktop app or installer yet, so setup happens on the computer where the folder lives. After that, the dashboard works in any browser.",
    ],
  },
  {
    question: "Does GoodFolder save every change automatically?",
    answer: ["No. Ask your agent to Save when a piece of work is ready, or make a Save yourself. A Save captures the folder at that point; changes between Saves are not separate versions.", "Make a Save before asking an agent to rewrite something, so you have a version to return to."],
  },
  {
    question: "Do my files leave my computer?",
    answer: ["Your original folder stays where it is. Connecting to the hosted service and syncing sends a copy of the protected files and history to GoodFolder so you can review them in a browser or use them on another computer.", "You can also run the GoodFolder service on your own server. Keep the backup you already trust."],
  },
  {
    question: "What happens if an AI agent makes a mistake?",
    answer: [
      "If you or your agent Save the changed folder, that work appears in the timeline with its author and the files it touched. You can return to a version saved before the mistake.",
      "On the computer where the folder lives, you can preview an undo of the latest Save or Restore an earlier one. Either return creates a new Save, which means you can undo that too.",
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
    question: "Can I open HTML pages with JavaScript?",
    answer: [
      "Yes. HTML files open as rendered pages in the dashboard, with or without JavaScript. A page can use styles, images, video, audio, and data files from the same folder; links to other HTML pages in that folder work too.",
      "Switch between Page and Source to see the result or read the file behind it. An assistant can propose a change and read the page’s render report for missing files or script errors. You review and accept the proposal before it changes the folder.",
      "This works for HTML deliverables such as reports and interactive presentations. It doesn’t run a backend or a build process; apps that need those still use their own tools. Relative JavaScript module imports aren’t bundled by the preview.",
    ],
  },
  {
    question: "Can my AI assistant use GoodFolder directly?",
    answer: [
      "Yes, in two places. On your computer, GoodFolder uses the Model Context Protocol, so Codex, Claude Code, and other compatible agents can protect a folder, Save, Sync, and Restore.",
      "The dashboard also gives a browser assistant twenty-five WebMCP tools. Seventeen only read; the other eight can add a comment or prepare a Change Proposal, including a complete document, spreadsheet, PDF, presentation, or image that stays outside the folder until a person accepts it.",
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
  {
    question: "What happens when I open my folders?",
    answer: [
      "You give an email address and we send a one-time sign-in link. There’s no password to make up and nothing to install.",
      "Once you’re in, you’ll see the folders you own and any folder someone has shared with you. If a colleague invited you, sign in with the address they used.",
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
          {/* Keep the expanded section navigation clear of the brand and account links. */}
          <nav aria-label="Sections" className="hidden items-center gap-1 min-[1100px]:flex">
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
        <section className="overflow-hidden pb-[var(--gf-section-y)] pt-16 sm:pt-24">
          <div className="gf-wrap">
            <p className="gf-eyebrow"><span className="gf-eyebrow-index">01</span>For documents, spreadsheets, decks, web pages, and media</p>
            <h1 className="gf-display-xl mt-7">
              Let AI agents work on your files.
              <br />
              <i>Keep a way back.</i>
            </h1>
            <div className="mt-10 grid items-end gap-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-12">
              <div>
                <p className="gf-lead max-w-[56ch]">
                  GoodFolder gives your working folder a readable history. Save changes made by you or your agents,
                  see who changed which files, and return to an earlier saved version. Keep using your existing apps.
                </p>
                <div className="mt-8 flex flex-wrap items-center gap-4">
                  <Link href="/dashboard" className="gf-button-primary gf-button-lg">
                    Get started <ArrowRightIcon />
                  </Link>
                  <a href="#how" className="gf-button-ghost">See how setup works</a>
                </div>
                <p className="gf-faint mt-5 text-[13px]">Sign in by email, then connect a folder from your computer with a compatible agent.</p>
              </div>
              <MascotPose
                pose="hero"
                priority
                className="w-[200px] -scale-x-100 sm:w-[240px] lg:w-[280px]"
              />
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------- Save/Restore */}
        {/* The first thing under the headline is the product working, on the
            page's own ink. No card, no tint, no second heading repeating the
            hero: the step row and one caption carry it. */}
        <section className="gf-band gf-band-ink">
          <div className="gf-wrap">
            <div className="gf-head">
              <p className="gf-eyebrow"><span className="gf-eyebrow-index">02</span>An example, from Save to Restore</p>
              <h2 className="gf-h2 mt-4">Try the change. <em>Keep a way back.</em></h2>
            </div>
            <div className="mt-9"><RecoveryDemo /></div>
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
              <p className="gf-eyebrow"><span className="gf-eyebrow-index">03</span>Your files, your apps</p>
              <h2 className="gf-h2 mt-4">One history <em>for the whole folder.</em></h2>
              <p className="gf-lead mt-5">
                Word files, spreadsheets, PDFs, slide decks, HTML pages, and media keep their original formats and
                get the same readable history. Open them here when you want to see what an agent did, then carry on
                in the app you already use.
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
            <figure className="gf-figure-wide mt-12">
              <Image
                src="/shots/file-previews-illustrated.png"
                width={1672}
                height={941}
                alt="A graphical GoodFolder browser showing a document, spreadsheet, presentation, photo, video, and audio file"
                className="gf-shot"
                sizes="(max-width: 1400px) 100vw, 1400px"
              />
            </figure>
          </div>
        </section>

        {/* --------------------------------------------------------------- Setup */}
        <section id="how" className="gf-band gf-band-tint scroll-mt-16">
          <div className="gf-wrap grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,.86fr)] lg:gap-16">
            <div>
              <p className="gf-eyebrow"><span className="gf-eyebrow-index">04</span>Start with the folder you have</p>
              <h2 className="gf-h2 mt-4">Start with a folder you already use.</h2>
              <p className="gf-lead mt-5">
                Set up GoodFolder with a compatible agent on the computer holding your folder. There’s no desktop installer yet; the guide walks you through setup from source.
              </p>
              <Link href="/docs" className="gf-button-secondary mt-6">Read the agent setup guide <ArrowRightIcon /></Link>
              <div className="mt-7 grid gap-2.5">
                <p className="gf-prompt">
                  <SparklesIcon />
                  <span>Protect my “Q3 Report” folder with GoodFolder.</span>
                </p>
              </div>
              <ol className="mt-8 grid gap-5">
                {STEPS.map((step, i) => (
                  <li key={step.title} className="flex gap-4">
                    <span className="gf-step-number gf-num shrink-0">{String(i + 1).padStart(2, "0")}</span>
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
          <div className="gf-wrap mt-12">
            <h3 className="gf-h3">Save, Sync, Timeline, Restore.</h3>
            <div className="mt-5 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {ACTIONS.map(({ Glyph, name, body }) => (
                <div key={name} className="border-t border-[var(--gf-line)] pt-4">
                  <h4 className="gf-h3 flex items-center gap-2"><Glyph className="h-5 w-5" />{name}</h4>
                  <p className="gf-body mt-2 text-[14px]">{body}</p>
                </div>
              ))}
            </div>
            <p className="gf-faint mt-6 text-[13px]">Sync sends a copy to your connected GoodFolder service. Your original folder stays in place. Sync and Restore run on a computer holding the folder.</p>
          </div>
        </section>

        {/* -------------------------------------------------------------- Handoff */}
        <section className="gf-band gf-band-ink">
          <div className="gf-wrap">
            <div className="gf-head">
              <p className="gf-eyebrow"><span className="gf-eyebrow-index">05</span>One folder, wherever you work</p>
              <h2 className="gf-h2 mt-4">Pick up <em>with another computer or agent.</em></h2>
              <p className="gf-lead mt-5">Sync carries your saved files and their history to another computer. You or your next agent can read what happened and continue from there.</p>
            </div>
            <div className="mt-9"><HeroAgentDemo /></div>
          </div>
        </section>

        {/* --------------------------------------------------------------- WebMCP */}
        <section id="webmcp" className="gf-band scroll-mt-16">
          <div className="gf-wrap">
            <div className="max-w-3xl">
              <p className="gf-eyebrow"><span className="gf-eyebrow-index">06</span>Your assistant, beside your files</p>
              <h2 className="gf-h2 mt-4">Review your assistant’s changes <em>before accepting them.</em></h2>
              <p className="gf-lead mt-5">
                In compatible browsers, your assistant can read the open file and prepare a Change Proposal beside it.
                You review the result and decide whether to accept it. Browser assistants can propose work; they cannot accept it or Save it themselves.
              </p>

              <p className="gf-faint mt-6 max-w-xl text-[12.5px] leading-relaxed">
                In compatible browsers, ChatGPT’s built-in browser, ChatGPT Work and Codex find these as{" "}
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
            <div className="gf-figure-wide mt-12 grid gap-[var(--gf-section-y)]">
              <figure>
                <figcaption className="gf-figure-label">
                  <span className="gf-eyebrow-index">01</span>
                  Your assistant prepares a Change Proposal
                </figcaption>
                <Image
                  src="/shots/webmcp-proposal.png"
                  alt="Codex beside GoodFolder, where the assistant has prepared a Change Proposal that adds a generated image and its Markdown reference to a recipe."
                  width={3814}
                  height={2074}
                  className="gf-shot mt-5"
                  sizes="(max-width: 1400px) 100vw, 1400px"
                />
              </figure>
              <figure>
                <figcaption className="gf-figure-label">
                  <span className="gf-eyebrow-index">02</span>
                  You review and accept it in GoodFolder
                </figcaption>
                <Image
                  src="/shots/webmcp-result.png"
                  alt="Codex beside GoodFolder, showing the accepted image rendered inline in the recipe between the ingredients and preparation steps."
                  width={3814}
                  height={2080}
                  className="gf-shot mt-5"
                  sizes="(max-width: 1400px) 100vw, 1400px"
                />
              </figure>
            </div>
          </div>
        </section>

        {/* --------------------------------------------------------------- Pricing */}
        <section id="pricing" className="gf-band gf-band-tint scroll-mt-16">
          <div className="gf-wrap">
            <div className="gf-head">
              <p className="gf-eyebrow"><span className="gf-eyebrow-index">08</span>Run it yourself, or let us run it</p>
              <h2 className="gf-h2 mt-4">Three hosted plans. <em>No folder or contributor limits.</em></h2>
              <p className="gf-lead mt-5">
                Choose capacity for your current files and retained history. Every plan includes unlimited folders and contributors. Documents usually need less space than photos and video.
              </p>
            </div>

            <PricingTiers selfHostUrl={SOURCE_URL} />
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
              <p className="gf-eyebrow"><span className="gf-eyebrow-index">09</span>Questions</p>
              <h2 className="gf-h2 mt-4">Fair questions <em>before you trust it with a folder.</em></h2>
              <Faq items={QUESTIONS} />
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------------- Final CTA */}
        <section className="gf-band gf-band-blue">
          <div className="gf-wrap grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_240px] lg:gap-16">
            <div>
              <h2 className="gf-display-xl">Start with a folder you already use.</h2>
              <p className="mt-8 max-w-[46ch] text-[17px] leading-relaxed text-[color-mix(in_srgb,var(--gf-black)_74%,transparent)]">
                Sign in by email, then follow the agent setup guide to connect a folder on your computer.
                Make your first Save and see its history here.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-5">
                <Link href="/dashboard" className="gf-button-primary gf-button-lg">
                  Get started <ArrowRightIcon />
                </Link>
                <Link href="/docs" className="underline underline-offset-4">Agent setup guide</Link>
              </div>
              <p className="mt-7 text-[13px] text-[color-mix(in_srgb,var(--gf-black)_64%,transparent)]">
                No password to remember. Your original files keep their names, formats, and location.
              </p>
            </div>
            <CtaScope>
              <span className="gf-cta-scope-window">
                <MascotPose pose="wave" className="gf-cta-mascot" />
              </span>
            </CtaScope>
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--gf-line)]">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
          "@context": "https://schema.org", "@type": "SoftwareApplication",
          name: "GoodFolder", url: SITE_URL, description: PRODUCT_DESCRIPTION,
          applicationCategory: "ProductivityApplication",
          license: "https://www.gnu.org/licenses/agpl-3.0.html",
        }).replace(/</g, "\\u003c") }} />
        <div className="gf-wrap flex flex-col items-start justify-between gap-5 py-10 sm:flex-row sm:items-center">
          <BrandLockup size={30} />
          <nav aria-label="Resources" className="flex flex-wrap gap-4 text-[13px]">
            <Link href="/docs" className="underline underline-offset-2">Agent setup</Link>
            <a href="/llms.txt" className="underline underline-offset-2">Agent index</a>
          </nav>
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
