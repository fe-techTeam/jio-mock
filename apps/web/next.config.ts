import path from 'node:path'
import type { NextConfig } from 'next'
import { loadEnvConfig } from '@next/env'

// forceReload: Next has already loaded apps/web env, which makes a plain call a no-op.
loadEnvConfig(
  path.resolve(process.cwd(), '../..'),
  process.env.NODE_ENV !== 'production',
  console,
  true,
)

const nextConfig: NextConfig = {
  transpilePackages: ['@jio/db', '@jio/core'],
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  eslint: { ignoreDuringBuilds: true },
}

export default nextConfig
