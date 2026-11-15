// Types for check.mjs.
import type { LegalDoc } from './types';
export const LEGAL_PAGES: Array<'privacy' | 'terms' | 'imprint'>;
export function checkLegalDoc(data: unknown, name: string): LegalDoc;
