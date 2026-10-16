import path from 'node:path'
import type { NextConfig } from 'next'
import { loadEnvConfig } from '@next/env'

loadEnvConfig(path.resolve(process.cwd(), '../..'))

const nextConfig: NextConfig = {
  transpilePackages: ['@jio/db', '@jio/core'],
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  eslint: { ignoreDuringBuilds: true },
}

export default nextConfig
