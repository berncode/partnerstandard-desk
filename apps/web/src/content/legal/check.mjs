// The shape of a legal page as data (types.ts), checked where it comes in: when the app loads a page, and when the hosted
// build fetches the operator's own pages (scripts/legal-pages.mjs). Plain JavaScript, so that build step can use it too.

export const LEGAL_PAGES = ['privacy', 'terms', 'imprint'];

const isText = (value) => typeof value === 'string';

/** A link in the text (`[text](href)`) may go to an https page, an email address, a place on the page, or a page of the app. */
const SAFE_HREF = /^(?:https:\/\/|mailto:|#|\/(?!\/))/;
function checkLinks(text, where) {
  for (const [, href] of text.matchAll(/\]\(([^)\s]*)\)/g)) {
    if (!SAFE_HREF.test(href)) throw new Error(`${where}: a link that is not https, mailto, # or a page of the app: ${href}`);
  }
}

function checkBlock(block, where) {
  if (isText(block)) return checkLinks(block, where);
  if (block && typeof block === 'object') {
    if (Array.isArray(block.list) && block.list.every(isText)) return block.list.forEach((item) => checkLinks(item, where));
    if (isText(block.subheading)) return;
    const table = block.table;
    if (table && Array.isArray(table.head) && table.head.every(isText) && Array.isArray(table.rows) && table.rows.every((r) => Array.isArray(r) && r.every(isText))) {
      return table.rows.flat().forEach((cell) => checkLinks(cell, where));
    }
  }
  throw new Error(`${where}: a block is not text, a list, a subheading or a table`);
}

/** The page as a legal page, or an error that says what is wrong with it. */
export function checkLegalDoc(data, name) {
  if (!data || typeof data !== 'object') throw new Error(`${name}: not a legal page`);
  if (!isText(data.title) || data.title.trim() === '') throw new Error(`${name}: no title`);
  if (!isText(data.effective) || !/^\d{4}-\d{2}-\d{2}$/.test(data.effective)) throw new Error(`${name}: no effective date as YYYY-MM-DD`);
  if (data.standIn !== undefined && typeof data.standIn !== 'boolean') throw new Error(`${name}: standIn is true or false`);
  if (data.intro !== undefined) {
    if (!Array.isArray(data.intro)) throw new Error(`${name}: the intro is not a list of blocks`);
    data.intro.forEach((block) => checkBlock(block, `${name}, intro`));
  }
  if (!Array.isArray(data.sections) || data.sections.length === 0) throw new Error(`${name}: no sections`);
  data.sections.forEach((section, i) => {
    if (!section || !isText(section.heading) || !Array.isArray(section.blocks)) throw new Error(`${name}: section ${i + 1} has no heading or blocks`);
    section.blocks.forEach((block) => checkBlock(block, `${name}, ${section.heading}`));
  });
  return data;
}
