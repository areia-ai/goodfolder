import type { Metadata } from "next";
import { DocsShell, renderDoc } from "@/components/docs-shell";
import { listDocs } from "@/lib/docs";

export const metadata: Metadata = {
  title: "Documentation | GoodFolder",
  description: "Start with GoodFolder, the four words, agents, browser assistants, and running it yourself.",
  alternates: { canonical: "/docs", types: { "text/markdown": "/docs.md" } },
};

export default function DocsPage() {
  const docs = listDocs();
  const doc = docs[0]!;
  return <DocsShell docs={docs} doc={doc} rendered={renderDoc(doc)} />;
}
