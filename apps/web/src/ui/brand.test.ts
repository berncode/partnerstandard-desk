import { afterEach, describe, expect, it, vi } from 'vitest';
import { shownBrand, shownIcon, shownName } from './brand';

afterEach(() => { vi.unstubAllEnvs(); });

describe('the brand a build shows (owner, 2026-11-15)', () => {
  it('is PartnerStandard’s only when the build says so: its name and icon', () => {
    vi.stubEnv('NEXT_PUBLIC_PD_BRAND', 'partnerstandard');
    expect([shownBrand(), shownName(), shownIcon()]).toEqual(['partnerstandard', 'PartnerStandard Desk', '/brand/icon.png']);
  });

  it.each([[undefined], [''], ['PartnerStandard'], ['yes']])('is the Community Edition for any other value (%s): a copy deployed and forgotten', (value) => {
    vi.stubEnv('NEXT_PUBLIC_PD_BRAND', value);
    expect([shownBrand(), shownName(), shownIcon()]).toEqual(['community', 'PartnerStandard Desk Community Edition', '/community/icon.png']);
  });
});
