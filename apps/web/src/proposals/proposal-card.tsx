'use client';

// An agent's proposal (agent proposals spec 10.1), built from Recruitment's pieces (the FieldRow rows, Button
// size="sm", the advice box's look): who proposes and when, one row per value with its value now and the proposed one,
// the agent's reason, and Accept, Accept some and Reject. Answered or expired, it is one line.
import type { ProposalView } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from 'react';
import { Button } from '@/ui/button';
import { cn } from '@/ui/cn';
import { DisabledReason, FIELD_ROWS, FieldRow } from '@/ui/pieces';
import { DEFAULT_TIME_ZONE } from '@/ui/dates';
import { cardTitle, expiresOn, madeWhen } from './proposal-model';

const NOTE_MAX = 2000;
const TEXTAREA = 'w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30';

/** "Accept some" on a 4C card: the rows ticked, and the person's "Why not?" for the others. */
export interface AcceptSomePick { itemIds: string[]; note: string }

/** What an answer's handler may say at once: refused (the page says why), done or nothing yet (a dialog asks first). */
type Answered = { ok: boolean } | void;

/** The person's note, as a "Why not? (optional)" field. */
function NoteField({ value, onChange, fieldRef }: { value: string; onChange: (note: string) => void; fieldRef?: Ref<HTMLTextAreaElement> }) {
  const id = useId();
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-[13px] font-medium">{COPY.PROPOSAL_REJECT_ASK}</label>
      <textarea ref={fieldRef} id={id} rows={2} maxLength={NOTE_MAX} value={value} onChange={(e) => onChange(e.target.value)} className={TEXTAREA} />
    </div>
  );
}

/** A row's value now beside the proposed one, labels beside their values. */
function Values({ now, proposed }: { now: string; proposed: string }) {
  return (
    <dl className="flex flex-wrap gap-x-4 gap-y-0.5">
      <div className="flex min-w-0 gap-1.5">
        <dt className="text-ink-3">{COPY.PROPOSAL_NOW}</dt>
        <dd className="min-w-0 break-words">{now || COPY.PROPOSAL_NOW_EMPTY}</dd>
      </div>
      <div className="flex min-w-0 gap-1.5">
        <dt className="text-ink-3">{COPY.PROPOSAL_PROPOSED}</dt>
        <dd className="min-w-0 font-semibold break-words">{proposed}</dd>
      </div>
    </dl>
  );
}

/**
 * One proposal. `onAccept`: the page accepts it (a step with the stepper's advice, close and signed open their prompt
 * or dialog first). `onAcceptSome`: a 4C card ticks its letters here and sends them with the note; another kind (new
 * partners) hands it to the page. `onReject` gets the person's note, trimmed. Read-only (Google needs reconnecting): no
 * buttons. Dates are the owner's (`timeZone`, Settings), counted from `now`, the time the page was read. `asking`: the
 * page asks first for this card (its dialog or the stepper's advice is open).
 */
export function ProposalCard({
  view, onAccept, onAcceptSome, onReject, timeZone = DEFAULT_TIME_ZONE, now, readOnly = false, body, acceptLabel = COPY.PROPOSAL_ACCEPT,
  asking = false,
}: {
  view: ProposalView;
  onAccept: () => Answered;
  onAcceptSome?: (pick?: AcceptSomePick) => Answered;
  onReject: (note: string) => Answered;
  timeZone?: string;
  now?: string;
  readOnly?: boolean;
  /** What the card shows in place of its rows (new partners: how many companies, for which market). */
  body?: ReactNode;
  /** The accept button's words ("Review the companies" opens the import preview). */
  acceptLabel?: string;
  asking?: boolean;
}) {
  const headingId = useId();
  const tickHintId = useId();
  const [mode, setMode] = useState<'idle' | 'reject' | 'some'>('idle');
  const [note, setNote] = useState('');
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set(view.rows.map((r) => r.itemId)));
  const title = cardTitle(view.head);
  /**
   * Keyboard focus stays where the person is (as Log a call and Add person do): opening Reject or Accept some puts it
   * in the field or on the first letter, Cancel puts it back on the button that opened the form, and an answer from
   * this card puts it on the card's one line, since the button pressed goes with the buttons.
   */
  const focusNext = useRef<'note' | 'letter' | 'reject' | 'some' | null>(null);
  const answeredHere = useRef(false);
  const takeFocus = (which: NonNullable<typeof focusNext.current>) => (el: HTMLElement | null) => {
    if (el && focusNext.current === which) {
      focusNext.current = null;
      el.focus();
    }
  };
  const answering = <A extends unknown[]>(act: (...args: A) => Answered) => (...args: A) => {
    answeredHere.current = true;
    // Refused at once (the page says why): nothing was answered here.
    if (act(...args)?.ok === false) answeredHere.current = false;
  };
  const ended = view.state === 'answered' || view.state === 'expired';
  // The page asked first and the person cancelled (the dialog, the advice): nothing was answered here either. Confirmed,
  // the card is answered in the same render, and its one line took the focus already.
  useEffect(() => {
    if (!asking && !ended) answeredHere.current = false;
  }, [asking, ended]);

  if (ended) {
    return (
      <section aria-label={title} tabIndex={-1} className="rounded-lg border border-line bg-surface-2/40 px-3 py-2 outline-none"
        ref={(el) => {
          if (el && answeredHere.current) {
            answeredHere.current = false;
            el.focus();
          }
        }}>
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="text-ink-3">{title}</span>
          <span className="min-w-0 font-medium text-ink-2">{view.answeredLine}</span>
        </p>
      </section>
    );
  }

  const ticking = mode === 'some';
  const canAccept = view.state !== 'cannot';
  const fourC = view.head.kind === 'fourC';
  const offersSome = canAccept && onAcceptSome !== undefined && (!fourC || view.rows.length > 1);
  const notice = view.state === 'changed' ? COPY.PROPOSAL_CHANGED_SINCE(COPY.DESK_AGENT)
    : view.state === 'cannot' ? view.cannot ?? COPY.GONE
      : view.state === 'already' ? COPY.PROPOSAL_ALREADY : null;
  const open = (next: 'reject' | 'some') => {
    focusNext.current = next === 'reject' ? 'note' : 'letter';
    setMode(next);
  };
  const back = () => {
    focusNext.current = mode === 'some' ? 'some' : 'reject';
    setMode('idle');
    setNote('');
    setTicked(new Set(view.rows.map((r) => r.itemId)));
  };
  const tick = (itemId: string, on: boolean) => setTicked((current) => {
    const next = new Set(current);
    if (on) next.add(itemId);
    else next.delete(itemId);
    return next;
  });
  const acceptSome = () => {
    if (fourC) open('some');
    else answering(() => onAcceptSome?.())();
  };

  let actions: ReactNode = null;
  if (readOnly) {
    actions = null;
  } else if (mode === 'reject') {
    actions = (
      <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); answering(onReject)(note.trim()); }}>
        <NoteField value={note} onChange={setNote} fieldRef={takeFocus('note')} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" variant="danger" className="border border-danger/40">{COPY.PROPOSAL_REJECT}</Button>
          <Button size="sm" variant="ghost" onClick={back}>{COPY.CANCEL}</Button>
        </div>
      </form>
    );
  } else if (ticking) {
    const none = ticked.size === 0;
    actions = (
      <form className="grid gap-2" onSubmit={(e) => {
        e.preventDefault();
        if (!none) answering(() => onAcceptSome?.({ itemIds: view.rows.filter((r) => ticked.has(r.itemId)).map((r) => r.itemId), note: note.trim() }))();
      }}>
        {ticked.size < view.rows.length && <NoteField value={note} onChange={setNote} />}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" variant="primary" disabled={none} aria-describedby={none ? tickHintId : undefined}>{COPY.PROPOSAL_ACCEPT}</Button>
          <Button size="sm" variant="ghost" onClick={back}>{COPY.CANCEL}</Button>
        </div>
        {none && <DisabledReason id={tickHintId}>{COPY.PROPOSAL_TICK_ONE}</DisabledReason>}
      </form>
    );
  } else {
    actions = (
      <div className="flex flex-wrap gap-2">
        {canAccept && <Button size="sm" variant="primary" onClick={() => answering(onAccept)()}>{acceptLabel}</Button>}
        {offersSome && <Button size="sm" ref={takeFocus('some')} onClick={acceptSome}>{COPY.PROPOSAL_ACCEPT_SOME}</Button>}
        <Button size="sm" variant="ghost" ref={takeFocus('reject')} onClick={() => open('reject')}>{COPY.PROPOSAL_REJECT}</Button>
      </div>
    );
  }

  return (
    <section aria-labelledby={headingId} className="grid min-w-0 gap-2 rounded-lg border border-brand/30 bg-brand-soft/30 p-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h3 id={headingId} className="text-sm font-semibold">{title}</h3>
        <span className="text-xs text-ink-3">{madeWhen(view.head.createdAt, now ?? new Date().toISOString(), timeZone)}</span>
        <span className="text-xs text-ink-3 sm:ml-auto">{expiresOn(view.head.expiresAt, timeZone)}</span>
      </div>
      {notice && <p className={cn('text-[13px]', view.state === 'cannot' ? 'text-danger' : 'text-warn')}>{notice}</p>}
      {ticking && <p className="text-[13px] text-ink-3">{COPY.PROPOSAL_TICK_HINT}</p>}
      {body ?? <ul className={FIELD_ROWS}>
        {view.rows.map((row, i) => (
          <li key={row.itemId} className="grid min-w-0 gap-1 py-2 first:pt-0 last:pb-0 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
            {ticking ? (
              <label className="flex items-start gap-2 text-[13px]">
                <input type="checkbox" ref={i === 0 ? takeFocus('letter') : undefined} className="mt-0.5 h-4 w-4 shrink-0 accent-brand-strong" checked={ticked.has(row.itemId)}
                  onChange={(e) => tick(row.itemId, e.target.checked)} />
                <span>{row.what}</span>
              </label>
            ) : (
              <p className="text-[13px] text-ink-3">{row.what}</p>
            )}
            <div className="min-w-0">
              <Values now={row.now} proposed={row.proposed} />
              {row.evidence && <p className="mt-0.5 break-words whitespace-pre-wrap text-ink-2">{row.evidence}</p>}
            </div>
          </li>
        ))}
      </ul>}
      {view.reason && (
        <div className="border-t border-line pt-2">
          <FieldRow label={COPY.PROPOSAL_WHY}><p className="break-words whitespace-pre-wrap">{view.reason}</p></FieldRow>
        </div>
      )}
      {actions}
    </section>
  );
}
