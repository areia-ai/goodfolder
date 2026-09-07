import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/discovery";
export const dynamic = "force-static";
export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/docs"].map(path => ({ url: `${SITE_URL}${path}` }));
}
