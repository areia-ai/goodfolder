import { listDocs } from "@/lib/docs";
import { PRODUCT_DESCRIPTION, SITE_URL } from "@/lib/discovery";

export const dynamic = "force-static";

export function GET() {
  const docs = listDocs();
  const lines = [
    "# GoodFolder",
    "",
    `> ${PRODUCT_DESCRIPTION}`,
    "",
    "## Documentation",
    "",
    `- [Product overview](${SITE_URL}/): files, Save, Sync, Timeline, Restore, and common questions.`,
    ...docs.map(
      (doc) => `- [${doc.title}](${SITE_URL}/docs/${doc.slug}.md): ${doc.description}`,
    ),
    `- [Hosted pricing](${SITE_URL}/#pricing): current plans and protected-data capacity.`,
    "",
    "## Access",
    "",
    "Local MCP runs on the computer holding the folder; there is no public HTTP MCP endpoint. Browser WebMCP offers inspection, comments, and proposals requiring human review. Dashboard tools cannot Save or accept work. Account and folder content require authentication.",
    "",
  ];
  return new Response(lines.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
