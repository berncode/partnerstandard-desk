/** One email. MAP content may be in it (it goes to the MAP's people); it is never logged. */
export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  /** Extra headers, e.g. List-Unsubscribe and List-Unsubscribe-Post (RFC 8058). */
  headers?: Record<string, string>;
}

/** `id` is Resend's email id, kept in the email log; null when the reply couldn't be read or the email was dropped. */
export type SendResult = { ok: true; id: string | null } | { ok: false };

/** Ids a dropped or failed email is logged with: never an address or content. */
export type MailIds = Record<string, string>;

export interface Mailer {
  send(message: MailMessage, ids?: MailIds): Promise<SendResult>;
}

export const RESEND_API = 'https://api.resend.com/emails';

const idFrom = (body: unknown): string | null =>
  typeof body === 'object' && body !== null && typeof (body as { id?: unknown }).id === 'string' ? (body as { id: string }).id : null;

/** Resend's REST API. Not retried: a repeat could send twice. Failures come back as { ok: false }, never thrown. */
export class ResendMailer implements Mailer {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: { apiKey: string; from: string; fetch?: typeof fetch }) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  async send(message: MailMessage): Promise<SendResult> {
    try {
      const response = await this.fetchImpl(RESEND_API, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: this.options.from, to: [message.to], subject: message.subject, html: message.html, text: message.text,
          ...(message.replyTo ? { reply_to: message.replyTo } : {}),
          ...(message.headers ? { headers: message.headers } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return { ok: false };
      // The send happened either way: an unreadable reply only loses the id.
      return { ok: true, id: await response.json().then(idFrom, () => null) };
    } catch {
      return { ok: false };
    }
  }
}

/** Test sign-in and unit tests: keeps every message instead of sending it. */
export class MemoryMailer implements Mailer {
  readonly outbox: MailMessage[] = [];

  async send(message: MailMessage): Promise<SendResult> {
    this.outbox.push(message);
    return { ok: true, id: `mem_${this.outbox.length}` };
  }
}

/**
 * Staging (EMAIL_ALLOWLIST): sends only to the listed addresses. Any other email is dropped, logged with ids only, and
 * answered as sent, so the job doesn't retry it [builder's call].
 */
export class AllowlistMailer implements Mailer {
  private readonly allowed: Set<string>;

  constructor(private readonly inner: Mailer, allowed: string[], private readonly log: (event: string, ids: MailIds) => void) {
    this.allowed = new Set(allowed.map((a) => a.trim().toLowerCase()));
  }

  async send(message: MailMessage, ids: MailIds = {}): Promise<SendResult> {
    if (this.allowed.has(message.to.trim().toLowerCase())) return this.inner.send(message, ids);
    try { this.log('email_dropped_not_allowed', ids); } catch { /* logging must not throw */ }
    return { ok: true, id: null };
  }
}
