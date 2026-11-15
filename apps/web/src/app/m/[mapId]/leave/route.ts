import { resolveMapSession } from '@partner-desk/commands';
import { connection, NextResponse, type NextRequest } from 'next/server';
import { isMapId, linkMapPath, mapCookieName, mapCookieOptions } from '@/server/map-session';
import { appUrl, mapAccessDeps } from '@/server/runtime';

/** Where a link holder's dead end goes. */
const PLACES = { invalid: '/c/invalid', removed: '/c/removed', renew: '/c/renew' } as const;

/**
 * A link holder's MAP page found their session over (revoked, expired, or the MAP gone for them, which ended it): a
 * page can't clear a cookie, so it comes here, which does, and goes on to say why. A session still working is left
 * alone and sent back to the MAP, so a link from elsewhere can't sign anyone out.
 */
export async function GET(request: NextRequest, ctx: RouteContext<'/m/[mapId]/leave'>) {
  await connection();
  const { mapId } = await ctx.params;
  const base = appUrl();
  if (!isMapId(mapId)) return NextResponse.redirect(new URL(PLACES.invalid, base), 303);
  const name = mapCookieName(mapId);
  const token = request.cookies.get(name)?.value;
  if (token && (await resolveMapSession(mapAccessDeps(), token, mapId)).kind === 'active') {
    return NextResponse.redirect(new URL(linkMapPath(mapId), base), 303);
  }
  const to = request.nextUrl.searchParams.get('to');
  const place = to === 'removed' || to === 'renew' ? PLACES[to] : PLACES.invalid;
  const target = new URL(place, base);
  if (place === PLACES.renew) target.searchParams.set('map', mapId);
  const response = NextResponse.redirect(target, 303);
  response.headers.set('Cache-Control', 'no-store');
  if (token !== undefined) response.cookies.set(name, '', { ...mapCookieOptions(base), maxAge: 0 });
  return response;
}
