import { COPY } from '@partner-desk/copy';

/**
 * Whose look this build shows. Only PartnerStandard's own hosted service is built with
 * NEXT_PUBLIC_PD_BRAND=partnerstandard: it shows the PartnerStandard logo. Every other build (a company server, a fork, a
 * copy deployed and forgotten) is the Community Edition, with a plain mark and a footer that says PartnerStandard doesn't
 * run it (owner, 2026-11-15; README, "The PartnerStandard name and logo"). Next.js writes the value into the code when
 * it builds, so server and browser agree and static pages hold it.
 */
export type Brand = 'partnerstandard' | 'community';

export const shownBrand = (): Brand => (process.env.NEXT_PUBLIC_PD_BRAND === 'partnerstandard' ? 'partnerstandard' : 'community');

/** The app's name as this build shows it, above a page's title. */
export const shownName = (): string => (shownBrand() === 'partnerstandard' ? COPY.APP_NAME : COPY.COMMUNITY_APP_NAME);

/** The browser tab's icon. */
export const shownIcon = (): string => (shownBrand() === 'partnerstandard' ? '/brand/icon.png' : '/community/icon.png');
