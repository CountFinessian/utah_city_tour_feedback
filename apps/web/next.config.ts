import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  poweredByHeader: false,
  compress: true,
  // The setup guide is read from disk at request time (fs.readFile), so the file must be traced into the route's bundle.
  outputFileTracingIncludes: {
    "/social-accounts": ["./src/content/social-accounts-guide.md"],
  },
};

export default nextConfig;
