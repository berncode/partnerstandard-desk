'use client';

// Mark signed with the date, and the MAP advice first when the MAP isn't agreed. The advice never blocks. The program
// the partner joins (spec 4.2): the one it is in already, else proposed from the market it came from. When the partner
// type has a MAP (spec 5.3, ruling R4): the MAP app's "move the dates" box.
import { daysBetween, isValidIsoDate, signNudge, type IsoDate } from '@partner-desk/core';
import { COPY, LEVEL_LABELS } from '@partner-desk/copy';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/ui/button';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { controlClass } from '@/ui/control';
import { Dialog, DialogContent } from '@/ui/dialog';
import { AdviceBox } from '@/ui/pieces';
import { useMapArea } from './map-area';
import { usePartner } from './partner-context';
import { coversType, joinableFor, proposedProgram } from './program-model';

/** An agent's proposal to mark the partner type signed (agent proposals spec 10.3): the dialog opens on its date. */
export interface SignProposal { proposalId: string; values: { signedDate: IsoDate } }

/**
 * Mark signed. With `proposal`, the dialog opens on the proposed date and asks its own questions (the MAP's dates, the
 * program); Mark signed accepts the proposal with what the dialog holds.
 */
export function SignDialog({ open, onOpenChange, proposal }: { open: boolean; onOpenChange: (open: boolean) => void; proposal?: SignProposal }) {
  const { account } = usePartner();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent title={COPY.SIGN_TITLE(account.company)} description={COPY.SIGN_TEXT}>
          <SignForm onDone={() => onOpenChange(false)} {...(proposal ? { agentProposal: proposal } : {})} />
        </DialogContent>
      )}
    </Dialog>
  );
}

/** `agentProposal`: an agent's proposal of this signing, accepted by Mark signed. */
function SignForm({ onDone, agentProposal }: { onDone: () => void; agentProposal?: SignProposal }) {
  const { account, partner, book, dispatch, programs, programsListed, levelsOf, markets, marketStates, today, proposals } = usePartner();
  // The programs it may join, less any the page knows is gone (a file trashed by hand).
  const offered = joinableFor(programs, partner.partnerType, levelsOf);
  // A partner in a program keeps it: nothing is proposed. Otherwise the proposal is worked out once, when the dialog
  // opens, so the person's own choice is not replaced while the markets load.
  const [proposal] = useState(() => (partner.programId === null ? proposedProgram(book, partner, marketStates, offered, markets) : null));
  const current = partner.programId ?? '';
  const [programId, setProgramId] = useState(current || proposal?.programId || '');
  /** Another program picked for a partner at Preferred, waiting for a "yes". */
  const [leaving, setLeaving] = useState<string | null>(null);
  const [date, setDate] = useState<string>(agentProposal?.values.signedDate ?? today);
  const [nudge, setNudge] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dateId = useId();
  const errorId = useId();
  const programFieldId = useId();
  const programHintId = useId();
  const known = offered.some((p) => p.programId === current);
  // The MAP's open dates move by the days between its planned start and the signing, when the person keeps the box.
  const mapArea = useMapArea();
  const mapState = mapArea?.map.status === 'ready' ? mapArea.map.state : null;
  const plannedStart = mapState && mapState.kind !== 'none' && mapArea?.signMovingDates ? mapState.plannedStart : null;
  const shift = plannedStart && isValidIsoDate(date) ? daysBetween(plannedStart, date) : 0;
  const [moveDates, setMoveDates] = useState(true);
  const moveId = useId();
  const levels = current ? levelsOf(current) : null;
  const prefName = levels?.status === 'ready' ? levels.pref : LEVEL_LABELS.pref;

  const sign = () => {
    setNudge(null);
    const change = { kind: 'markSigned', partnerId: partner.id, signedDate: date } as const;
    const moving = shift !== 0 && moveDates && mapArea?.signMovingDates ? mapArea.signMovingDates : null;
    const view = agentProposal ? proposals?.views.find((v) => v.head.id === agentProposal.proposalId) : undefined;
    if (agentProposal && (!view || !proposals)) return setError(COPY.GONE);
    const outcome = view && proposals ? proposals.accept(view, { signedDate: date, ...(moving ? { shiftMapDates: true } : {}) })
      : moving ? moving(change) : dispatch(change);
    if (!outcome.ok) return setError(outcome.fieldErrors?.signedDate ?? outcome.message);
    // Only a new choice is saved: the program the partner is in keeps its level. A second change: a refused
    // program (gone since, another type) leaves the signing as it is, and says why.
    if (programId !== current) {
      const joined = dispatch({
        kind: 'update', entity: 'partner', id: partner.id, patch: { programId: programId || null, level: programId ? 'reg' : null },
      });
      if (!joined.ok) toast.error(joined.message);
    }
    toast(COPY.MARKED_SIGNED);
    onDone();
  };
  const markSigned = () => {
    const advice = signNudge(partner);
    if (advice) setNudge(advice);
    else sign();
  };
  const pick = (next: string) => {
    setNudge(null);
    // Leaving a program from Preferred starts again at the starting level elsewhere: asked first, as on the tab.
    if (partner.level === 'pref' && current && programId === current && next !== current) setLeaving(next);
    else setProgramId(next);
  };

  return (
    <form aria-label={COPY.MARK_SIGNED} className="mt-4 grid gap-4" onSubmit={(e) => { e.preventDefault(); markSigned(); }}>
      <div className="grid gap-1">
        <label htmlFor={dateId} className="text-sm font-medium">{COPY.FIELD_DATE_SIGNED}</label>
        <input id={dateId} type="date" value={date} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
          onChange={(e) => { setDate(e.target.value); setError(null); setNudge(null); }} className={`${controlClass} w-auto`} />
        {error && <p id={errorId} className="text-xs text-danger">{error}</p>}
      </div>
      {(coversType(partner.partnerType) || current) && (
        <div className="grid gap-1">
          <label htmlFor={programFieldId} className="text-sm font-medium">{COPY.FIELD_PROGRAM}</label>
          <select id={programFieldId} value={programId} aria-describedby={programHintId} className={`${controlClass} px-2`}
            onChange={(e) => pick(e.target.value)}>
            <option value="">{COPY.NO_PROGRAM}</option>
            {offered.map((p) => <option key={p.programId} value={p.programId}>{p.title}</option>)}
            {current && !known && <option value={current}>{programsListed ? COPY.PROGRAM_GONE : current}</option>}
          </select>
          <div id={programHintId} className="text-xs text-ink-3">
            {proposal && programId === proposal.programId && <p>{COPY.SIGN_PROGRAM_FROM(proposal.market)}</p>}
            {programId && programId !== current && <p>{COPY.SIGN_PROGRAM_HINT}</p>}
          </div>
        </div>
      )}
      {shift !== 0 && (
        <label htmlFor={moveId} className="flex items-start gap-2 text-sm">
          <input id={moveId} type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-brand-strong" checked={moveDates}
            onChange={(e) => { setMoveDates(e.target.checked); setNudge(null); }} />
          <span>{COPY.SIGN_MOVE_MAP_DATES(shift)}</span>
        </label>
      )}
      {nudge && <AdviceBox text={nudge} onGoAhead={sign} onCancel={() => setNudge(null)} />}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>{COPY.CANCEL}</Button>
        <Button type="submit" variant="primary" disabled={nudge !== null}>{COPY.MARK_SIGNED}</Button>
      </div>
      {leaving !== null && (
        <ConfirmDialog open onOpenChange={(open) => { if (!open) setLeaving(null); }}
          title={COPY.PROGRAM_CHANGE_TITLE(account.company)}
          text={leaving ? COPY.PROGRAM_CHANGE_TEXT(prefName) : COPY.PROGRAM_LEAVE_TEXT(prefName)} action={COPY.PROGRAM_CHANGE_ACTION}
          onConfirm={() => { setProgramId(leaving); setLeaving(null); }} />
      )}
    </form>
  );
}
