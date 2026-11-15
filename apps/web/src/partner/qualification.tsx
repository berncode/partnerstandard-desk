'use client';

// Proceed to MAP is a step, and a disabled button says why in words under it. Proceed to MAP then offers to start the MAP (spec 5.2).
import { activeSellerCount, confirmedRecommendation, stepNudge, type ClosedAs } from '@partner-desk/core';
import { STEP_LABELS, TIPS } from '@partner-desk/method';
import { CLOSED_LABELS, COPY } from '@partner-desk/copy';
import { useId, useState } from 'react';
import { Button } from '@/ui/button';
import { InlineText } from '@/ui/inline-text';
import { AdviceBox, DisabledReason, Section } from '@/ui/pieces';
import { Caso } from './caso';
import { CloseDialog } from './close-dialog';
import { EMPTY_NOTES, FourCCheck, useQualification } from './desk-check';
import { useAct, usePartner } from './partner-context';
import { useMapArea } from './map-area';
import { hypothesisHolds, proceedProblem } from './partner-model';

/** The recruitment questions. Question 3 is counted from People, not written. */
const QUESTIONS = {
  q1Overlap: COPY.Q1_OVERLAP,
  q2DealFit: COPY.Q2_DEAL_FIT,
  q4MapAgreed: COPY.Q4_MAP_AGREED,
} as const;

type TextQuestion = keyof typeof QUESTIONS;

function Questions() {
  const { account, book, readOnly } = usePartner();
  const { qualification, edit } = useQualification();
  const text = (key: TextQuestion) => (
    <li className="grid gap-1">
      <p className="text-xs font-medium text-ink-3">{QUESTIONS[key]}</p>
      <InlineText value={qualification?.[key] ?? ''} label={QUESTIONS[key]} field={key} disabled={readOnly} multiline
        placeholder={COPY.CLICK_TO_WRITE} className="text-sm" onCommit={(value) => edit({ [key]: value })} />
    </li>
  );
  return (
    <div className="grid gap-2">
      <p className="text-sm font-semibold">{COPY.QUESTIONS_TITLE} <span className="font-normal text-ink-3">{COPY.OPTIONAL}</span></p>
      <ol className="grid gap-3">
        {text('q1Overlap')}
        {text('q2DealFit')}
        <li className="grid gap-1">
          <p className="text-xs font-medium text-ink-3">{COPY.Q3_SELLERS}</p>
          <p className="text-sm">
            {COPY.ACTIVE_SELLERS(activeSellerCount(book, account.id))}
            <span className="text-ink-3">{COPY.COUNTED_FROM_PEOPLE}</span>
          </p>
        </li>
        {text('q4MapAgreed')}
      </ol>
    </div>
  );
}

/** *Proceed to MAP*, *Not now* and *No*. The advice never blocks; a button that can't be used says why. */
function Decision() {
  const { account, partner, book, marketStates } = usePartner();
  const act = useAct();
  const [nudge, setNudge] = useState<string | null>(null);
  // The advice is about the step the partner was at: it goes once the step or the closing changes.
  const where = `${partner.step}|${partner.closed}`;
  const [adviceFor, setAdviceFor] = useState(where);
  if (adviceFor !== where) {
    setAdviceFor(where);
    setNudge(null);
  }
  const [closing, setClosing] = useState<ClosedAs | null>(null);
  const proceedId = useId();
  const closeId = useId();

  const cantProceed = proceedProblem(partner, account.company);
  const cantClose = partner.closed ? COPY.CLOSED_ALREADY(CLOSED_LABELS[partner.closed]) : null;

  const mapArea = useMapArea();
  // After Proceed to MAP, the offer to start the MAP in the same step [builder's call], while the type has none.
  const [offer, setOffer] = useState(false);
  const noMap = mapArea?.map.status === 'ready' && mapArea.map.state.kind === 'none';
  const proceed = () => {
    setNudge(null);
    if (act({ kind: 'setStep', partnerId: partner.id, to: 'map' }, { label: COPY.MOVED_TO(STEP_LABELS.map) }).ok) setOffer(true);
  };
  const askProceed = () => {
    const advice = stepNudge(partner, 'map', { hypothesisHolds: hypothesisHolds(book, partner.id, marketStates) });
    if (advice) setNudge(advice);
    else proceed();
  };

  return (
    <div className="grid gap-2 border-t border-line pt-4">
      <p className="text-sm text-ink-3">{TIPS['qualification.decision']}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" disabled={cantProceed !== null} aria-describedby={cantProceed ? proceedId : undefined}
          onClick={askProceed}>
          {COPY.PROCEED_TO_MAP}
        </Button>
        {(['not_now', 'no'] as const).map((as) => (
          <Button key={as} size="sm" disabled={cantClose !== null} aria-describedby={cantClose ? closeId : undefined} onClick={() => setClosing(as)}>
            {CLOSED_LABELS[as]}
          </Button>
        ))}
      </div>
      {cantProceed && <DisabledReason id={proceedId}>{cantProceed}</DisabledReason>}
      {cantClose && <DisabledReason id={closeId}>{cantClose}</DisabledReason>}
      {nudge && <AdviceBox text={nudge} onGoAhead={proceed} onCancel={() => setNudge(null)} />}
      {offer && noMap && partner.step === 'map' && mapArea && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-xl border border-brand/20 bg-brand-soft/60 p-3 text-sm">
          <p className="min-w-0 flex-1 basis-56">{COPY.MAP_PROCEED_OFFER(account.company)}</p>
          <Button variant="primary" size="sm" disabled={mapArea.starting} aria-busy={mapArea.starting || undefined} onClick={mapArea.start}>
            {COPY.START_MAP_NOW}
          </Button>
        </div>
      )}
      {closing && (
        <CloseDialog key={closing} defaultAs={closing} open onOpenChange={(open) => { if (!open) setClosing(null); }} />
      )}
    </div>
  );
}

/**
 * Qualification, after the discovery call: the confirmed 4C with notes, the optional recruitment questions, CASO folded
 * away, and the decision (until the partner is signed).
 */
export function Qualification() {
  const { partner, readOnly } = usePartner();
  const act = useAct();
  const { qualification, edit } = useQualification();
  return (
    <Section title={COPY.QUALIFICATION_TITLE} description={COPY.QUALIFICATION_TEXT}>
      <div className="grid gap-5">
        <FourCCheck scores={partner.confirmed} notes={qualification?.confirmedNotes ?? EMPTY_NOTES} notesKey="confirmedNotes"
          onScore={(c, score) => act({ kind: 'update', entity: 'partner', id: partner.id, patch: { confirmed: { [c]: score } } }, { label: COPY.CONFIRMED_UPDATED })}
          onNote={(c, note) => edit({ confirmedNotes: { [c]: note } }, COPY.CONFIRMED_UPDATED)}
          recommendation={confirmedRecommendation(partner.confirmed)} empty={COPY.CONFIRMED_EMPTY} />
        <Questions />
        <Caso />
        {!readOnly && partner.signedDate === null && <Decision />}
      </div>
    </Section>
  );
}
