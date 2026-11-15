/**
 * A legal page as data, adapted from the MAP's legal pages.
 * Strings hold inline markup that `inlineLinks()` parses: `**bold**`, `` `code` `` and `[text](href)`.
 * A paragraph's `\n` is a line break (the Imprint's address).
 */
export type LegalBlock =
  | string
  | { list: string[] }
  | { subheading: string }
  | { table: { head: string[]; rows: string[][] } };

export interface LegalSection { heading: string; blocks: LegalBlock[] }

export interface LegalDoc {
  title: string;
  /** As the appendix gives it: YYYY-MM-DD. */
  effective: string;
  intro?: LegalBlock[];
  sections: LegalSection[];
  /** True on the public code's stand-ins: a hosted build refuses a page that has it. */
  standIn?: boolean;
}
