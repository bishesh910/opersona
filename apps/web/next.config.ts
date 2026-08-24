import type { NextConfig } from 'next';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The monorepo keeps one `.env` at the repo root (shared with the engine).
 * Next only auto-loads `.env` from the app directory, so load the root one here.
 * Values already present in the environment win.
 */
function loadRootEnv() {
  const file = path.resolve(__dirname, '../../.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    const q = val[0];
    if ((q === '"' || q === "'") && val.endsWith(q)) val = val.slice(1, -1);
    else val = val.replace(/\s+#.*$/, '').trim();
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadRootEnv();

const nextConfig: NextConfig = {
  devIndicators: false,
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ] }];
  },
  async rewrites() {
    return [
      { source: '/me', destination: '/clones/me/thinking' },
      { source: '/me/docs', destination: '/clones/me/documents' },
      { source: '/me/:path*', destination: '/clones/me/:path*' },
    ];
  },
  // NEXT_DIST_DIR lets a one-off `next build` run while `next dev` owns `.next` (e.g. `NEXT_DIST_DIR=.next-build pnpm build`).
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  transpilePackages: ['@opersona/db', '@opersona/shared', '@opersona/pixel-avatar'],
  serverExternalPackages: ['pg'],
  webpack(config, { isServer, webpack }) {
    // Workspace packages use NodeNext-style `./x.js` specifiers for `.ts` sources.
    config.resolve.extensionAlias = { ...config.resolve.extensionAlias, '.js': ['.ts', '.tsx', '.js'] };
    if (!isServer) {
      // @opersona/shared and @opersona/pixel-avatar re-export Node-only helpers (crypto, pngjs) that the
      // browser never calls. Strip the `node:` scheme so the fallback applies, then stub them out.
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (res: { request: string }) => {
          res.request = res.request.replace(/^node:/, '');
        }),
      );
      config.resolve.fallback = { ...config.resolve.fallback, crypto: false, zlib: false, stream: false, buffer: false, util: false, assert: false, fs: false, path: false };
      config.resolve.alias = { ...config.resolve.alias, pngjs: false };
    }
    return config;
  },
};

export default nextConfig;
