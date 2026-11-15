import { afterEach, describe, expect, it, vi } from 'vitest';
import { editionFlags, parseEnv } from './env';

const base = {
  DATABASE_URL: 'file:.data/test.db',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'secret',
};

describe('parseEnv', () => {
  it('parses a production-shaped environment', () => {
    const env = parseEnv({ ...base, APP_URL: 'https://desk.partnerstandard.com', VERCEL_ENV: 'production' });
    expect(env).toMatchObject({ APP_URL: 'https://desk.partnerstandard.com', PD_TEST_AUTH: false, VERCEL_ENV: 'production' });
  });

  it('refuses a plain-http APP_URL on Vercel: the MAP link cookie’s Secure flag follows it', () => {
    expect(() => parseEnv({ ...base, APP_URL: 'http://desk.example.com', VERCEL_ENV: 'preview' })).toThrow(/APP_URL must start with https:\/\/ on Vercel/);
    expect(parseEnv({ ...base, APP_URL: 'http://localhost:3000' }).APP_URL).toBe('http://localhost:3000');
  });

  it('reads the email settings: Resend’s key and sender go together, the job’s secret is long, the allowlist is a list', () => {
    const env = parseEnv({
      ...base, RESEND_API_KEY: 're_123', EMAIL_FROM: 'PartnerStandard Desk <desk@example.com>', CRON_SECRET: 'c'.repeat(32),
      EMAIL_ALLOWLIST: ' Ruth@Example.com, ,test@example.com ',
    });
    expect(env).toMatchObject({
      RESEND_API_KEY: 're_123', EMAIL_FROM: 'PartnerStandard Desk <desk@example.com>', CRON_SECRET: 'c'.repeat(32),
      EMAIL_ALLOWLIST: ['ruth@example.com', 'test@example.com'],
    });
    const none = parseEnv(base);
    expect([none.RESEND_API_KEY, none.EMAIL_FROM, none.CRON_SECRET, none.EMAIL_ALLOWLIST]).toEqual([undefined, undefined, undefined, null]);
    expect(() => parseEnv({ ...base, RESEND_API_KEY: 're_123' })).toThrow(/RESEND_API_KEY and EMAIL_FROM go together/);
    expect(() => parseEnv({ ...base, EMAIL_FROM: 'x@example.com' })).toThrow(/RESEND_API_KEY and EMAIL_FROM go together/);
    expect(() => parseEnv({ ...base, CRON_SECRET: 'short' })).toThrow(/CRON_SECRET must be at least 16 characters/);
  });

  it('defaults APP_URL for local development', () => {
    expect(parseEnv(base).APP_URL).toBe('http://localhost:3000');
  });

  it('refuses a short secret', () => {
    expect(() => parseEnv({ ...base, BETTER_AUTH_SECRET: 'short' })).toThrow(/BETTER_AUTH_SECRET/);
  });

  it('requires Google sign-in unless test sign-in is on', () => {
    const none = { ...base, GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined };
    expect(() => parseEnv(none)).toThrow(/Set up Google sign-in: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET \(or PD_TEST_AUTH=1\)/);
    expect(parseEnv({ ...none, PD_TEST_AUTH: '1' }).PD_TEST_AUTH).toBe(true);
  });

  it('refuses PD_TEST_AUTH on a Vercel preview', () => {
    expect(() => parseEnv({ ...base, PD_TEST_AUTH: '1', VERCEL_ENV: 'preview', APP_URL: 'https://x.example.com' })).toThrow(/PD_TEST_AUTH must never be on/);
  });

  it('refuses a Google client id without its secret, and the other way round', () => {
    expect(() => parseEnv({ ...base, GOOGLE_CLIENT_SECRET: undefined })).toThrow(/GOOGLE_CLIENT_SECRET/);
    expect(() => parseEnv({ ...base, GOOGLE_CLIENT_SECRET: undefined, PD_TEST_AUTH: '1' })).toThrow(/GOOGLE_CLIENT_SECRET/);
    expect(() => parseEnv({ ...base, GOOGLE_CLIENT_ID: '', PD_TEST_AUTH: '1' })).toThrow(/GOOGLE_CLIENT_ID/);
  });

  it('reads the Turso integration’s TURSO_* names, with DATABASE_* taking precedence', () => {
    const turso = { ...base, DATABASE_URL: undefined, TURSO_DATABASE_URL: 'libsql://pd-prod.turso.io', TURSO_AUTH_TOKEN: 'tok' };
    expect(parseEnv(turso)).toMatchObject({ DATABASE_URL: 'libsql://pd-prod.turso.io', DATABASE_AUTH_TOKEN: 'tok' });
    expect(parseEnv({ ...turso, DATABASE_URL: 'libsql://other.turso.io', DATABASE_AUTH_TOKEN: 'mine' }))
      .toMatchObject({ DATABASE_URL: 'libsql://other.turso.io', DATABASE_AUTH_TOKEN: 'mine' });
    expect(() => parseEnv({ ...base, DATABASE_URL: undefined })).toThrow(/DATABASE_URL \(or TURSO_DATABASE_URL\) is required/);
  });

  it('reads the integration’s names when it was given the DATABASE prefix', () => {
    const prefixed = {
      ...base, DATABASE_URL: undefined,
      DATABASE_TURSO_DATABASE_URL: 'libsql://pd-staging.turso.io', DATABASE_TURSO_AUTH_TOKEN: 'tok',
    };
    expect(parseEnv(prefixed)).toMatchObject({ DATABASE_URL: 'libsql://pd-staging.turso.io', DATABASE_AUTH_TOKEN: 'tok' });
  });

  it('never allows test sign-in in production', () => {
    expect(() => parseEnv({ ...base, PD_TEST_AUTH: '1', VERCEL_ENV: 'production' })).toThrow(/PD_TEST_AUTH must never be on on Vercel/);
    expect(() => parseEnv({ ...base, PD_TEST_AUTH: '1', VERCEL_ENV: 'preview', APP_URL: 'https://x.example.com' })).toThrow(/PD_TEST_AUTH must never be on on Vercel/);
    expect(parseEnv({ ...base, PD_TEST_AUTH: '1', VERCEL_ENV: 'development', APP_URL: 'https://x.example.com' }).PD_TEST_AUTH).toBe(true);
  });

  it('WEBHOOKS_ALLOW_PRIVATE is off unless set to 1, and never allowed on Vercel', () => {
    expect(parseEnv(base).WEBHOOKS_ALLOW_PRIVATE).toBe(false);
    expect(parseEnv({ ...base, WEBHOOKS_ALLOW_PRIVATE: '' }).WEBHOOKS_ALLOW_PRIVATE).toBe(false);
    expect(parseEnv({ ...base, WEBHOOKS_ALLOW_PRIVATE: '1' }).WEBHOOKS_ALLOW_PRIVATE).toBe(true);
    expect(() => parseEnv({ ...base, WEBHOOKS_ALLOW_PRIVATE: 'yes' })).toThrow(/WEBHOOKS_ALLOW_PRIVATE/);
    for (const VERCEL_ENV of ['production', 'preview', 'development']) {
      expect(() => parseEnv({ ...base, VERCEL_ENV, APP_URL: 'https://x.example.com', WEBHOOKS_ALLOW_PRIVATE: '1' }))
        .toThrow(/WEBHOOKS_ALLOW_PRIVATE is for self-hosting only/);
    }
  });

  it('requires APP_URL on Vercel, with no localhost default', () => {
    for (const VERCEL_ENV of ['production', 'preview']) {
      expect(() => parseEnv({ ...base, VERCEL_ENV })).toThrow(/APP_URL is required on Vercel/);
      expect(() => parseEnv({ ...base, VERCEL_ENV, APP_URL: '' })).toThrow(/APP_URL is required on Vercel/);
      expect(parseEnv({ ...base, VERCEL_ENV, APP_URL: 'https://x.example.com' }).APP_URL).toBe('https://x.example.com');
    }
  });

  it('treats empty strings as unset', () => {
    expect(parseEnv({ ...base, DATABASE_AUTH_TOKEN: '' }).DATABASE_AUTH_TOKEN).toBeUndefined();
  });

  it('lists every problem at once', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL[\s\S]*BETTER_AUTH_SECRET/);
  });
});

describe('testSignInEnabled', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is false by default', () => {
    expect(parseEnv({ ...base }).PD_TEST_AUTH).toBe(false);
  });

  it('reads the flag from process.env', async () => {
    vi.resetModules();
    vi.stubEnv('DATABASE_URL', base.DATABASE_URL);
    vi.stubEnv('BETTER_AUTH_SECRET', base.BETTER_AUTH_SECRET);
    vi.stubEnv('PD_TEST_AUTH', '1');
    vi.stubEnv('VERCEL_ENV', 'development');
    vi.stubEnv('GOOGLE_CLIENT_ID', '');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '');
    const fresh = await import('./env');
    expect(fresh.testSignInEnabled()).toBe(true);
    expect(fresh.serverEnv()).toBe(fresh.serverEnv());
  });
});

describe('onVercel (plan 13, task 12)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is true in a Vercel build or function, whatever the other settings, and false elsewhere', async () => {
    const { onVercel } = await import('./env');
    vi.stubEnv('VERCEL_ENV', 'production');
    expect(onVercel()).toBe(true);
    vi.stubEnv('VERCEL_ENV', 'preview');
    expect(onVercel()).toBe(true);
    vi.stubEnv('VERCEL_ENV', '');
    expect(onVercel()).toBe(false);
  });
});

describe('EDITION (plan 13)', () => {
  const selfHosted = { DATABASE_URL: 'file:/data/partner-desk.db', BETTER_AUTH_SECRET: 'x'.repeat(32), EDITION: 'self-hosted', PD_TEST_AUTH: '1', APP_URL: 'http://localhost:3000' };

  it('unset is hosted, with Google storage and 60 agent requests a minute', () => {
    expect(editionFlags(parseEnv(base))).toEqual({ edition: 'hosted', storage: 'google', agentRequestsPerMinute: 60, legal: 'ours', signIn: 'google', adminEmail: null });
    expect(editionFlags(parseEnv({ ...base, EDITION: '' })).edition).toBe('hosted');
    expect(editionFlags(parseEnv({ ...base, EDITION: 'hosted' })).storage).toBe('google');
  });

  it('self-hosted keeps the work in the database', () => {
    expect(editionFlags(parseEnv(selfHosted))).toEqual({
      edition: 'self-hosted', storage: 'database', agentRequestsPerMinute: 60, legal: { privacy: null, terms: null, imprint: null },
      signIn: 'email', adminEmail: null,
    });
  });

  it('a company server names its first admin and its own address (plan 14)', () => {
    const real = { ...selfHosted, PD_TEST_AUTH: undefined, APP_URL: 'https://desk.acme.example' };
    // Without it the server still starts, and the sign-in page names the setting (design §8.2; final review).
    expect(editionFlags(parseEnv(real))).toMatchObject({ signIn: 'email', adminEmail: null });
    expect(() => parseEnv({ ...real, APP_URL: undefined })).toThrow(/Set APP_URL to this server’s address, like https:\/\/desk\.acme\.example: sign-in emails link to it/);
    const named = parseEnv({ ...real, ADMIN_EMAIL: '  Anna@Acme.Example ' });
    expect(editionFlags(named)).toMatchObject({ signIn: 'email', adminEmail: 'anna@acme.example' });
    expect(() => parseEnv({ ...real, ADMIN_EMAIL: 'anna and ben' })).toThrow(/ADMIN_EMAIL must be one email address/);
    expect(parseEnv({ ...real, ADMIN_EMAIL: '', PD_TEST_AUTH: '1', APP_URL: 'http://localhost:3000' }).ADMIN_EMAIL).toBeUndefined();
  });

  it('a company server refuses Google sign-in settings (owner, 2026-11-08)', () => {
    expect(() => parseEnv({ ...selfHosted, GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'cs' })).toThrow(/are for the hosted edition: a company server signs in by email link/);
    expect(() => parseEnv({ ...selfHosted, GOOGLE_CLIENT_SECRET: 'cs' })).toThrow(/GOOGLE_CLIENT_SECRET/);
  });

  it('test sign-in works only with APP_URL set to this computer itself; hosted refuses ADMIN_EMAIL (task 1’s review)', () => {
    for (const appUrl of ['https://desk.acme.example', 'HTTPS://desk.acme.example', 'http://desk.acme.example', 'http://10.0.0.5:3000', undefined]) {
      expect(() => parseEnv({ ...selfHosted, APP_URL: appUrl }), String(appUrl)).toThrow(/PD_TEST_AUTH is for trying PartnerStandard Desk on your own computer/);
    }
    for (const appUrl of ['http://127.0.0.1:3801', 'http://localhost:3000', 'http://LOCALHOST:3000', 'http://[::1]:3000']) {
      expect(parseEnv({ ...selfHosted, APP_URL: appUrl }).PD_TEST_AUTH, appUrl).toBe(true);
    }
    expect(() => parseEnv({ ...base, ADMIN_EMAIL: 'anna@acme.example' })).toThrow(/ADMIN_EMAIL is for self-hosting only/);
  });

  it('self-hosted needs no Google pair, and hosted still does outside test mode', () => {
    expect(parseEnv(selfHosted).GOOGLE_CLIENT_ID).toBeUndefined();
    expect(() => parseEnv({ ...base, GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined })).toThrow(/Set up Google sign-in/);
  });

  it('SCHEDULER: on unless set to off; anything else refused', () => {
    expect(parseEnv(selfHosted).SCHEDULER).toBe('on');
    expect(parseEnv({ ...selfHosted, SCHEDULER: '' }).SCHEDULER).toBe('on');
    expect(parseEnv({ ...selfHosted, SCHEDULER: 'off' }).SCHEDULER).toBe('off');
    // Hosted ignores it (Vercel Cron runs the job), so the e2e servers can set it on both editions.
    expect(parseEnv({ ...base, SCHEDULER: 'off' }).SCHEDULER).toBe('off');
    expect(() => parseEnv({ ...selfHosted, SCHEDULER: 'no' })).toThrow(/SCHEDULER must be on or off/);
  });

  it('UPDATE_CHECK: on unless set to off; anything else refused', () => {
    expect(parseEnv(selfHosted).UPDATE_CHECK).toBe('on');
    expect(parseEnv({ ...selfHosted, UPDATE_CHECK: 'off' }).UPDATE_CHECK).toBe('off');
    expect(() => parseEnv({ ...selfHosted, UPDATE_CHECK: 'never' })).toThrow(/UPDATE_CHECK must be on or off/);
  });

  it('AGENT_REQUESTS_PER_MINUTE is for self-hosted only, from 1 to 6000', () => {
    expect(() => parseEnv({ ...base, AGENT_REQUESTS_PER_MINUTE: '300' })).toThrow(/AGENT_REQUESTS_PER_MINUTE is for self-hosting only/);
    expect(editionFlags(parseEnv({ ...selfHosted, AGENT_REQUESTS_PER_MINUTE: '300' })).agentRequestsPerMinute).toBe(300);
    expect(() => parseEnv({ ...selfHosted, AGENT_REQUESTS_PER_MINUTE: '0' })).toThrow(/AGENT_REQUESTS_PER_MINUTE/);
    expect(() => parseEnv({ ...selfHosted, AGENT_REQUESTS_PER_MINUTE: '6001' })).toThrow(/AGENT_REQUESTS_PER_MINUTE/);
    expect(() => parseEnv({ ...selfHosted, AGENT_REQUESTS_PER_MINUTE: 'lots' })).toThrow(/AGENT_REQUESTS_PER_MINUTE/);
    for (const loose of ['1e2', '0x10', ' 300 ', '300.0', '-5', ' ']) {
      expect(() => parseEnv({ ...selfHosted, AGENT_REQUESTS_PER_MINUTE: loose })).toThrow(/AGENT_REQUESTS_PER_MINUTE must be a whole number from 1 to 6000/);
    }
  });

  it('self-hosted is refused on Vercel', () => {
    expect(() => parseEnv({ ...selfHosted, PD_TEST_AUTH: undefined, VERCEL_ENV: 'production', APP_URL: 'https://x.example.com' }))
      .toThrow(/EDITION=self-hosted can’t run on Vercel/);
  });

  it('self-hosted links to the company’s own legal pages, each only when set; hosted refuses them (task 12)', () => {
    const legal = { LEGAL_PRIVACY_URL: 'https://acme.example/privacy', LEGAL_IMPRINT_URL: 'http://acme.example/imprint', LEGAL_TERMS_URL: '' };
    expect(editionFlags(parseEnv({ ...selfHosted, ...legal })).legal)
      .toEqual({ privacy: 'https://acme.example/privacy', terms: null, imprint: 'http://acme.example/imprint' });
    expect(() => parseEnv({ ...base, LEGAL_PRIVACY_URL: 'https://acme.example/privacy' })).toThrow(/LEGAL_PRIVACY_URL is for self-hosting only/);
    expect(parseEnv({ ...base, LEGAL_TERMS_URL: '' }).LEGAL_TERMS_URL).toBeUndefined();
    const bad = ['acme.example/privacy', 'javascript:alert(1)', '/privacy', 'https://', 'https:// acme.example', 'ftp://acme.example', 'https://?x', 'https://#', 'https://localhost/x'];
    for (const value of bad) {
      expect(() => parseEnv({ ...selfHosted, LEGAL_TERMS_URL: value }), value).toThrow(/LEGAL_TERMS_URL must be a full web address, like https:\/\/acme\.example\/privacy/);
    }
  });

  it('an unknown EDITION is refused', () => {
    expect(() => parseEnv({ ...base, EDITION: 'cloud' })).toThrow(/EDITION/);
  });
});
