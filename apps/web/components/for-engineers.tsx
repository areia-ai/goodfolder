import Image from "next/image";

import { CheckIcon, FolderIcon, LockIcon, ShieldIcon, TerminalIcon } from "@/components/icons";

/**
 * The one block on this site written for someone who already knows how this
 * works, and the only place the engine is named.
 *
 * It exists because the buyer and the user are often not the same person. The
 * rest of the page is for someone whose folder holds a report; this is for the
 * person they have to convince, who will ask what it actually is before anyone
 * in their company is allowed to point it at real work. To that reader "it is
 * the boring proven thing" is reassurance, not jargon, and refusing to say it
 * reads as evasion.
 *
 * `tools/vocabulary-gate.mjs` excuses exactly two words in exactly this file.
 * That narrowness is the point: hard rule 5 keeps engine vocabulary out of the
 * product, and this is not the product. A third word, or a second file, is a
 * positioning change and needs a decision rather than an edit.
 *
 * House style, checked at every rewrite of this page: no em dashes in rendered
 * copy, and no claim without something behind it.
 */

const FACTS = [
  {
    Glyph: FolderIcon,
    term: "Your folder stays portable",
    body: "A protected folder remains an ordinary Git repository on its owner's machine. Any Git client can open it and read the whole history, even if you stop paying us or we stop existing.",
  },
  {
    Glyph: ShieldIcon,
    term: "You can inspect every layer",
    body: "The file client, dashboard, and server are open source under the AGPL. Run the complete system on your own infrastructure when that is the right fit for your company.",
  },
  {
    Glyph: LockIcon,
    term: "Access is enforced before anything moves",
    body: "Every access check runs in GoodFolder's own code. The service that moves the bytes has no public ports, is given no trust, and never sees a credential belonging to one of your people.",
  },
  {
    Glyph: TerminalIcon,
    term: "Code stays an ordinary folder",
    body: "A folder with an app in it saves, syncs, and restores like any other. Source files stay available in the browser, while an assistant prepares a Change Proposal for a person to accept. Downloaded packages, build output, and credential-shaped files stay out of a Save.",
  },
];

export function ForEngineers({ sourceUrl }: { sourceUrl: string }) {
  return (
    <section id="engine" className="gf-band scroll-mt-16">
      <div className="gf-wrap">
        <div className="gf-head grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_240px] lg:gap-10">
          <div>
            <p className="gf-eyebrow">For the people who need to inspect the foundation</p>
            <h2 className="gf-h2 mt-4">Git underneath. A clear way back on top.</h2>
            <p className="gf-lead mt-5">
              GoodFolder puts Save, Sync, Timeline, and Restore around an ordinary folder. Underneath, its history
              stays in a standard Git repository your engineers can inspect, while everyone else gets a clear way to
              keep work safe. {" "}
              <a href={sourceUrl} className="gf-accent underline underline-offset-2">
                Read the code
              </a>{" "}
              before you believe any of this.
            </p>
          </div>
          <Image
            src="/brand/mascot/mascot-nerd-glasses-v2.png"
            alt="GoodFolder mark wearing thick glasses"
            width={1536}
            height={1024}
            className="mx-auto w-[200px] rounded-xl lg:w-full"
          />
        </div>

        <ul className="mt-9 grid gap-x-14 gap-y-7 sm:grid-cols-2">
          {FACTS.map(({ Glyph, term, body }) => (
            <li key={term} className="border-t border-[var(--gf-line-strong)] pt-4">
              {/* The shared Icon has no intrinsic size: every other use sizes
                  it from CSS (.gf-verb-name svg, .gf-kind svg). Without that
                  it stretches to fill its flex line, which is what happened
                  here the first time. */}
              <b className="gf-h3 flex items-center gap-2.5">
                <Glyph className="h-[18px] w-[18px] shrink-0 text-[var(--gf-blue-ink)]" />
                {term}
              </b>
              <span className="gf-body mt-1.5 block text-[14.5px]">{body}</span>
            </li>
          ))}
        </ul>

        <div className="gf-panel-dark mt-10 p-7">
          <h3 className="text-[18px] font-bold tracking-[-.02em]">
            The safety net is real, even when the product gets out of the way.
          </h3>
          <p className="gf-on-dark mt-4 max-w-3xl text-[14.5px] leading-relaxed">
            People working in recordings, budgets, and code should not need to learn the machinery underneath their
            folders. GoodFolder makes that protection legible to them, while giving your technical team a foundation
            they can audit, run themselves, and leave without losing the history.
          </p>
          <ul className="mt-6 grid gap-2.5 sm:grid-cols-2">
            {[
              "The folder stays where its owner already works",
              "No new file format or developer platform",
              "Access checks stay in GoodFolder, not the transport",
              "Run it yourself or use the hosted service",
            ].map((line) => (
              <li key={line} className="flex gap-2.5">
                <CheckIcon className="gf-check" />
                <span className="gf-on-dark text-[14.5px] leading-relaxed">{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
