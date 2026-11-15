// The column kinds and the column helpers. The two layouts are in layouts.ts.
import type { MarketInfo } from '@partner-desk/core';
import { FOUR_C, FOUR_C_LABELS } from '@partner-desk/method';
import { SHEET_COPY } from '@partner-desk/copy';
import type { EnumName } from './labels';

/**
 * How a value sits in a cell:
 * - `id`, `ref`: an ID; a blank `ref` is null. `refList`: IDs in one cell, comma-separated.
 * - `enum`: the label (labels.ts); a blank cell is null.
 * - `date`: YYYY-MM-DD. `datetime`: an ISO timestamp.
 * - `score`: 0 to 3, blank is null. `bool`: "yes" or blank. `number`: a whole number, blank is null. `amount`: any
 *   number (12000, 12.5), blank is null; text such as "12k" can't be read.
 * - `actor`: who changed the row; a blank cell reads as SHEET_COPY.UPDATED_BY_SHEET.
 * - `optionalText`: text, null when blank.
 * - `nameRef`: a row of another tab (`refersTo`), named by its Name column as people read it (a MAP's Owner and
 *   Milestone, as the MAP app writes them). It holds the row's ID; a name no readable row has is held empty.
 */
export type ColumnKind =
  | 'id' | 'text' | 'optionalText' | 'enum' | 'date' | 'datetime' | 'email' | 'score' | 'bool' | 'number' | 'amount' | 'ref' | 'refList' | 'actor'
  | 'nameRef';

export interface ColumnDef {
  /** Dotted path into the entity, e.g. 'desk.customerBase'. */
  key: string;
  header: string;
  kind: ColumnKind;
  enumName?: EnumName;
  /**
   * When the cell can't be read, the row is left out (with an issue) even though the value may be empty, because
   * holding it empty would say something the sheet doesn't: an unreadable Closed would read as an open partner.
   */
  leavesRowOut?: true;
  /** For a `nameRef`: the entity whose rows it names. Its tab's rows are matched by their `name`. */
  refersTo?: string;
}

/**
 * How a value on the Market tab sits in its cell: `lines` is one item per line, `optionalText` is null when blank; the
 * other kinds read as the entity columns do.
 */
export type InfoFieldKind = 'text' | 'optionalText' | 'lines' | 'enum' | 'number' | 'datetime' | 'actor';

/** The Market tab fields. The ids come from `_meta`, and "Check again" sits in its own column. */
export type InfoKey = Exclude<keyof MarketInfo, 'marketId' | 'companyId' | 'checkAgain'>;

export interface InfoFieldDef {
  key: InfoKey;
  label: string;
  kind: InfoFieldKind;
  enumName?: EnumName;
  /** A sheet without this row is fine: the app adds it back on the next save of that field. */
  optional?: true;
  /** Labels this row had before. A sheet that still shows one is read as this field, and the label stays. */
  formerLabels?: readonly string[];
}

const H = SHEET_COPY.HEADERS;

export const idColumn: ColumnDef = { key: 'id', header: H.id, kind: 'id' };
export const checkAgainColumn: ColumnDef = { key: 'checkAgain', header: H.checkAgain, kind: 'bool' };
/** Every entity tab ends with these two. */
export const stampColumns: ColumnDef[] = [
  { key: 'updatedAt', header: H.updated, kind: 'datetime' },
  { key: 'updatedBy', header: H.updatedBy, kind: 'actor' },
];

/** One column per C, e.g. 'Desk: Customer base' for 'desk.customerBase'. */
export const fourCColumns = (header: (label: string) => string, path: string, kind: ColumnKind): ColumnDef[] =>
  FOUR_C.map((c) => ({ key: `${path}.${c}`, header: header(FOUR_C_LABELS[c]), kind }));
