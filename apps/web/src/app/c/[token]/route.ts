import { openMapLink } from '@partner-desk/commands';
import { connection, NextResponse } from 'next/server';
import { linkMapPath, mapCookieName, mapCookieOptions } from '@/server/map-session';
import { appUrl, mapAccessDeps } from '@/server/runtime';

/**
 * A MAP link (spec 4): swaps the token for a session cookie and redirects, so the token leaves the address bar. Safe
 * for link scanners: opening a link only starts a session, it never changes a plan, and the link stays usable until it
 * is revoked or idle for 90 days (Review Focus 2).
 */
export async function GET(_request: Request, ctx: RouteContext<'/c/[token]'>) {
  await connection();
  const { token } = await ctx.params;
  const opened = await openMapLink(mapAccessDeps(), token);
  const base = appUrl();
  const to = (path: string) => {
    const response = NextResponse.redirect(new URL(path, base), 303);
    response.headers.set('Referrer-Policy', 'no-referrer');
    response.headers.set('Cache-Control', 'no-store');
    return response;
  };
  if (opened.kind === 'invalid') return to('/c/invalid');
  if (opened.kind === 'expired') return to(`/c/renew?map=${encodeURIComponent(opened.mapId)}`);
  const response = to(linkMapPath(opened.mapId));
  response.cookies.set(mapCookieName(opened.mapId), opened.sessionToken, mapCookieOptions(base));
  return response;
}
