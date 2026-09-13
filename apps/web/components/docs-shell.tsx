import Link from "next/link";
import { BrandLockup } from "@/components/brand";
import type { DocPage } from "@/lib/docs";
import { renderMarkdown, type RenderedDoc } from "@/lib/docs-markdown";

/** The document's own top heading duplicates the page title the shell already
 *  shows, so it is dropped before rendering. */
export function renderDoc(doc: DocPage): RenderedDoc {
  return renderMarkdown(doc.markdown.replace(/^#\s+.+\n+/, ""));
}

/** Shared chrome for every /docs page: sidebar on the left, the document in
 *  the middle, an on-page outline on wide screens. */
export function DocsShell({ docs, doc, rendered }: { docs: DocPage[]; doc: DocPage; rendered: RenderedDoc }) {
  const outline = rendered.headings.filter((h) => h.depth === 2);
  return (
    <div className="gf-wrap py-10">
      <header className="flex flex-wrap items-center justify-between gap-5">
        <Link href="/" aria-label="GoodFolder home"><BrandLockup size={30} /></Link>
        <a href={`/docs/${doc.slug}.md`} className="underline underline-offset-4">Read as Markdown</a>
      </header>
      <div className="mt-10 grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Documentation" className="lg:sticky lg:top-10 lg:self-start">
          <p className="gf-eyebrow">Documentation</p>
          <ul className="mt-4 space-y-2 text-[15px]">
            {docs.map((page) => (
              <li key={page.slug}>
                <Link
                  href={`/docs/${page.slug}`}
                  aria-current={page.slug === doc.slug ? "page" : undefined}
                  className={page.slug === doc.slug
                    ? "font-semibold text-[var(--gf-ink)]"
                    : "text-[var(--gf-ink-soft)] underline-offset-4 hover:underline"}
                >
                  {page.title}
                </Link>
              </li>
            ))}
            <li className="pt-3">
              <a
                href="https://github.com/areia-ai/goodfolder/blob/main/docs/development.md"
                className="text-[var(--gf-ink-soft)] underline-offset-4 hover:underline"
              >
                Working on the code →
              </a>
            </li>
          </ul>
        </nav>
        <main className="min-w-0">
          <h1 className="gf-h2">{doc.title}</h1>
          <p className="gf-lead mt-4">{doc.description}</p>
          <div className="mt-10 grid grid-cols-[minmax(0,1fr)] gap-10 xl:grid-cols-[minmax(0,1fr)_200px]">
            <article
              className="gf-doc"
              dangerouslySetInnerHTML={{ __html: rendered.html }}
            />
            {outline.length > 1 && (
              <nav aria-label="On this page" className="hidden self-start xl:sticky xl:top-10 xl:block">
                <p className="gf-eyebrow">On this page</p>
                <ul className="mt-4 space-y-2 text-[13px]">
                  {outline.map((h) => (
                    <li key={h.id}>
                      <a href={`#${h.id}`} className="text-[var(--gf-ink-soft)] underline-offset-4 hover:underline">{h.text}</a>
                    </li>
                  ))}
                </ul>
              </nav>
            )}
          </div>
        </main>
      </div>
      <footer className="mt-16 border-t border-[var(--gf-line)] py-8 text-[13px]">
        <Link href="/" className="underline underline-offset-4">Back to GoodFolder</Link>
      </footer>
    </div>
  );
}
