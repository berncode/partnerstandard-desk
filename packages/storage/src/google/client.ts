import { ReconnectRequired, TokenUnavailable } from '../errors';
import { backoffMs, isTransientFetchError, retryAfterMs, retryDelayMs } from '../http/retry';

export const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
export const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';

export type GoogleErrorKind = 'auth' | 'not_found' | 'bad_request' | 'quota' | 'unavailable';

/** A Google call that failed. The message names the status only: no tokens, no response bodies (spec §6.2). */
export class GoogleApiError extends Error {
  constructor(readonly kind: GoogleErrorKind, readonly status: number, message: string) {
    super(message);
    this.name = 'GoogleApiError';
  }
}

export interface GoogleClientOptions {
  /** A current access token. Throws ReconnectRequired when the account must be reconnected, TokenUnavailable when it can't tell yet. */
  getAccessToken: () => Promise<string>;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  maxRetries?: number;
  timeoutMs?: number;
  /**
   * The most one request may take, retries and waits included (default 25 s). A wait that would end past it is never
   * started: the request fails as unavailable instead, before the serverless function is stopped.
   */
  deadlineMs?: number;
  /** The clock the time budget is kept by. Tests pass a fake one. */
  now?: () => number;
}

/** Only the fields this client reads. Google also sends code, message and status, which are never read or logged. */
interface GoogleErrorBody {
  error?: { details?: Array<{ reason?: string }>; errors?: Array<{ reason?: string }> };
}

const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const RATE_LIMIT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);

const reasonsOf = (body: GoogleErrorBody) =>
  [...(body.error?.details ?? []), ...(body.error?.errors ?? [])].map((d) => d.reason).filter((r): r is string => !!r);

export interface RequestOptions {
  /**
   * Safe to repeat if Google may already have applied the first attempt. Default false: such a call is
   * then retried only when Google refused it or never read it (429, 408, Drive 403 rate limits, 401), never on
   * 5xx, network errors or timeouts. Mark values:batchUpdate and the trash PATCH idempotent; Drive file/folder
   * creates, the sheet-setup batchUpdate and deleteDimension stay non-idempotent. GET is always idempotent.
   */
  idempotent?: boolean;
}

export class GoogleClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly deadlineMs: number;
  private readonly now: () => number;

  constructor(private readonly options: GoogleClientOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = options.random ?? Math.random;
    this.maxRetries = options.maxRetries ?? 3;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.deadlineMs = options.deadlineMs ?? 25_000;
    this.now = options.now ?? Date.now;
  }

  get<T>(url: string): Promise<T> {
    return this.request<T>('GET', url, undefined, true);
  }

  post<T>(url: string, body: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('POST', url, body, options?.idempotent ?? false);
  }

  patch<T>(url: string, body: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('PATCH', url, body, options?.idempotent ?? false);
  }

  private async token(): Promise<string> {
    try {
      return await this.options.getAccessToken();
    } catch (error) {
      if (error instanceof ReconnectRequired) throw new GoogleApiError('auth', 401, 'Google account must be reconnected');
      // The grant may be fine: a database or Google blip. Never "reconnect" for it.
      if (error instanceof TokenUnavailable) throw new GoogleApiError('unavailable', 0, 'Google sign-in isn’t responding');
      throw error;
    }
  }

  private async request<T>(method: string, url: string, body: unknown, idempotent: boolean): Promise<T> {
    let token = await this.token();
    let refreshedAfter401 = false;
    let attempt = 0; // retries spent; the 401 refresh does not count
    const deadline = this.now() + this.deadlineMs;
    /** Whether a wait of `ms` still ends inside the time budget. */
    const fits = (ms: number) => this.now() + ms <= deadline;
    for (;;) {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method,
          headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
          body: body === undefined ? undefined : JSON.stringify(body),
          // One attempt never runs past the budget either.
          signal: AbortSignal.timeout(Math.max(1, Math.min(this.timeoutMs, deadline - this.now()))),
        });
      } catch (error) {
        if (!isTransientFetchError(error)) throw error;
        const delay = backoffMs(attempt, this.random);
        if (!idempotent || attempt >= this.maxRetries || !fits(delay)) throw new GoogleApiError('unavailable', 0, 'Google did not respond');
        attempt++;
        await this.sleep(delay);
        continue;
      }

      if (response.ok) {
        try {
          const text = await response.text();
          return (text ? JSON.parse(text) : {}) as T;
        } catch {
          throw new GoogleApiError('unavailable', response.status, 'Google sent an unreadable response');
        }
      }

      const errorBody = (await response.json().catch(() => ({}))) as GoogleErrorBody;
      const reasons = reasonsOf(errorBody);
      const status = response.status;

      if (status === 401) {
        if (refreshedAfter401) throw new GoogleApiError('auth', 401, 'Google rejected the access token');
        refreshedAfter401 = true;
        token = await this.token();
        continue;
      }
      if (status === 403 && reasons.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT')) {
        throw new GoogleApiError('auth', 403, 'Google Drive permission is missing');
      }
      if (status === 403 && reasons.includes('storageQuotaExceeded')) {
        throw new GoogleApiError('quota', 403, 'Google Drive storage is full');
      }
      // Google refused these outright (429, Drive's 403 rate limits) or never read the request (408), so repeating
      // is safe for every call; other 5xx may have been applied.
      const refused = status === 408 || status === 429 || (status === 403 && reasons.some((r) => RATE_LIMIT_REASONS.has(r)));
      const retryable = refused || (idempotent && RETRY_STATUS.has(status));
      if (retryable) {
        const delay = retryDelayMs(attempt, this.random, retryAfterMs(response.headers.get('retry-after')));
        if (attempt >= this.maxRetries || !fits(delay)) throw new GoogleApiError('unavailable', status, `Google returned ${status}`);
        attempt++;
        await this.sleep(delay);
        continue;
      }
      if (status === 403 || status === 404) throw new GoogleApiError('not_found', status, `Google returned ${status}`);
      if (status === 400) throw new GoogleApiError('bad_request', status, 'Google rejected the request (400)');
      throw new GoogleApiError('unavailable', status, `Google returned ${status}`);
    }
  }
}
