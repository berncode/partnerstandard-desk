import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth, type BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import * as authSchema from '../db/auth-schema';
import { AGENT_CLOSED_PATHS } from './agent-oauth';
import type { Db } from '../db/client';
import { editionFlags, type ServerEnv } from '../env';
import { mayBecomeUser, signInLinkPlugin, type SendSignInLink } from './sign-in-link';

/** Only files the app creates or the user picks: never the whole Drive. */
export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

const DAY = 60 * 60 * 24;

type AuthLogLevel = 'debug' | 'info' | 'warn' | 'error';

/** A status code such as INTERNAL_SERVER_ERROR or a digest such as HANGING_PROMISE_REJECTION. */
const CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
/** Better Auth's lower-case codes such as account_not_linked. Tokens and ids have no underscore. */
const SNAKE_CODE = /^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+$/;
/** A fixed phrase such as "State not found": letters and plain punctuation, no digit, '@', '/', '=' or '?'. */
const PHRASE = /^[A-Za-z][A-Za-z ,.'"()[\]#_-]*$/;
/** An error's class name such as DrizzleQueryError. */
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** The error's name and code (or digest), and those of its causes: plain words only, never a message. */
function errorWords(value: unknown, depth = 0): string[] {
  if (depth > 3 || typeof value !== 'object' || value === null) return [];
  const { name, code, digest, cause } = value as { name?: unknown; code?: unknown; digest?: unknown; cause?: unknown };
  const words = [
    ...(typeof name === 'string' && NAME.test(name) ? [name] : []),
    ...[code, digest].filter((w): w is string => typeof w === 'string' && CODE.test(w)),
  ];
  const rest = errorWords(cause, depth + 1);
  return rest.length > 0 ? [...words, '<', ...rest] : words;
}

/**
 * What of a message may be logged: a code as it is, or a fixed phrase cut at its first colon (what follows a colon is
 * the detail: a query, an origin, a value). A phrase with a digit, an '@', a URL or a word longer than 24 letters (a
 * token is 32) is hidden, and so is anything else.
 */
function safeMessage(message: string): string {
  const text = message.trim();
  if (text.length <= 64 && (CODE.test(text) || SNAKE_CODE.test(text))) return text;
  const cut = text.search(/[:\n]/);
  if (cut >= 0 && text.startsWith('://', cut)) return 'message_hidden'; // the colon of a URL, not of a phrase
  const phrase = (cut >= 0 ? text.slice(0, cut) : text).trim();
  const plain = phrase.length > 0 && phrase.length <= 120 && PHRASE.test(phrase)
    && !/[A-Za-z]\.[A-Za-z]/.test(phrase) // a domain such as www.example.com
    && phrase.split(/\s+/).every((word) => word.length <= 24);
  return plain ? phrase : 'message_hidden';
}

/**
 * The one line Better Auth may log. Its messages and arguments can carry a driver error whose text holds the query
 * and its parameters (a session token, on a failed session read), so only the level, a code or fixed phrase, and the
 * errors' names and codes leave here. Other text becomes `message_hidden`.
 */
export function authLogLine(level: AuthLogLevel, message: unknown, args: readonly unknown[]): string {
  const code = typeof message === 'string' ? safeMessage(message) : null;
  const names = [message, ...args].flatMap((arg) => {
    const words = errorWords(arg);
    return words.length > 0 ? [words.join(' ')] : [];
  });
  return ['[auth]', level, ...(code ? [code] : []), ...names].join(' ');
}

function authLog(level: AuthLogLevel, message: string, ...args: unknown[]): void {
  const line = authLogLine(level, message, args);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

/**
 * Owner sign-in with Google: identity (`openid email profile`, Better Auth's defaults) plus Drive file access in one
 * consent screen. Offline, with consent every time so a refresh token always comes back. Tokens are encrypted at rest
 * with BETTER_AUTH_SECRET.
 *
 * The app passes `plugins`: `nextCookies()` last, and Better Auth's `testUtils()` first only when PD_TEST_AUTH is on.
 * Platform does not import `better-auth/next-js`, so it stays free of Next.js.
 */
export function buildAuth({ db, env, plugins = [], sendSignInLink }: {
  db: Db; env: ServerEnv; plugins?: BetterAuthPlugin[];
  /** A company server's sign-in emails (plan 14). Without it, no link goes out. */
  sendSignInLink?: SendSignInLink;
}) {
  // A company server signs in by email link only, never with Google (owner, 2026-11-08).
  const emailSignIn = editionFlags(env).signIn === 'email';
  const google = !emailSignIn && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        scope: [GOOGLE_DRIVE_SCOPE],
        accessType: 'offline' as const,
        prompt: 'select_account consent' as const,
      },
    }
    : {};
  return betterAuth({
    baseURL: env.APP_URL,
    // Better Auth's own logger prints the error with its query and parameters: a session token in the logs.
    // `level` stays unset: a set level also sends the raw message through Better Auth's shared logger.
    logger: { log: authLog },
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: 'sqlite', schema: authSchema }),
    account: { encryptOAuthTokens: true, accountLinking: { enabled: true, disableImplicitLinking: true } },
    session: { expiresIn: 30 * DAY, updateAge: DAY },
    // A sign-in that fails at Google or in the callback lands on /sign-in?error=<code>, not Better Auth's own page.
    // `throw`: an error that is not an APIError (a failed query) leaves the handler instead of being printed whole by
    // better-call's router (`# SERVER_ERROR`, with the query's parameters); the app's auth route answers it with a
    // bare 500. APIErrors (redirects, 4xx, Better Auth's own 500) still become responses.
    onAPIError: { errorURL: '/sign-in', throw: true },
    // The browser must never receive Google tokens, and the scopes are fixed.
    // disabledPaths only blocks HTTP; server-side auth.api.getAccessToken keeps working.
    // '/token' is the jwt() plugin's "session as a JWT" (agents' sign-in): never handed out. The agents' token endpoint
    // is /oauth2/token and stays. AGENT_CLOSED_PATHS: the OAuth provider's paths agent apps don't need (agent-oauth.ts).
    // '/magic-link/verify' is the email link plugin's own link: a GET that signs in on a visit. Our confirm page's
    // POST verifies on the server instead (plan 14). '/sign-in/magic-link' would ask for a link past the app's own
    // limits (task 4's review): the sign-in page's action asks on the server. On hosted the plugin isn't there at all.
    disabledPaths: [
      '/refresh-token', '/get-access-token', '/link-social', '/token', '/magic-link/verify', '/sign-in/magic-link', ...AGENT_CLOSED_PATHS,
    ],
    // On a company server only its first admin, an invited address and test sign-in's own users become a user (plans 14, 15).
    ...(emailSignIn ? {
      databaseHooks: {
        user: { create: { before: async (user: { email: string }) => ((await mayBecomeUser(env, db, user.email)) ? undefined : false) } },
      },
    } : {}),
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-in/social') return;
        const { scopes, idToken, additionalParams } = (ctx.body ?? {}) as { scopes?: unknown; idToken?: unknown; additionalParams?: unknown };
        const extraParams = typeof additionalParams === 'object' && additionalParams !== null && Object.keys(additionalParams).length > 0;
        if ((Array.isArray(scopes) && scopes.length > 0) || idToken || extraParams) {
          throw new APIError('BAD_REQUEST', { message: 'Scopes, tokens and authorize parameters cannot be supplied by the client' });
        }
      }),
    },
    socialProviders: { ...google },
    plugins: emailSignIn ? [signInLinkPlugin(env, db, sendSignInLink ?? (async () => {})), ...plugins] : plugins,
  });
}

export type Auth = ReturnType<typeof buildAuth>;
