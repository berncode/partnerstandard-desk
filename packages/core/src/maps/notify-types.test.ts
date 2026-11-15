import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, notifySettingsSchema } from './notify-types';

describe('notification settings', () => {
  it('defaults to the spec’s values', () => {
    expect(DEFAULT_SETTINGS).toEqual({ dueSoonDays: 3, partnerDigest: false, partnerAlerts: 'instant' });
  });

  it('accepts only the offered choices, and nothing extra', () => {
    expect(notifySettingsSchema.safeParse({ dueSoonDays: 7, partnerDigest: true, partnerAlerts: 'daily' }).success).toBe(true);
    for (const bad of [
      { dueSoonDays: 2, partnerDigest: false, partnerAlerts: 'instant' },
      { dueSoonDays: '3', partnerDigest: false, partnerAlerts: 'instant' },
      { dueSoonDays: 3, partnerDigest: 'yes', partnerAlerts: 'instant' },
      { dueSoonDays: 3, partnerDigest: false, partnerAlerts: 'hourly' },
      { dueSoonDays: 3, partnerDigest: false, partnerAlerts: 'off', ownerId: 'u_2' },
      null, 'off',
    ]) expect(notifySettingsSchema.safeParse(bad).success).toBe(false);
  });
});
