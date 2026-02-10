import type { NextConfig } from "next";
import { fileURLToPath } from "url";
import path from "path";

const __projectDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: __projectDir,
  },
  async redirects() {
    return [
      {
        source: "/protein",
        destination: "/snacks",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
