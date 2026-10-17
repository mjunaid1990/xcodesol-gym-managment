import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // PGlite ships WASM + native bindings; keep it out of the server bundle. It is only
  // used for local development, never on Vercel.
  serverExternalPackages: ['@electric-sql/pglite', 'postgres'],
  experimental: {
    serverActions: { bodySizeLimit: '4mb' },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(), microphone=()' },
        ],
      },
    ]
  },
}

export default nextConfig
