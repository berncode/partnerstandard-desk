// Webhook signing as the Standard Webhooks spec has it (agents spec 7.4), so receivers can check with its libraries:
// https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md
import { createHmac, randomBytes } from 'node:crypto';

const PREFIX = 'whsec_';

/** A new signing secret: `whsec_` and 24 random bytes in base64. Shown once; stored encrypted. */
export function newSecret(): string {
  return `${PREFIX}${randomBytes(24).toString('base64')}`;
}

/**
 * The three headers of one attempt: the event id, the attempt's time in seconds, and `v1,` with the base64 HMAC-SHA256
 * of `id.timestamp.body`, keyed by the secret's decoded bytes.
 */
export function signatureHeaders(
  secret: string, id: string, timestampSec: number, body: string,
): { 'webhook-id': string; 'webhook-timestamp': string; 'webhook-signature': string } {
  const key = Buffer.from(secret.startsWith(PREFIX) ? secret.slice(PREFIX.length) : secret, 'base64');
  const timestamp = String(Math.floor(timestampSec));
  const signature = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
  return { 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${signature}` };
}
