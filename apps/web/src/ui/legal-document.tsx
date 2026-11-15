import Link from 'next/link';
import { Fragment } from 'react';
import { inlineLinks } from '@/content/legal/inline-links';
import type { LegalBlock, LegalDoc } from '@/content/legal/types';

/** A heading's anchor: "6.6 Limited Use" → "6-6-limited-use", so /privacy#6-6-limited-use opens at that heading. */
export const anchorOf = (heading: string): string => heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const LINK = 'font-medium text-brand-strong underline underline-offset-2';

function Inline({ source }: { source: string }) {
  return inlineLinks(source).map((part, i) => {
    if ('href' in part) {
      return part.href.startsWith('/')
        ? <Link key={i} href={part.href} className={LINK}>{part.text}</Link>
        : <a key={i} href={part.href} target="_blank" rel="noreferrer" className={LINK}>{part.text}</a>;
    }
    if ('strong' in part) return <strong key={i} className="font-semibold text-ink">{part.text}</strong>;
    if ('code' in part) return <code key={i} className="rounded bg-surface-2 px-1 py-0.5 text-[0.9em] break-all">{part.text}</code>;
    return <Fragment key={i}>{part.text}</Fragment>;
  });
}

function Block({ block }: { block: LegalBlock }) {
  if (typeof block === 'string') return <p className="mt-3 whitespace-pre-line"><Inline source={block} /></p>;
  if ('list' in block) {
    return <ul className="mt-3 list-disc space-y-1.5 pl-5">{block.list.map((item, i) => <li key={i}><Inline source={item} /></li>)}</ul>;
  }
  if ('subheading' in block) {
    return <h3 id={anchorOf(block.subheading)} className="mt-6 scroll-mt-20 font-semibold text-ink">{block.subheading}</h3>;
  }
  return (
    // Wide tables scroll inside this box, never the page (360 px phones).
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
        <thead>
          <tr>{block.table.head.map((cell, i) => <th key={i} scope="col" className="border-b border-line py-2 pr-4 font-semibold text-ink">{cell}</th>)}</tr>
        </thead>
        <tbody>
          {block.table.rows.map((row, r) => (
            <tr key={r} className="align-top">
              {row.map((cell, c) => <td key={c} className="border-b border-line py-2 pr-4"><Inline source={cell} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One page of text: the title as the only h1, sections as h2 with anchors. A legal page has the date it takes effect;
 * the API's errors page (src/app/problems) has none.
 */
export function LegalDocument({ doc }: { doc: Omit<LegalDoc, 'effective'> & { effective?: string } }) {
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-10 leading-relaxed text-ink-2">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">{doc.title}</h1>
      {doc.effective !== undefined && <p className="mt-2 text-sm text-ink-3">{`Effective date: ${doc.effective}`}</p>}
      {doc.intro?.map((block, i) => <Block key={i} block={block} />)}
      {doc.sections.map((section) => {
        const id = anchorOf(section.heading);
        return (
          <section key={id} aria-labelledby={id} className="mt-10">
            <h2 id={id} className="scroll-mt-20 text-xl font-semibold tracking-tight text-ink">{section.heading}</h2>
            {section.blocks.map((block, i) => <Block key={i} block={block} />)}
          </section>
        );
      })}
    </article>
  );
}
