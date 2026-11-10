import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The demo agent's curated knowledge is read from disk when its crawl starts.
  outputFileTracingIncludes: {
    '/api/demo-config': ['./content/sharkbyte-knowledge.md'],
  },
};

export default nextConfig;
