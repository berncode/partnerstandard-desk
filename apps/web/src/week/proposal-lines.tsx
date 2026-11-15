'use client';

// This week's Proposals block (agent proposals spec 10.2), in the dense rows of the other sections: one line per
// waiting proposal with what it does, which partner or market, which agent and when. Accept sits on the line when the
// proposal needs nothing else; Reject always does (it needs nothing else, also for a target that is gone); Show opens
// the page where it sits, next to the record.
import type { WeekProposal } from '@partner-desk/commands';
import { COPY } from '@partner-desk/copy';
import { useId, useState } from 'react';
import { Button, buttonVariants } from '@/ui/button';
import { AppLink } from '@/ui/preview';
import { cardTitle, madeWhen, proposalHref, proposalWhat } from '@/proposals/proposal-model';

const NOTE_MAX = 2000;
const TEXTAREA = 'w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30';

/** How the line ends after an answer: the one line the card shows too. */
export type WeekAnswer = 'accepted' | 'rejected';

function RejectForm({ onReject, onCancel }: { onReject: (note: string) => void; onCancel: () => void }) {
  const [note, setNote] = useState('');
  const id = useId();
  return (
    <form className="grid basis-full gap-2" onSubmit={(e) => { e.preventDefault(); onReject(note.trim()); }}>
      <div className="grid gap-1">
        <label htmlFor={id} className="text-[13px] font-medium">{COPY.PROPOSAL_REJECT_ASK}</label>
        <textarea id={id} rows={2} maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} className={TEXTAREA} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" variant="danger" className="border border-danger/40">{COPY.PROPOSAL_REJECT}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>{COPY.CANCEL}</Button>
      </div>
    </form>
  );
}

/**
 * What a line says under its title, besides who and when: why it can't apply, changed since, or so already. `stale`: a
 * market proposal This week was refused for, as the market changed since (the toast's words stay on the line).
 */
function noteOf(view: WeekProposal, stale: boolean): { text: string; danger: boolean } | null {
  if (view.state === 'cannot') return { text: view.cannot ?? COPY.GONE, danger: true };
  if (stale) return { text: COPY.PROPOSAL_MARKET_CHANGED, danger: false };
  if (view.state === 'changed') return { text: COPY.PROPOSAL_CHANGED_SINCE(COPY.DESK_AGENT), danger: false };
  if (view.state === 'already') return { text: COPY.PROPOSAL_ALREADY, danger: false };
  return null;
}

export function ProposalLines({ proposals, limit, answered, busy, showOnly, readOnly, timeZone, now, onAccept, onReject }: {
  proposals: readonly WeekProposal[];
  limit: number;
  answered: Readonly<Record<string, WeekAnswer>>;
  busy: ReadonlySet<string>;
  /** Market proposals refused as changed since: no Accept for the rest of the visit, Show (and Reject) only. */
  showOnly: ReadonlySet<string>;
  /** Google needs reconnecting: no answers until the person signs in again. */
  readOnly: boolean;
  timeZone: string;
  now: string;
  onAccept: (view: WeekProposal) => void;
  onReject: (view: WeekProposal, note: string) => void;
}) {
  const [rejecting, setRejecting] = useState<string | null>(null);
  return (
    <ul className="divide-y divide-line">
      {proposals.slice(0, limit).map((view) => {
        const done = answered[view.head.id];
        const stale = showOnly.has(view.head.id);
        const note = done ? null : noteOf(view, stale);
        const canAnswer = !done && !readOnly;
        const canAccept = canAnswer && view.oneClick && !stale;
        const working = busy.has(view.head.id);
        return (
          <li key={view.head.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-2">
            <div className="min-w-0 flex-1 basis-56">
              <p className="font-medium break-words">
                {proposalWhat(view)}
                {view.head.kind !== 'partners' && view.about && <span className="font-normal text-ink-2"> · {view.about}</span>}
              </p>
              <p className="text-sm text-ink-3">{cardTitle(view.head)} · {madeWhen(view.head.createdAt, now, timeZone)}</p>
              {done && <p className="text-sm font-medium text-ink-2">{done === 'accepted' ? COPY.PROPOSAL_ACCEPTED : COPY.PROPOSAL_REJECTED}</p>}
              {note && <p className={note.danger ? 'text-sm text-danger' : 'text-sm text-warn'}>{note.text}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              {canAnswer && rejecting !== view.head.id && (
                <>
                  {canAccept && <Button size="sm" variant="primary" disabled={working} onClick={() => onAccept(view)}>{COPY.PROPOSAL_ACCEPT}</Button>}
                  <Button size="sm" variant="ghost" disabled={working} onClick={() => setRejecting(view.head.id)}>{COPY.PROPOSAL_REJECT}</Button>
                </>
              )}
              <AppLink href={proposalHref(view, view.partnerType)} className={buttonVariants({ size: 'sm' })}>{COPY.PROPOSAL_SHOW}</AppLink>
            </div>
            {canAnswer && rejecting === view.head.id && (
              <RejectForm onCancel={() => setRejecting(null)} onReject={(text) => { setRejecting(null); onReject(view, text); }} />
            )}
          </li>
        );
      })}
    </ul>
  );
}
