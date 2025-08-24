import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disable gzip compression to ensure SSE streams flush properly
  compress: false,
};

export default nextConfig;
