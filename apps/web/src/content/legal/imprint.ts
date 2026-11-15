// The imprint page as data (plan 19, task 3): in the public code a neutral stand-in; the hosted build puts the operator's
// own text in its place (scripts/legal-pages.mjs). A company server shows none of these pages.
import { checkLegalDoc } from './check.mjs';
import page from './pages/imprint.json';
import type { LegalDoc } from './types';

export const IMPRINT: LegalDoc = checkLegalDoc(page, 'imprint');
