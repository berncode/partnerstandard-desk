// The legal pages' general checks (plan 19, task 3). They run on the texts that are there: the neutral stand-ins in the
// public code, the operator's own on a hosted build. The checks of the hosted texts' own content live with them in the
// private repository.
import { describe, expect, it } from 'vitest';
import { checkLegalDoc, LEGAL_PAGES } from './check.mjs';
import { IMPRINT } from './imprint';
import { PRIVACY } from './privacy';
import { TERMS } from './terms';
import type { LegalDoc } from './types';

/** Every string in a document, headings and table cells included. */
function textOf(doc: LegalDoc): string {
  const parts: string[] = [doc.title, ...(doc.intro ?? []).map(blockText)];
  for (const section of doc.sections) parts.push(section.heading, ...section.blocks.map(blockText));
  return parts.join('\n');
}
function blockText(block: LegalDoc['sections'][number]['blocks'][number]): string {
  if (typeof block === 'string') return block;
  if ('list' in block) return block.list.join('\n');
  if ('subheading' in block) return block.subheading;
  return [...block.table.head, ...block.table.rows.flat()].join('\n');
}

const DOCS = { privacy: PRIVACY, terms: TERMS, imprint: IMPRINT };

describe.each(Object.entries(DOCS))('the %s page', (_name, doc) => {
  it('is PartnerStandard Desk’s, with no Notion, no candidates and no em dashes', () => {
    const text = textOf(doc);
    expect(text).toContain('PartnerStandard Desk');
    expect(text).not.toMatch(/notion|recruitment tool|recruit\.partnerstandard|candidate/i);
    expect(text).not.toContain('—');
  });

  it('numbers its sections one after another', () => {
    const numbered = doc.sections.map((s) => Number(/^(\d+)\./.exec(s.heading)?.[1]));
    if (doc === IMPRINT || numbered.some(Number.isNaN)) return;
    expect(numbered).toEqual(numbered.map((_, i) => i + 1));
  });

  it('points each “section N” at a section that exists', () => {
    for (const match of textOf(doc).matchAll(/section (\d+)/gi)) expect(Number(match[1])).toBeLessThanOrEqual(doc.sections.length);
  });
});

describe('checkLegalDoc', () => {
  const good = { title: 'Terms', effective: '2026-11-10', sections: [{ heading: '1. One', blocks: ['Text.', { list: ['a'] }, { subheading: 'S' }, { table: { head: ['A'], rows: [['1']] } }] }] };

  it('takes a page in the right shape, and names each page it knows', () => {
    expect(checkLegalDoc(good, 'terms')).toBe(good);
    expect(LEGAL_PAGES).toEqual(['privacy', 'terms', 'imprint']);
  });

  it('takes only safe links: https, mailto, a place on the page, or a page of the app', () => {
    const withLink = (href: string) => ({ ...good, sections: [{ heading: '1. One', blocks: [`See [this](${href}).`] }] });
    for (const href of ['https://desk.partnerstandard.com', 'mailto:someone@example.com', '#section-2', '/privacy']) expect(() => checkLegalDoc(withLink(href), 'terms')).not.toThrow();
    for (const href of ['javascript:alert(1)', 'data:text/html,x', 'http://plain.example', '//evil.example']) expect(() => checkLegalDoc(withLink(href), 'terms')).toThrow('a link that is not https');
  });

  it('marks the public code’s pages as stand-ins', () => {
    expect([PRIVACY, TERMS, IMPRINT].every((doc) => doc.standIn === true)).toBe(true);
  });

  it('says what is wrong with a page that is not', () => {
    expect(() => checkLegalDoc(null, 'terms')).toThrow('terms: not a legal page');
    expect(() => checkLegalDoc({ ...good, title: '' }, 'terms')).toThrow('terms: no title');
    expect(() => checkLegalDoc({ ...good, effective: '10 Nov 2026' }, 'terms')).toThrow('terms: no effective date as YYYY-MM-DD');
    expect(() => checkLegalDoc({ ...good, sections: [] }, 'terms')).toThrow('terms: no sections');
    expect(() => checkLegalDoc({ ...good, sections: [{ heading: '1. One', blocks: [42] }] }, 'terms')).toThrow('terms, 1. One: a block is not text');
  });
});
