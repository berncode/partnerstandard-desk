// The summary for the partner (reviews spec 5.6), in the place of the business case's shared page
// (src/app/s/[token]/shared-case.tsx) and in the review's present layout (src/reviews/review-present.tsx). One page, both
// sides; it prints on A4 or Letter with the MAP's print button.
import { openSharedSummary, type SummaryView } from '@partner-desk/commands';
import type { IsoDate } from '@partner-desk/core';
import { PARTNER_TYPE_LABELS } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { SharedMessage } from '@/app/s/[token]/shared-frame';
import { SideDot } from '@/maps/badges';
import { formatMapDate, sideName, type SideNames } from '@/maps/format';
import { PrintButton } from '@/maps/present/print-button';
import { CommitmentsTable } from '@/reviews/commitments-table';
import { formatScore, numberLabel, scorePercent } from '@/reviews/review-model';
import { shareDeps } from '@/server/runtime';

/**
 * The summary behind a link: read through `openSharedSummary` at request time, never cached across tokens. The command
 * builds the summary from the review on the server and gives only what the partner may see (`SummaryView`), and it
 * renders here on the server: the page sends nothing else. "Can't be shown right now" when the owner's storage fails;
 * not found (not-found.tsx) when the link doesn't work, whatever the reason. A visit only reads.
 */
export async function SharedSummary({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  await connection();
  const shared = await openSharedSummary(shareDeps(), token);
  if (shared.kind === 'gone') notFound();
  if (shared.kind === 'unavailable') return <SharedMessage>{COPY.SUMMARY_UNAVAILABLE}</SharedMessage>;
  return <SummaryPage view={shared.view} />;
}

/** A date with its year: the summary is a document, read and printed later. */
const dated = (date: IsoDate) => formatMapDate(date, '');

export function SummaryPage({ view }: { view: SummaryView }) {
  const names: SideNames = { ours: view.ourName, partner: view.partnerName };
  const side = (s: 'us' | 'partner' | 'joint' | null) => (s ? sideName(s, names) : '');
  return (
    <article className="mx-auto w-full max-w-3xl text-base leading-relaxed print:max-w-none">
      <div className="mb-4 flex justify-end print:hidden"><PrintButton /></div>
      <header className="border-b border-line pb-5">
        <p className="text-xs font-medium tracking-wider text-ink-3 uppercase">{COPY.SUMMARY_TITLE}</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-balance break-words sm:text-3xl">
          {COPY.SUMMARY_HEADING(view.partnerName || PARTNER_TYPE_LABELS[view.partnerType], view.ourName)}
        </h1>
        <p className="mt-2 text-sm text-ink-2">
          {COPY.REVIEW_HELD_ON(dated(view.heldOn))} · {COPY.REVIEWS_HORIZON(view.horizon)}
        </p>
      </header>

      <Section title={COPY.SUMMARY_DONE}>
        {view.done.length === 0 ? <Empty>{COPY.SUMMARY_NOTHING_DONE}</Empty> : (
          <ul className="space-y-1.5">
            {view.done.map((a, i) => (
              <li key={i} className="flex items-baseline gap-2 break-words">
                <SideDot side={a.side} />
                <span>{a.title} <span className="text-ink-3">· {side(a.side)}</span></span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={COPY.SUMMARY_NOT_DONE}>
        {view.notDone.length === 0 ? <Empty>{COPY.SUMMARY_ALL_DONE}</Empty> : (
          <ul className="space-y-2">
            {view.notDone.map((a, i) => (
              <li key={i} className="flex items-baseline gap-2 break-words">
                <SideDot side={a.side} />
                <span>
                  {a.title} <span className="text-ink-3">· {side(a.side)}</span>
                  {a.reason && <span className="block text-sm text-ink-2">{COPY.SUMMARY_WHY}: {a.reason}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={COPY.REVIEW_COMMITMENTS}>
        {view.commitments.length === 0 ? <Empty>{COPY.REVIEW_NO_COMMITMENTS}</Empty> : (
          // A commitment with no owner leaves the owner empty (walkthrough 2026-11-01): the partner reads no "No owner".
          <CommitmentsTable className="text-sm" lines={view.commitments.map((c, i) => ({
            key: String(i), title: c.title, side: side(c.side), owner: c.owner,
            due: c.dueDate ? dated(c.dueDate) : <span className="text-ink-3">{COPY.MAP_NO_DATE}</span>,
          }))} />
        )}
      </Section>

      <Section title={COPY.REVIEW_BLOCKERS}>
        {view.blockers.length === 0 ? <Empty>{COPY.REVIEW_NO_BLOCKERS}</Empty> : (
          <ul className="space-y-2">
            {view.blockers.map((b, i) => (
              <li key={i} className="break-words">
                <span className="font-medium">{b.title}</span>
                {b.side && <span className="text-ink-3"> · {side(b.side)}</span>}
                {b.note && <span className="block text-sm text-ink-2">{b.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {view.scorecard && (
        <Section title={COPY.REVIEW_SCORECARD}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[22rem] text-left text-sm print:min-w-0">
              <thead className="text-xs tracking-wide text-ink-3 uppercase">
                <tr>
                  <th className="py-1.5 pr-4 font-medium">{COPY.REVIEW_NUMBER}</th>
                  <th className="pr-4 text-right font-medium">{COPY.REVIEW_ACTUAL}</th>
                  <th className="pr-4 text-right font-medium">{COPY.REVIEW_TARGET}</th>
                  <th className="text-right font-medium">{COPY.REVIEW_OF_TARGET}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {view.scorecard.map((n) => {
                  const percent = scorePercent(n.key, n.actual, n.target);
                  return (
                    <tr key={n.key}>
                      <td className="py-2 pr-4">{numberLabel(n.key, view.categoryNumber)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{n.actual === null ? '' : formatScore(n.key, n.actual, view.currency)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{n.target === null ? '' : formatScore(n.key, n.target, view.currency)}</td>
                      <td className="py-2 text-right tabular-nums">{percent === null ? '' : `${percent}%`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Section title={COPY.REVIEW_NEXT_REVIEW}>
        <p className="font-medium">{view.nextReview ? dated(view.nextReview) : COPY.SUMMARY_NO_NEXT_REVIEW}</p>
      </Section>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="mt-8 break-inside-avoid">
      <h2 className="mb-3 text-lg font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: string }) {
  return <p className="text-sm text-ink-3">{children}</p>;
}
