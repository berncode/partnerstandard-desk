import { describe, expect, it } from 'vitest';
import { ReconnectRequired, StoreFailure, TokenUnavailable } from './index';

describe('storage errors', () => {
  it('carry a name and, for StoreFailure, a code and message', () => {
    const failure = new StoreFailure('auth', 'Reconnect Google');
    expect(failure).toMatchObject({ name: 'StoreFailure', code: 'auth', message: 'Reconnect Google' });
    expect(new ReconnectRequired().name).toBe('ReconnectRequired');
    expect(new TokenUnavailable()).toBeInstanceOf(Error);
  });
});
