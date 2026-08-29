import type { NextConfig } from "next";

// Static export: the whole site builds to out/ and deploys to Cloudflare
// Pages as plain files. No server runtime — the frontend is 100% client-side.
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
