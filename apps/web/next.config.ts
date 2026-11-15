import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // Trace from the monorepo root so the workspace packages land in the standalone build.
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  // A company server runs its migrations when it starts (plan 17, src/instrumentation.ts): they travel with the
  // standalone output, at packages/platform/drizzle beside apps/web. Hosted never reads them.
  outputFileTracingIncludes: { '/api/health': ['../../packages/platform/drizzle/**/*'] },
  transpilePackages: [
    '@partner-desk/core',
    '@partner-desk/method',
    '@partner-desk/copy',
    '@partner-desk/storage',
    '@partner-desk/commands',
    '@partner-desk/platform',
  ],
  cacheComponents: true,
  // The brand (src/ui/brand.ts) is fixed in every build, also when it isn't set: unset, Next.js would leave the setting
  // to the server's start, and a copy started with it would show PartnerStandard's look on some pages and not others.
  env: { NEXT_PUBLIC_PD_BRAND: process.env.NEXT_PUBLIC_PD_BRAND ?? '' },
  // A share link's page (src/app/s/[token]): its address holds the secret, so it is never sent on as a referrer, and the
  // page is kept out of search engines even where the robots meta tag isn't read.
  // The same for a review's summary link (src/app/r/[token], reviews spec 5.6), a MAP link (src/app/c/[token]), the pages a link holder sees (src/app/c/*, src/app/m/*) and an email's
  // button and unsubscribe pages (src/app/n/*), whose address holds a signed token, and the agents' allow page
  // (src/app/oauth/allow), whose address holds a signed request. The allow page also never shows inside another
  // site's frame, where a hidden page could trick a click on Allow.
  async headers() {
    const linkHeaders = [
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
    ];
    return [
      // No page of the app shows inside another site's frame, and no file is guessed to be a script.
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
      { source: '/s/:token', headers: linkHeaders },
      { source: '/r/:token', headers: linkHeaders },
      { source: '/c/:path*', headers: linkHeaders },
      { source: '/m/:path*', headers: linkHeaders },
      { source: '/n/:path*', headers: linkHeaders },
      {
        source: '/oauth/:path*',
        headers: [...linkHeaders, { key: 'X-Frame-Options', value: 'DENY' }, { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" }],
      },
    ];
  },
  // The API's error answers name https://desk.partnerstandard.com/problems/<code> (src/agents/rest.ts): each of those
  // addresses shows the one page that lists every code.
  async rewrites() {
    return [{ source: '/problems/:code', destination: '/problems' }];
  },
  partialPrefetching: true,
  // Tailwind 4 through its Turbopack loader, as in the Recruitment app.
  turbopack: {
    rules: {
      '*.css': { loaders: ['@tailwindcss/turbopack'], as: '*.css' },
    },
  },
};

export default nextConfig;
