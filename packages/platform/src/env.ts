import { z } from 'zod';

/** Empty strings in .env files mean "unset". */
const optional = z.preprocess((value) => (value === '' ? undefined : value), z.string().optional());
/** True only for an address on this computer itself: localhost or a loopback address, in any letter case. */
function isLoopbackUrl(value: string | undefined): boolean {
  if (value === undefined) return false;
  try {
    const { hostname } = new URL(value);
    return hostname === 'localhost' || hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(hostname);
  } catch {
    return false;
  }
}

/** A company's own legal page (self-hosted): a full web address on a real domain, https or http. */
const legalUrl = (name: string) => z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.url({ protocol: /^https?$/, hostname: z.regexes.domain, error: `${name} must be a full web address, like https://acme.example/privacy` }).optional(),
);
/** The three legal pages a company server links to instead of PartnerStandard's (spec 2026-11-07 §14). */
const LEGAL_SETTINGS = ['LEGAL_PRIVACY_URL', 'LEGAL_TERMS_URL', 'LEGAL_IMPRINT_URL'] as const;

const schema = z
  .object({
    APP_URL: z.preprocess((value) => (value === '' ? undefined : value), z.string().url().optional()),
    DATABASE_URL: z.string({ error: 'DATABASE_URL (or TURSO_DATABASE_URL) is required' }).min(1, 'DATABASE_URL (or TURSO_DATABASE_URL) is required'),
    DATABASE_AUTH_TOKEN: optional,
    BETTER_AUTH_SECRET: z
      .string({ error: 'BETTER_AUTH_SECRET is required' })
      .min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
    GOOGLE_CLIENT_ID: optional,
    GOOGLE_CLIENT_SECRET: optional,
    PD_TEST_AUTH: z.enum(['0', '1']).default('0').transform((value) => value === '1'),
    /** Self-hosted only: webhooks may go to http and to private or local addresses. Refused on Vercel. */
    WEBHOOKS_ALLOW_PRIVATE: z.preprocess((value) => (value === '' ? undefined : value), z.enum(['0', '1']).default('0'))
      .transform((value) => value === '1'),
    VERCEL_ENV: z.enum(['production', 'preview', 'development']).optional(),
    /** Which edition runs (spec 2026-11-07 §5): hosted (the default, Google Drive) or self-hosted (the work in this database). */
    EDITION: z.preprocess((value) => (value === '' ? undefined : value), z.enum(['hosted', 'self-hosted']).default('hosted')),
    /** Self-hosted only: the agents' requests a minute, per agent or key (spec §11). Hosted keeps 60, under Google's limit. */
    AGENT_REQUESTS_PER_MINUTE: z.preprocess(
      // Digits only: no "1e2", "0x10" or " 300 " read as a number by accident.
      (value) => (value === '' || value === undefined ? undefined : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : Number.NaN),
      z.number({ error: 'AGENT_REQUESTS_PER_MINUTE must be a whole number from 1 to 6000' })
        .int('AGENT_REQUESTS_PER_MINUTE must be a whole number from 1 to 6000')
        .min(1, 'AGENT_REQUESTS_PER_MINUTE must be a whole number from 1 to 6000')
        .max(6000, 'AGENT_REQUESTS_PER_MINUTE must be a whole number from 1 to 6000').optional(),
    ),
    /** MAP emails (task 8): Resend's API key and the sender, set together; without them no email goes out. */
    RESEND_API_KEY: optional,
    EMAIL_FROM: optional,
    /**
     * Self-hosted only: the address of the person who signs in first and becomes the first admin (plans 14, 15). The
     * others sign in once invited. It stays set: without it the sign-in page shows no form.
     */
    ADMIN_EMAIL: z.preprocess(
      (value) => (typeof value === 'string' ? value.trim().toLowerCase() || undefined : value),
      z.email({ error: 'ADMIN_EMAIL must be one email address, like anna@acme.example' }).optional(),
    ),
    /** Self-hosted only: the company's own privacy policy, terms and imprint, in place of PartnerStandard's. */
    LEGAL_PRIVACY_URL: legalUrl('LEGAL_PRIVACY_URL'),
    LEGAL_TERMS_URL: legalUrl('LEGAL_TERMS_URL'),
    LEGAL_IMPRINT_URL: legalUrl('LEGAL_IMPRINT_URL'),
    /** What Vercel Cron sends as `Authorization: Bearer …` to the scheduled job. Without it the job answers 401. */
    CRON_SECRET: z.preprocess((value) => (value === '' ? undefined : value), z.string().min(16, 'CRON_SECRET must be at least 16 characters').optional()),
    /**
     * Self-hosted only: `off` stops the server's own 15-minute timer for the scheduled job (plan 17), for a company that
     * calls /api/cron/tick from its own scheduler instead. Hosted runs the job from Vercel Cron and ignores it.
     */
    SCHEDULER: z.preprocess((value) => (value === '' ? undefined : value), z.enum(['on', 'off'], { error: 'SCHEDULER must be on or off' }).default('on')),
    /** Self-hosted only: `off` stops the daily look at GitHub's release list for the update notice (plan 17). */
    UPDATE_CHECK: z.preprocess((value) => (value === '' ? undefined : value), z.enum(['on', 'off'], { error: 'UPDATE_CHECK must be on or off' }).default('on')),
    /** Set in a released image, not by hand: its version (1.4.2) and the repository its releases come from. */
    APP_VERSION: optional,
    APP_REPO: optional,
    /** Staging: comma-separated addresses; every other recipient is dropped. Unset: everyone. */
    EMAIL_ALLOWLIST: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().optional().transform((value) => {
        if (value === undefined) return null;
        return value.split(',').map((address) => address.trim().toLowerCase()).filter((address) => address.length > 0);
      }),
    ),
  })
  .superRefine((env, ctx) => {
    const onVercel = env.VERCEL_ENV === 'production' || env.VERCEL_ENV === 'preview';
    const selfHosted = env.EDITION === 'self-hosted';
    // The database edition never runs on Vercel: there the work lives in Google Drive.
    if (selfHosted && env.VERCEL_ENV !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['EDITION'], message: 'EDITION=self-hosted can’t run on Vercel' });
    }
    // Without ADMIN_EMAIL a company server still starts, and its sign-in page says which setting is missing (design
    // §8.2, owner 2026-11-07). Its sign-in emails link to APP_URL, so a real install names its own address.
    if (selfHosted && !env.PD_TEST_AUTH && env.APP_URL === undefined) {
      ctx.addIssue({
        code: 'custom', path: ['APP_URL'],
        message: 'Set APP_URL to this server’s address, like https://desk.acme.example: sign-in emails link to it',
      });
    }
    // Test sign-in lets anyone in without an email. On a company server it needs APP_URL set to this computer itself
    // (localhost or a loopback address), so a real install never has it on (plan 14, task 1's review).
    if (selfHosted && env.PD_TEST_AUTH && !isLoopbackUrl(env.APP_URL)) {
      ctx.addIssue({
        code: 'custom', path: ['PD_TEST_AUTH'],
        message: 'PD_TEST_AUTH is for trying PartnerStandard Desk on your own computer: set APP_URL to http://localhost:3000. A real install signs in by email link only',
      });
    }
    // A company server signs in by email link only, never with Google (owner, 2026-11-08).
    if (selfHosted && (env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_SECRET)) {
      ctx.addIssue({
        code: 'custom', path: [env.GOOGLE_CLIENT_ID ? 'GOOGLE_CLIENT_ID' : 'GOOGLE_CLIENT_SECRET'],
        message: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are for the hosted edition: a company server signs in by email link',
      });
    }
    if (!selfHosted && env.ADMIN_EMAIL !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['ADMIN_EMAIL'], message: 'ADMIN_EMAIL is for self-hosting only: hosted signs in with Google' });
    }
    if (!selfHosted && env.AGENT_REQUESTS_PER_MINUTE !== undefined) {
      ctx.addIssue({
        code: 'custom', path: ['AGENT_REQUESTS_PER_MINUTE'],
        message: 'AGENT_REQUESTS_PER_MINUTE is for self-hosting only: hosted keeps 60, under Google’s limit',
      });
    }
    // Hosted shows PartnerStandard's own privacy policy, terms and imprint; only a company server links to its own.
    for (const name of LEGAL_SETTINGS) {
      if (!selfHosted && env[name] !== undefined) {
        ctx.addIssue({ code: 'custom', path: [name], message: `${name} is for self-hosting only: hosted shows PartnerStandard’s own pages` });
      }
    }
    if (env.PD_TEST_AUTH && onVercel) {
      ctx.addIssue({ code: 'custom', path: ['PD_TEST_AUTH'], message: 'PD_TEST_AUTH must never be on on Vercel (production or preview)' });
    }
    // Hosted, a webhook must never reach Vercel's or anyone's inside network (agents spec 7.4).
    if (env.WEBHOOKS_ALLOW_PRIVATE && env.VERCEL_ENV !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['WEBHOOKS_ALLOW_PRIVATE'], message: 'WEBHOOKS_ALLOW_PRIVATE is for self-hosting only: never set it on Vercel' });
    }
    if (onVercel && !env.APP_URL) {
      ctx.addIssue({ code: 'custom', path: ['APP_URL'], message: 'APP_URL is required on Vercel (no localhost default)' });
    }
    // The MAP link cookie is Secure only on an https APP_URL; a hosted app never runs without it.
    if (onVercel && env.APP_URL && !env.APP_URL.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', path: ['APP_URL'], message: 'APP_URL must start with https:// on Vercel' });
    }
    if (Boolean(env.RESEND_API_KEY) !== Boolean(env.EMAIL_FROM)) {
      ctx.addIssue({ code: 'custom', path: [env.RESEND_API_KEY ? 'EMAIL_FROM' : 'RESEND_API_KEY'], message: 'RESEND_API_KEY and EMAIL_FROM go together: set both or neither' });
    }
    // The Google pair is complete or absent; outside test mode it is required.
    if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET)) {
      const missing = env.GOOGLE_CLIENT_ID ? 'GOOGLE_CLIENT_SECRET' : 'GOOGLE_CLIENT_ID';
      ctx.addIssue({ code: 'custom', path: [missing], message: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET go together: set both or neither' });
    } else if (!selfHosted && !env.PD_TEST_AUTH && !env.GOOGLE_CLIENT_ID) {
      ctx.addIssue({
        code: 'custom', path: ['GOOGLE_CLIENT_ID'],
        message: 'Set up Google sign-in: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (or PD_TEST_AUTH=1)',
      });
    }
  })
  // Off Vercel, local development and e2e fall back to localhost.
  .transform((env) => ({ ...env, APP_URL: env.APP_URL ?? 'http://localhost:3000' }));

export type ServerEnv = z.output<typeof schema>;

/**
 * The Vercel Turso integration names its variables TURSO_*, or DATABASE_TURSO_* when connected with the prefix
 * "DATABASE"; DATABASE_* wins when several are set.
 */
function withTursoAliases(source: Record<string, string | undefined>): Record<string, string | undefined> {
  return {
    ...source,
    DATABASE_URL: source.DATABASE_URL || source.TURSO_DATABASE_URL || source.DATABASE_TURSO_DATABASE_URL,
    DATABASE_AUTH_TOKEN: source.DATABASE_AUTH_TOKEN || source.TURSO_AUTH_TOKEN || source.DATABASE_TURSO_AUTH_TOKEN,
  };
}

export function parseEnv(source: Record<string, string | undefined>): ServerEnv {
  const parsed = schema.safeParse(withTursoAliases(source));
  if (parsed.success) return parsed.data;
  const problems = parsed.error.issues.map((issue) => `- ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  throw new Error(`Invalid server environment:\n${problems.join('\n')}`);
}

let cached: ServerEnv | undefined;

/** The parsed server environment. Read lazily, so `next build` works without secrets. */
export function serverEnv(): ServerEnv {
  cached ??= parseEnv(process.env);
  return cached;
}

/** What the edition decides, for the wiring only (spec 2026-11-07 §5). Nothing else reads EDITION. */
export interface EditionFlags {
  edition: 'hosted' | 'self-hosted';
  /** Where the work lives: Google Drive (hosted) or this server's database (self-hosted). */
  storage: 'google' | 'database';
  /** The agents' requests a minute, per agent or key: 60 unless self-hosted sets AGENT_REQUESTS_PER_MINUTE. */
  agentRequestsPerMinute: number;
  /** Where the privacy, terms and imprint links go. */
  legal: LegalPages;
  /** How people sign in: the shared Google sign-in (hosted) or an email link (a company server, owner 2026-11-08). */
  signIn: 'google' | 'email';
  /** A company server's first admin: the address that signs in first and becomes admin; null on hosted or unset. */
  adminEmail: string | null;
}

/**
 * Hosted: PartnerStandard's own pages ('ours'). Self-hosted: the company's own addresses, each null when not set, and
 * PartnerStandard's pages never show (spec 2026-11-07 §14).
 */
export type LegalPages = 'ours' | { privacy: string | null; terms: string | null; imprint: string | null };

/** The hosted cap: under Google's 60 reads a minute per person, so one agent can't take them all (agents spec §9). */
const HOSTED_AGENT_REQUESTS_PER_MINUTE = 60;

export function editionFlags(env: ServerEnv): EditionFlags {
  const selfHosted = env.EDITION === 'self-hosted';
  return {
    edition: env.EDITION,
    storage: selfHosted ? 'database' : 'google',
    agentRequestsPerMinute: selfHosted ? env.AGENT_REQUESTS_PER_MINUTE ?? HOSTED_AGENT_REQUESTS_PER_MINUTE : HOSTED_AGENT_REQUESTS_PER_MINUTE,
    legal: selfHosted
      ? { privacy: env.LEGAL_PRIVACY_URL ?? null, terms: env.LEGAL_TERMS_URL ?? null, imprint: env.LEGAL_IMPRINT_URL ?? null }
      : 'ours',
    signIn: selfHosted ? 'email' : 'google',
    adminEmail: selfHosted ? env.ADMIN_EMAIL ?? null : null,
  };
}

/**
 * True when this code was built or runs on Vercel, which is always hosted (EDITION=self-hosted is refused there). Read
 * straight from the process, without the rest of the settings, so a build without secrets can ask it: a hosted page
 * then holds PartnerStandard's legal links in its static HTML, as a crawler without JavaScript sees it.
 */
export function onVercel(): boolean {
  return process.env.VERCEL_ENV !== undefined && process.env.VERCEL_ENV !== '';
}

/**
 * True when this process is a company server (EDITION=self-hosted, never on Vercel), read straight from the process like
 * `onVercel`: for the start-up hook (instrumentation.ts), which runs before anything parses the settings.
 */
export function selfHostedProcess(): boolean {
  return process.env.EDITION === 'self-hosted' && !onVercel();
}

/** True only when test sign-in is on. The env check already refuses it on Vercel production and preview. */
export function testSignInEnabled(): boolean {
  return serverEnv().PD_TEST_AUTH;
}
