/** Spreadsheet column letters: 0 → A, 25 → Z, 26 → AA. */
export function columnLetter(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Tab names are always quoted; an apostrophe inside is doubled (A1 convention). */
export const quoteTab = (title: string) => `'${title.replaceAll("'", "''")}'`;
export const tabRange = (title: string) => quoteTab(title);
export const cellRange = (title: string, row: number, col: number) => `${quoteTab(title)}!${columnLetter(col)}${row}`;
export const rowRange = (title: string, row: number, fromCol: number, toCol: number) =>
  `${quoteTab(title)}!${columnLetter(fromCol)}${row}:${columnLetter(toCol)}${row}`;
