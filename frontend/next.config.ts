import type { NextConfig } from "next";

// Backend origin used for proxying API requests from the frontend server.
// Prefer BACKEND_ORIGIN. If absent, and NEXT_PUBLIC_API_BASE is an absolute http(s) URL, use that; otherwise default to localhost.
const fromEnv = process.env.BACKEND_ORIGIN || process.env.NEXT_PUBLIC_API_BASE;
const BACKEND_ORIGIN = fromEnv && /^https?:\/\//.test(fromEnv)
  ? fromEnv
  : 'http://localhost:3001';

const nextConfig: NextConfig = {
  // Important for SSE passthrough via rewrites: gzip compression can buffer streams.
  // Disabling ensures chunks flush to the browser as they arrive.
  compress: false,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_ORIGIN}/:path*`,
      },
    ];
  },
};

export default nextConfig;
