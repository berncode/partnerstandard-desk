import type { CaseSource as Source } from '@partner-desk/core';

/** A source's name, as the selects and the tags show it. Not a client module, so server-rendered pages can use it. */
export const SOURCE_LABEL: Record<Source, string> = {
  assumption: 'Assumption', finance: 'Finance', sales: 'Sales', partner: 'Partner', other: 'Other',
};
