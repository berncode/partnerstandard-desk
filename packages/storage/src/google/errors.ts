import { COPY } from '@partner-desk/copy';
import { StoreFailure } from '../errors';
import type { StoreError } from '../types';
import { GoogleApiError } from './client';

const FILE_NOT_FOUND: StoreError = { ok: false, error: 'file_not_found', message: COPY.FILE_GONE };

/** Maps a thrown Google or store failure to a StoreError. Anything else is a bug and is rethrown. Carries no body or token. */
export function toStoreError(error: unknown): StoreError {
  if (error instanceof StoreFailure) return { ok: false, error: error.code, message: error.message };
  if (error instanceof GoogleApiError) {
    if (error.kind === 'auth') return { ok: false, error: 'auth', message: COPY.AUTH_MESSAGE };
    if (error.kind === 'not_found') return FILE_NOT_FOUND;
    if (error.kind === 'quota') return { ok: false, error: 'quota', message: COPY.QUOTA_MESSAGE };
    return { ok: false, error: 'unavailable', message: COPY.UNAVAILABLE_MESSAGE };
  }
  throw error;
}
