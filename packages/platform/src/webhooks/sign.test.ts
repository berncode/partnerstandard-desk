import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { newSecret, signatureHeaders } from './sign';

describe('Standard Webhooks signing', () => {
  it('the signature matches the Standard Webhooks reference vector', () => {
    // The reference libraries' signing test (TestWebhookSign):
    // https://github.com/standard-webhooks/standard-webhooks/blob/main/libraries/go/webhook_test.go
    const secret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'; // gitleaks:allow (a made-up test value)
    const body = '{"test": 2432232314}';
    expect(signatureHeaders(secret, 'msg_p5jXN8AQM9LWM0D4loKWxJek', 1614265330, body)).toEqual({ // gitleaks:allow (a made-up test value)
      'webhook-id': 'msg_p5jXN8AQM9LWM0D4loKWxJek',
      'webhook-timestamp': '1614265330',
      'webhook-signature': 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
    });
  });

  it('a new secret is whsec_ and 24 random bytes in base64, and never the same twice', () => {
    const a = newSecret();
    const b = newSecret();
    expect(a).toMatch(/^whsec_[A-Za-z0-9+/]{32}$/);
    expect(Buffer.from(a.slice(6), 'base64')).toHaveLength(24);
    expect(a).not.toBe(b);
  });

  it('signs with the secret’s decoded bytes, so a receiver’s library checks it', () => {
    const secret = newSecret();
    const headers = signatureHeaders(secret, 'evt_1', 1_700_000_000, '{"a":1}');
    const expected = createHmac('sha256', Buffer.from(secret.slice(6), 'base64')).update('evt_1.1700000000.{"a":1}').digest('base64');
    expect(headers['webhook-signature']).toBe(`v1,${expected}`);
  });
});
