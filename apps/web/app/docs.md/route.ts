import { docMarkdownForWeb, listDocs } from "@/lib/docs";

export const dynamic = "force-static";

export function GET() {
  // The index renders the first page (Start); this is its Markdown alternate.
  const doc = listDocs()[0]!;
  return new Response(`# ${doc.title}\n\n${docMarkdownForWeb(doc)}\n`, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
