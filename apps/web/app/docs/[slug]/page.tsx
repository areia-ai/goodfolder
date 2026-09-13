import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocsShell, renderDoc } from "@/components/docs-shell";
import { getDoc, listDocs } from "@/lib/docs";

export function generateStaticParams() {
  return listDocs().map((doc) => ({ slug: doc.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const doc = getDoc(slug);
  if (!doc) return {};
  return {
    title: `${doc.title} | GoodFolder`,
    description: doc.description,
    alternates: { canonical: `/docs/${doc.slug}`, types: { "text/markdown": `/docs/${doc.slug}.md` } },
  };
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = getDoc(slug);
  if (!doc) notFound();
  return <DocsShell docs={listDocs()} doc={doc} rendered={renderDoc(doc)} />;
}
