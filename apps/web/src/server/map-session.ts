// The link holder's session cookie; the link holder is found through the commands (`resolveMapSession`).

/** Every link holder's session cookie starts with this; one cookie per MAP. */
export const MAP_COOKIE_PREFIX = 'pd_m_';

export const mapCookieName = (mapId: string): string => `${MAP_COOKIE_PREFIX}${mapId}`;

/** A MAP id as the commands make them (`newMapId`): only such an id names a cookie. */
export const isMapId = (value: unknown): value is string => typeof value === 'string' && /^map_[0-9a-z]{10}$/.test(value);

/** Browsers cap cookie lifetimes at 400 days. */
const COOKIE_MAX_AGE_SECONDS = 400 * 86_400;

/**
 * httpOnly and SameSite=Lax, Secure whenever the app is served over https (every hosted address; plain http only on a
 * local test server), on every path, as the MAP app's. The cookie outlives the server session on purpose: a page can't
 * refresh a cookie, so the server decides expiry (to /c/renew), and a person who keeps using the MAP is never dropped.
 */
export function mapCookieOptions(appUrl: string) {
  return { httpOnly: true, sameSite: 'lax' as const, secure: appUrl.startsWith('https://'), path: '/' as const, maxAge: COOKIE_MAX_AGE_SECONDS };
}

/** A MAP link: always on the app's own address (APP_URL), never on the host a request came in on. */
export const mapLinkUrl = (appUrl: string, token: string): string => `${appUrl.replace(/\/+$/, '')}/c/${token}`;

/** The link holder's MAP page, outside the app frame. */
export const linkMapPath = (mapId: string): string => `/m/${mapId}`;
