// The search prompt's file and the import's rules, for the market page. Pure: no React, no I/O.
// The import also checks the Partner book, and saves in one batch, all or nothing.
import {
  accountOf, canTick, importChanges, MAX_BATCH, provisionalIdOf,
  type ImportSource, type Market, type PartnerBook, type PartnerChange, type PreviewRow,
} from '@partner-desk/core';
import { PARTNER_TYPE_LABELS, type PartnerType } from '@partner-desk/method';
import { CLOSED_LABELS, COPY } from '@partner-desk/copy';

/** An uploaded file may be up to 2 MB. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** The file *Download* saves: `search-prompt-{market}.md`, with only letters and digits from the market's name. */
export function searchPromptFileName(marketName: string): string {
  const safe = marketName.split(/[^\p{L}\p{N}]+/u).filter(Boolean).join('-');
  return `search-prompt-${safe || 'market'}.md`;
}

/** Whether a row can be ticked: core's rule, which an accepted proposal of new partners follows too. */
export { canTick };

/** The note under a row's company: its problem, or what the duplicate check found. Null for a new company. */
export function rowNote(row: PreviewRow, addedType: PartnerType): { text: string; problem: boolean } | null {
  if (row.problem) return { text: row.problem, problem: true };
  const duplicate = row.duplicate;
  const added = PARTNER_TYPE_LABELS[addedType];
  switch (duplicate?.kind) {
    case 'in_table':
      return { text: COPY.ROW_IN_TABLE, problem: false };
    case 'linked':
      return { text: COPY.ROW_IN_MARKET, problem: false };
    case 'existing':
      if (duplicate.signed) return { text: COPY.ROW_ALREADY_SIGNED(added), problem: false };
      if (duplicate.closed) return { text: COPY.ROW_CLOSED(duplicate.company, added, CLOSED_LABELS[duplicate.closed]), problem: false };
      return { text: COPY.ROW_EXISTING, problem: false };
    case 'other_type':
      return { text: COPY.ROW_OTHER_TYPE(duplicate.company, PARTNER_TYPE_LABELS[duplicate.partnerType], added), problem: false };
    case 'exclusion':
      return { text: COPY.ROW_EXCLUDED(duplicate.reason.trim()), problem: false };
    default:
      return null;
  }
}

/** The preview with the person's own ticks (by row) on the rows that can be ticked; the others keep core's choice. */
export function withTicks<P extends { rows: PreviewRow[] }>(preview: P, ticks: Readonly<Record<number, boolean>>): P {
  return { ...preview, rows: preview.rows.map((row, i) => (canTick(row) && i in ticks ? { ...row, selected: ticks[i]! } : row)) };
}

/** The rows that will go in: ticked, and allowed. */
export const tickedRows = (rows: readonly PreviewRow[]): PreviewRow[] => rows.filter((row) => row.selected && canTick(row));

/** What the ticked rows do: how many partners are new, and how many the book has that get this market. */
export function importCounts(rows: readonly PreviewRow[]): { added: number; linked: number } {
  const ticked = tickedRows(rows);
  const linked = ticked.filter((row) => row.duplicate?.kind === 'existing').length;
  return { added: ticked.length - linked, linked };
}

/** The changes for the ticked rows: core's `importChanges`, only for rows that can be ticked. */
export function changesFor(rows: readonly PreviewRow[], source: ImportSource, market: Market): PartnerChange[] {
  return importChanges(tickedRows(rows), source, market);
}

/** More changes than one import (one write) can carry. */
export const tooManyForOneImport = (changes: readonly PartnerChange[]): boolean => changes.length > MAX_BATCH;

/** The company a change in the batch is about: its own, the new partner's it points at, or the book's partner's. */
function companyOf(changes: readonly PartnerChange[], index: number, book: PartnerBook): string | null {
  const change = changes[index];
  if (change?.kind !== 'add') return null;
  if (typeof change.values.company === 'string') return change.values.company;
  const partnerId = change.values.partnerId;
  if (typeof partnerId !== 'string') return null;
  const owner = changes.find((c) => provisionalIdOf(c) === partnerId);
  if (owner?.kind === 'add') {
    if (typeof owner.values.company === 'string') return owner.values.company;
    const accountId = owner.values.accountId;
    const account = typeof accountId === 'string'
      ? changes.find((c) => c.kind === 'add' && c.entity === 'account' && c.values.id === accountId)
      : undefined;
    if (account?.kind === 'add' && typeof account.values.company === 'string') return account.values.company;
  }
  const section = book.partners.find((p) => p.id === partnerId);
  return section ? accountOf(book, section)?.company ?? null : null;
}

/**
 * What to say when an import is refused (nothing was saved): the company it stopped at, when the refusal says how
 * many changes came before it, and why.
 */
export function refusalLines(
  changes: readonly PartnerChange[], outcome: { valid?: number; message?: string }, book: PartnerBook,
): string[] {
  const company = outcome.valid === undefined ? null : companyOf(changes, outcome.valid, book);
  const first = company ? COPY.IMPORT_REFUSED_AT(company) : COPY.IMPORT_REFUSED;
  return outcome.message ? [first, outcome.message] : [first];
}
