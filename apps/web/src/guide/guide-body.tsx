import { COPY, GUIDE_WIDE_DIAGRAMS, type GuideDiagramId, type GuidePart, type GuideQuestion, type GuideSection } from '@partner-desk/copy';
import Link from 'next/link';
import { Fragment } from 'react';
import { Diagram } from '@/guide/diagrams';
import { GuideText } from '@/guide/guide-text';

const LABEL = 'text-xs font-semibold tracking-wider text-ink-3 uppercase';
const LINK = 'font-medium text-brand-strong underline underline-offset-2';

/** The guide's sections and questions, as the page shows them: hosted's, or a company server's (plan 13, task 13). */
export function GuideBody({ guide }: { guide: { sections: GuideSection[]; questions: GuideQuestion[] } }) {
  return guide.sections.map((section) => <Section key={section.id} section={section} questions={guide.questions} />);
}

function Section({ section, questions }: { section: GuideSection; questions: GuideQuestion[] }) {
  const { id, title, why, hub, where, steps, appDoes, diagram, parts } = section;
  return (
    <section className="break-inside-avoid-page border-t border-line py-6 first:border-t-0 first:pt-0 print:py-4">
      <h2 id={id} className="scroll-mt-20 text-lg font-semibold tracking-tight">{title}</h2>
      <p className="mt-2 max-w-3xl text-ink-2"><GuideText text={why} /></p>
      {hub && (
        <p className="mt-2 text-sm">
          <a href={hub} target="_blank" rel="noreferrer" className={LINK}>{COPY.GUIDE_HUB}</a>
        </p>
      )}
      {where.length > 0 && (
        <div className="mt-4">
          <p className={LABEL}>{COPY.GUIDE_WHERE}</p>
          <ul className="mt-1 space-y-1">
            {where.map((place, i) => (
              <li key={i} className="text-sm text-ink-2">
                {place.trail.map((part, j) => (
                  <Fragment key={j}>
                    {j > 0 && <span aria-hidden className="px-1.5 text-ink-3">›</span>}
                    {j === 0 ? <Link href={place.page} className={LINK}>{part}</Link> : <GuideText text={part} />}
                  </Fragment>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}
      {parts && <div className="mt-6 space-y-7">{parts.map((part) => <Part key={part.heading} part={part} />)}</div>}
      {steps.length > 0 && (
        <div className="mt-4">
          <p className={LABEL}>{COPY.GUIDE_STEPS}</p>
          <ol className="mt-1 list-decimal space-y-1.5 pl-5 text-ink-2 marker:text-ink-3">
            {steps.map((step, i) => <li key={i}><GuideText text={step} /></li>)}
          </ol>
        </div>
      )}
      {appDoes.length > 0 && (
        <div className="mt-4">
          <p className={LABEL}>{COPY.GUIDE_APP_DOES}</p>
          <ul className="mt-1 list-disc space-y-1.5 pl-5 text-ink-2 marker:text-ink-3">
            {appDoes.map((item, i) => <li key={i}><GuideText text={item} /></li>)}
          </ul>
        </div>
      )}
      {id === 'questions' && (
        <div className="mt-4 divide-y divide-line">
          {questions.map(({ question, answer }) => (
            <div key={question} className="py-3 first:pt-0">
              <h3 className="font-semibold text-ink">{question}</h3>
              <p className="mt-1 max-w-3xl text-ink-2"><GuideText text={answer} /></p>
            </div>
          ))}
        </div>
      )}
      {diagram && <Picture id={diagram} />}
    </section>
  );
}

/** A picture: a small one in its column; a wide one in its own frame, which scrolls sideways on a narrow screen. */
function Picture({ id }: { id: GuideDiagramId }) {
  if (!GUIDE_WIDE_DIAGRAMS.includes(id)) return <div className="mt-5 max-w-md"><Diagram id={id} /></div>;
  return (
    <div className="mt-4">
      <div data-testid="picture-frame" className="overflow-x-auto rounded-lg border border-line bg-surface p-3 print:overflow-visible print:border-0 print:p-0">
        <Diagram id={id} />
      </div>
      <p className="mt-1 text-xs text-ink-3 xl:hidden print:hidden">{COPY.GUIDE_SCROLL_HINT_PICTURE}</p>
    </div>
  );
}

/** One part of a section told in parts (Agents and the API): its heading, lines, cards of steps, table and picture. */
function Part({ part }: { part: GuidePart }) {
  const { heading, lines = [], groups = [], table, diagram } = part;
  return (
    <div className="break-inside-avoid-page">
      <h3 className="font-semibold tracking-tight text-ink">{heading}</h3>
      {lines.map((line, i) => <p key={i} className="mt-2 max-w-3xl text-ink-2"><GuideText text={line} /></p>)}
      {groups.length > 0 && (
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {groups.map((group) => (
            <div key={group.title} className="rounded-lg border border-line bg-surface p-4">
              <p className="font-medium text-ink"><GuideText text={group.title} /></p>
              <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-ink-2 marker:text-ink-3">
                {group.steps.map((step, i) => <li key={i}><GuideText text={step} /></li>)}
              </ol>
              {group.note && <p className="mt-2 text-sm text-ink-3"><GuideText text={group.note} /></p>}
            </div>
          ))}
        </div>
      )}
      {table && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>{table.head.map((cell) => <th key={cell} scope="col" className="px-3 py-2 text-xs font-semibold text-ink-3">{cell}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line border-t border-line">
              {table.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (j === 0
                    ? <th key={j} scope="row" className="px-3 py-2 align-top font-medium text-ink"><GuideText text={cell} /></th>
                    : <td key={j} className="px-3 py-2 align-top text-ink-2"><GuideText text={cell} /></td>))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {diagram && <Picture id={diagram} />}
    </div>
  );
}
