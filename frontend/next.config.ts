import type { NextConfig } from 'next';

const backendOrigin = (process.env.BACKEND_ORIGIN || 'http://localhost:3001').replace(/\/+$/, '');

const nextConfig: NextConfig = {
  // Disable gzip compression to ensure SSE streams flush properly
  compress: false,
  output: 'export',
  outputFileTracingRoot: __dirname,
  async rewrites() {
    return [
      {
        source: '/api',
        destination: `${backendOrigin}/`,
      },
      {
        source: '/api/:path*',
        destination: `${backendOrigin}/:path*`,
      },
    ];
  },
};

export default nextConfig;
