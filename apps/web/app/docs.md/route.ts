import { guideMarkdown } from "@/lib/discovery";
export const dynamic = "force-static";
export function GET() {
  return new Response(guideMarkdown(), { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
}
