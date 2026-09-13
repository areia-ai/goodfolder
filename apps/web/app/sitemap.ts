import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/discovery";
import { listDocs } from "@/lib/docs";
export const dynamic = "force-static";
export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/docs", ...listDocs().map((doc) => `/docs/${doc.slug}`)].map((path) => ({ url: `${SITE_URL}${path}` }));
}
