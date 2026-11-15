import type { StoreErrorCode } from './types';

/** Thrown where a store method has no error result (create) and by token providers. Message is user-facing, ids only. */
export class StoreFailure extends Error {
  constructor(readonly code: StoreErrorCode, message: string) {
    super(message);
    this.name = 'StoreFailure';
  }
}

/**
 * The owner's Google account must be reconnected: no account row, no refresh token, the refresh was refused, or a
 * required permission is missing. Thrown by token providers.
 */
export class ReconnectRequired extends Error {
  constructor() {
    super('The storage account must be reconnected');
    this.name = 'ReconnectRequired';
  }
}

/**
 * A token couldn't be had just now, but the grant may be fine: the database or Google's token check didn't answer.
 * Callers say "try again later", never "reconnect". Thrown by token providers.
 */
export class TokenUnavailable extends Error {
  constructor() {
    super('The storage account’s token is unavailable right now');
    this.name = 'TokenUnavailable';
  }
}
