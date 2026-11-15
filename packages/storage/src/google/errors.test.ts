import { describe, expect, it } from 'vitest';
import { COPY } from '@partner-desk/copy';
import { StoreFailure } from '../errors';
import { GoogleApiError } from './client';
import { toStoreError } from './errors';

describe('toStoreError', () => {
  it('maps each Google kind to a store error with plain words', () => {
    expect(toStoreError(new GoogleApiError('auth', 401, 'x'))).toEqual({ ok: false, error: 'auth', message: COPY.AUTH_MESSAGE });
    expect(toStoreError(new GoogleApiError('not_found', 404, 'x'))).toEqual({ ok: false, error: 'file_not_found', message: COPY.FILE_GONE });
    expect(toStoreError(new GoogleApiError('quota', 403, 'x'))).toEqual({ ok: false, error: 'quota', message: COPY.QUOTA_MESSAGE });
    expect(toStoreError(new GoogleApiError('unavailable', 503, 'x'))).toEqual({ ok: false, error: 'unavailable', message: COPY.UNAVAILABLE_MESSAGE });
    expect(toStoreError(new GoogleApiError('bad_request', 400, 'x'))).toEqual({ ok: false, error: 'unavailable', message: COPY.UNAVAILABLE_MESSAGE });
  });
  it('passes a StoreFailure through', () => {
    expect(toStoreError(new StoreFailure('conflict', 'm'))).toEqual({ ok: false, error: 'conflict', message: 'm' });
  });
  it('rethrows anything else', () => {
    expect(() => toStoreError(new TypeError('bug'))).toThrow(TypeError);
  });
});
