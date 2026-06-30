/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The dashboard is a pure BFF client; it proxies API calls to the backend
  // origin configured via NEXT_PUBLIC_BACKEND_URL at build/runtime.
  async rewrites() {
    const backend = process.env.BACKEND_ORIGIN ?? 'http://localhost:3000';
    return [
      { source: '/api/dashboard/:path*', destination: `${backend}/api/dashboard/:path*` },
    ];
  },
};

export default nextConfig;
