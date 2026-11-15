'use client';

// The Recruitment app's pill stepper sits inside the Recruitment stage; the stages after it move one at a time once the partner is signed.
import { stepNudge, type ProposalView } from '@partner-desk/core';
import { STAGE_LABELS, STEP_LABELS, type RecruitmentStep, type Stage } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import { Check } from 'lucide-react';
import { useId, useState } from 'react';
import { ProposalCard } from '@/proposals/proposal-card';
import { cardsFor, closeValues, signedValues, stepAdvice } from '@/proposals/proposal-model';
import { cn } from '@/ui/cn';
import { AdviceBox } from '@/ui/pieces';
import { useCopy } from '@/storage-context';
import { CloseDialog } from './close-dialog';
import { sayIfRefused, useAct, usePartner } from './partner-context';
import { SignDialog } from './sign-dialog';
import { formatDate } from '@/partners/partners-model';
import { hypothesisHolds, pastRecruitment, stageBoxes, stepperHint, stepPills, type Place, type StepPill } from './partner-model';

const PILL = 'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:pointer-events-none disabled:opacity-50';
const PILL_PLACE: Record<Place, string> = {
  current: 'cursor-default border-brand bg-brand-soft text-brand-strong',
  done: 'border-line text-ink-2 hover:border-ink-3',
  later: 'border-dashed border-line text-ink-3 hover:border-ink-3',
  plain: 'border-line text-ink-3',
};
const BOX_PLACE: Record<Place, string> = {
  current: 'border-brand bg-brand-soft/60',
  done: 'border-line',
  later: 'border-dashed border-line',
  plain: 'border-line',
};
const BOX_LABEL: Record<Place, string> = { current: 'text-brand-strong', done: 'text-ink-2', later: 'text-ink-3', plain: 'text-ink-3' };

/** A step: a button, one back or forward. */
function Pill({ pill, describedBy, onChoose }: {
  pill: StepPill; describedBy: string | undefined; onChoose: (step: RecruitmentStep) => void;
}) {
  const isCurrent = pill.state === 'current';
  return (
    <button type="button" aria-current={isCurrent ? 'step' : undefined} disabled={!isCurrent && pill.blocked !== null}
      title={pill.blocked ?? undefined} aria-describedby={describedBy} onClick={() => { if (!isCurrent) onChoose(pill.step); }}
      className={cn(PILL, PILL_PLACE[pill.state])}>
      {pill.state === 'done' && <Check className="h-3 w-3" aria-hidden />}
      {STEP_LABELS[pill.step]}
    </button>
  );
}

function StageName({ stage, place }: { stage: Stage; place: Place }) {
  return (
    <span className={cn('inline-flex items-center gap-1 text-sm font-semibold', BOX_LABEL[place])}>
      {place === 'done' && <Check className="h-3.5 w-3.5" aria-hidden />}
      {STAGE_LABELS[stage]}
    </span>
  );
}

/**
 * An agent's step, stage, close and signed proposals for the open partner type, under the stepper (agent proposals
 * spec 10.2). Accept runs what the person would do: a step with advice asks first (`onAdvice`), closing and signing
 * open their dialog filled with the proposal's values, anything else is accepted at once.
 */
function StepperProposals({ onAdvice, advising }: {
  onAdvice: (advice: { to: RecruitmentStep; text: string; proposal: ProposalView }) => void;
  /** The proposal whose step advice shows, if any. */
  advising: string | null;
}) {
  const { partner, book, readOnly, marketStates, proposals } = usePartner();
  const [dialog, setDialog] = useState<ProposalView | null>(null);
  if (!proposals) return null;
  const cards = cardsFor(proposals.views, partner.id, 'stepper');
  /** Refused at once: the outcome, so the card knows; a dialog or advice asks first: nothing yet. */
  const accept = (view: ProposalView) => {
    if (view.head.kind === 'close' || view.head.kind === 'signed') {
      // Values that can't be read any more (a row typed over by hand): nothing to fill the dialog with.
      const values = view.head.kind === 'close' ? closeValues(view, book) : signedValues(view, book);
      if (!values) return sayIfRefused({ ok: false, message: COPY.GONE });
      return setDialog(view);
    }
    const advice = stepAdvice(view, book, partner, marketStates);
    if (advice) return onAdvice({ ...advice, proposal: view });
    return sayIfRefused(proposals.accept(view));
  };
  const closing = dialog ? closeValues(dialog, book) : null;
  const signing = dialog ? signedValues(dialog, book) : null;
  const shut = (open: boolean) => { if (!open) setDialog(null); };
  return (
    <>
      {cards.map((view) => (
        <ProposalCard key={view.head.id} view={view} readOnly={readOnly} timeZone={proposals.timeZone} now={proposals.now}
          asking={dialog?.head.id === view.head.id || advising === view.head.id}
          onAccept={() => accept(view)} onReject={(note) => sayIfRefused(proposals.reject(view, note))} />
      ))}
      {dialog && closing && <CloseDialog open onOpenChange={shut} proposal={{ proposalId: dialog.head.id, values: closing }} />}
      {dialog && signing && <SignDialog open onOpenChange={shut} proposal={{ proposalId: dialog.head.id, values: signing }} />}
    </>
  );
}

/**
 * The partner's stages, as five boxes: Recruitment with its steps inside, then Onboarding, Growth, Expansion and Exit.
 * A step moves one at a time, with Recruitment's advice before moving on (it never blocks). After signing, the stage
 * before and the one after can be chosen, never Recruitment. The words under it say why the rest can't. An agent's
 * proposals for the partner type sit under it; accepting a step with advice shows that same advice first.
 */
export function StageStepper() {
  const { partner, book, readOnly, marketStates, proposals } = usePartner();
  const act = useAct();
  const words = useCopy();
  const [nudge, setNudge] = useState<{ to: RecruitmentStep; text: string; proposal?: ProposalView } | null>(null);
  // Advice is about the step the partner was at: once the step or the closing changes (here or elsewhere), it goes.
  const where = `${partner.step}|${partner.closed}`;
  const [adviceFor, setAdviceFor] = useState(where);
  if (adviceFor !== where) {
    setAdviceFor(where);
    setNudge(null);
  }
  const hintId = useId();
  const hint = stepperHint(partner, readOnly);
  const signed = pastRecruitment(partner);
  const signedOn = formatDate(partner.signedDate);

  const moveStep = (to: RecruitmentStep) => {
    setNudge(null);
    act({ kind: 'setStep', partnerId: partner.id, to }, { label: COPY.MOVED_TO(STEP_LABELS[to]) });
  };
  const chooseStep = (to: RecruitmentStep) => {
    const text = stepNudge(partner, to, { hypothesisHolds: hypothesisHolds(book, partner.id, marketStates) });
    if (text) setNudge({ to, text });
    else moveStep(to);
  };
  /** "Go ahead anyway": the step, or the agent's proposal of it, accepted as proposed. */
  const goAhead = (advice: NonNullable<typeof nudge>) => {
    if (!advice.proposal || !proposals) return moveStep(advice.to);
    setNudge(null);
    sayIfRefused(proposals.accept(advice.proposal));
  };
  const moveStage = (to: Stage) => act({ kind: 'setStage', partnerId: partner.id, to }, { label: COPY.MOVED_TO(STAGE_LABELS[to]) });

  return (
    <div className="grid gap-2">
      <ol aria-label={COPY.STAGE_GROUP} className="grid gap-2 md:grid-cols-4 xl:grid-cols-[auto_repeat(4,minmax(0,1fr))]">
        {stageBoxes(partner, readOnly, words.SAVE_READ_ONLY).map(({ stage, state, movable, blocked }) => {
          const box = cn('min-w-0 rounded-lg border px-2.5 py-2', BOX_PLACE[state]);
          if (stage === 'recruitment') {
            return (
              <li key={stage} aria-current={state === 'current' ? 'step' : undefined} className={cn(box, 'grid gap-2 md:col-span-4 xl:col-span-1')}>
                <StageName stage={stage} place={state} />
                {signed ? (
                  // The steps taken before signing aren't recorded, so none are shown.
                  <p className="text-xs text-ink-2">{signedOn ? COPY.RECRUITMENT_SIGNED(signedOn) : COPY.SIGNED_ON_UNKNOWN}</p>
                ) : (
                  <ol role="group" aria-label={COPY.STEP_GROUP} className="flex flex-wrap gap-1 xl:flex-nowrap">
                    {stepPills(partner, readOnly, words.SAVE_READ_ONLY).map((pill) => (
                      <li key={pill.step}>
                        <Pill pill={pill} describedBy={pill.blocked && hint ? hintId : undefined} onChoose={chooseStep} />
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            );
          }
          const underWay = stage === 'exit' && state === 'current' && partner.exitedDate === null;
          return (
            <li key={stage} aria-current={state === 'current' ? 'step' : undefined} className="min-w-0">
              {movable ? (
                <button type="button" disabled={blocked !== null} title={blocked ?? undefined} onClick={() => moveStage(stage)}
                  aria-describedby={blocked && hint ? hintId : undefined}
                  className={cn(box, 'flex h-full w-full flex-col items-start justify-start text-left outline-none hover:border-ink-3 focus-visible:ring-2 focus-visible:ring-brand disabled:pointer-events-none disabled:opacity-50')}>
                  <StageName stage={stage} place={state} />
                </button>
              ) : (
                <div className={cn(box, 'h-full')}>
                  <StageName stage={stage} place={state} />
                  {underWay && <p className="mt-1 text-xs text-ink-2">{COPY.EXIT_UNDER_WAY}</p>}
                  {stage === 'exit' && partner.exitedDate !== null && (
                    <p className="mt-1 text-xs text-ink-2">{COPY.EXITED_ON_DATE(formatDate(partner.exitedDate))}</p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {hint && <p id={hintId} className="text-xs text-ink-3">{hint}</p>}
      {nudge && <AdviceBox text={nudge.text} onGoAhead={() => goAhead(nudge)} onCancel={() => setNudge(null)} />}
      <StepperProposals onAdvice={setNudge} advising={nudge?.proposal?.head.id ?? null} />
    </div>
  );
}
