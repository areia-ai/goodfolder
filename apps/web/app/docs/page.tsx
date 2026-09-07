import type { Metadata } from "next";
import Link from "next/link";
import { BrandLockup } from "@/components/brand";
import { DOCS_TITLE, guideSections, resourceLinks } from "@/lib/discovery";

export const metadata: Metadata = {
  title: `${DOCS_TITLE} | GoodFolder`,
  description: "Set up GoodFolder's local MCP server, approve access, connect your first folder, and understand browser assistant permissions.",
  alternates: { canonical: "/docs", types: { "text/markdown": "/docs.md" } },
};

export default function DocsPage() {
  return <div className="gf-wrap py-10">
    <header className="flex flex-wrap items-center justify-between gap-5">
      <Link href="/" aria-label="GoodFolder home"><BrandLockup size={30} /></Link>
      <a href="/docs.md" className="underline underline-offset-4">Read as Markdown</a>
    </header>
    <main className="mx-auto max-w-3xl py-16">
      <p className="gf-eyebrow">Documentation</p>
      <h1 className="gf-h2 mt-4">{DOCS_TITLE}</h1>
      <nav aria-label="Guide sections" className="mt-8 flex flex-wrap gap-x-6 gap-y-3">
        {guideSections.map(section => <a key={section.id} href={`#${section.id}`} className="underline underline-offset-4">{section.title}</a>)}
      </nav>
      {guideSections.map(section => <section key={section.id} id={section.id} className="mt-12 scroll-mt-8">
        <h2 className="text-2xl font-semibold">{section.title}</h2>
        {section.paragraphs.map(paragraph => <p key={paragraph} className="mt-4 leading-relaxed">{paragraph}</p>)}
        {section.code && <pre className="mt-5 overflow-x-auto rounded-lg bg-neutral-100 p-5 text-sm"><code className={`language-${section.language}`}>{section.code}</code></pre>}
      </section>)}
      <section className="mt-12"><h2 className="text-2xl font-semibold">Resources</h2>
        <ul className="mt-4 space-y-3">{resourceLinks.map(link => <li key={link.url}><a href={link.url} className="underline underline-offset-4">{link.label}</a></li>)}</ul>
      </section>
    </main>
  </div>;
}
