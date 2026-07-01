import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Self-contained Node server output — small runtime image, no node_modules copy.
  output: 'standalone',
  // This app lives inside a larger repo; pin the tracing root to this folder so
  // `.next/standalone/server.js` lands at the root (not nested by the repo path).
  outputFileTracingRoot: __dirname,
  // The dashboard is a pure BFF client; it proxies API + realtime calls to the
  // backend origin configured via BACKEND_ORIGIN at build/runtime.
  async rewrites() {
    const backend = process.env.BACKEND_ORIGIN ?? 'http://localhost:3000';
    return [
      { source: '/api/dashboard/:path*', destination: `${backend}/api/dashboard/:path*` },
      { source: '/realtime/:path*', destination: `${backend}/realtime/:path*` },
    ];
  },
};

export default nextConfig;
