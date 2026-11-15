import { describe, expect, it } from 'vitest';
import { isMapId, linkMapPath, MAP_COOKIE_PREFIX, mapCookieName, mapCookieOptions, mapLinkUrl } from './map-session';

describe('the link holder’s cookie', () => {
  it('is one cookie per MAP, named by a MAP id only', () => {
    expect(mapCookieName('map_0123456789')).toBe('pd_m_map_0123456789');
    expect(isMapId('map_0123456789')).toBe(true);
    for (const bad of ['map_012345678', 'map_01234567890', 'map_ABCDEFGHIJ', 'x;y=z', 42]) expect(isMapId(bad)).toBe(false);
    expect(mapCookieName('map_0123456789').startsWith(MAP_COOKIE_PREFIX)).toBe(true);
  });

  it('is httpOnly and SameSite=Lax, and Secure on https', () => {
    expect(mapCookieOptions('https://desk.partnerstandard.com')).toEqual({
      httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 400 * 86_400,
    });
    expect(mapCookieOptions('http://localhost:3000').secure).toBe(false);
  });

  it('makes links on the app’s own address', () => {
    expect(mapLinkUrl('https://desk.partnerstandard.com/', 'TOKEN')).toBe('https://desk.partnerstandard.com/c/TOKEN');
    expect(linkMapPath('map_0123456789')).toBe('/m/map_0123456789');
  });
});
