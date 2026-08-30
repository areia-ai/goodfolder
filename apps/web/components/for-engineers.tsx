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
    term: "There is nothing to be locked into",
    body: "A protected folder is an ordinary Git repository sitting on your colleague's own machine. Any Git client opens it and reads the whole history. That stays true if they stop paying us, and if we stop existing.",
  },
  {
    Glyph: ShieldIcon,
    term: "You can read all of it",
    body: "Every part is open source under the AGPL: the code that touches the files, the dashboard, and the server behind them. Run the whole thing on your own infrastructure if that is the easier conversation internally.",
  },
  {
    Glyph: LockIcon,
    term: "The permission boundary is ours, not the engine's",
    body: "Every access check runs in GoodFolder's own code. The service that moves the bytes underneath is given no trust, publishes no ports, and never sees a credential belonging to one of your people.",
  },
  {
    Glyph: TerminalIcon,
    term: "And yes, it will hold code",
    body: "A folder with an app in it is still a folder. It saves, syncs and restores like any other, source files read in the browser, and an assistant can propose a change for a person to accept. Downloaded packages and build output stay out of a Save, and so does anything shaped like a credential, so nobody hands us their .env by accident.",
  },
];

export function ForEngineers({ sourceUrl }: { sourceUrl: string }) {
  return (
    <section id="engine" className="gf-band scroll-mt-16">
      <div className="gf-wrap">
        <div className="gf-head">
          <p className="gf-eyebrow">For the people who already know how this works</p>
          <h2 className="gf-h2 mt-4">Underneath, it is Git.</h2>
          <p className="gf-lead mt-5">
            GoodFolder did not invent a way to keep versions of a folder. It uses the one your engineers already
            trust, and keeps every word of that vocabulary away from the people who were never going to learn it.{" "}
            <a href={sourceUrl} className="gf-accent underline underline-offset-2">
              Read the code
            </a>{" "}
            before you believe any of this.
          </p>
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
            Your engineers have had a way back since 2005.
          </h3>
          <p className="gf-on-dark mt-4 max-w-3xl text-[14.5px] leading-relaxed">
            Everyone else in the company just got AI that edits their real files, with nothing underneath it. They
            are not going to learn a tool built for programmers to fix that, and asking them to is how this usually
            fails. GoodFolder gives them the same safety net with none of the words attached.
          </p>
          <ul className="mt-6 grid gap-2.5 sm:grid-cols-2">
            {[
              "No accounts to provision on a developer platform",
              "No new file format, and no move off the folders they use",
              "Set up per folder, by the person who owns it",
              "Self-host it, or let us run it",
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
