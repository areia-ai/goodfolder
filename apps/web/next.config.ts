import type { NextConfig } from "next";

// Static export: the whole site builds to out/ and deploys to Cloudflare
// Pages as plain files. Public content is prerendered HTML; dashboard
// interactions run client-side. There is no production Next.js server runtime.
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
