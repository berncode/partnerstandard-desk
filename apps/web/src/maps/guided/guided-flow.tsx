'use client';

// The guided flow for a MAP that exists already (Start the MAP made it, spec 5.2): the steps fill a draft of it on screen, and
// the last one saves its rows (`fillMap`) and opens the MAP. The partner step is filled from Partners; every other step can be skipped.
import { planInfoFor, type IsoDate, type MapChange, type MapPlan, type MapRecord } from '@partner-desk/core';
import { GUIDED_STEPS, type GuidedStepKey } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import { Check, Lightbulb, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore, useTransition } from 'react';
import type { RemoteOutcome } from '@/editor/remote';
import { Button } from '@/ui/button';
import { cn } from '@/ui/cn';
import { mapPath } from '../plan-card';
import { clearDraft, loadDraft, saveDraft } from './draft-storage';
import { applyToDraft, fillInput, newDraft } from './draft';
import { ActivitiesStep, MilestonesStep, ObjectivesStep, PartnerStep, PeopleStep, type Contact } from './steps';

export type FillMap = (input: ReturnType<typeof fillInput>) => Promise<RemoteOutcome<{ mapId: string }>>;

export interface GuidedFlowProps {
  mapId: string;
  /** The MAP as read: its info, and no rows yet. */
  plan: MapPlan;
  record: MapRecord;
  /** The date the MAP counts from before signing (its planned start). */
  plannedStart: IsoDate;
  /** Our side's name: the company's, else the person's own. */
  ours: string;
  ownerName: string;
  contacts: Contact[];
  /** What the partner type's business cases name "Beyond the money": offered as the partner's objectives (spec 5.2). */
  caseBenefits?: string[];
  onSave: FillMap;
}

/** This tab's sessionStorage, or null where the browser refuses it. */
function tabStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

const subscribeNothing = () => () => {};
/** False on the server and while hydrating, true afterwards: storage is read only then, so hydration matches. */
const useHydrated = () => useSyncExternalStore(subscribeNothing, () => true, () => false);

/**
 * The guided flow. Its draft survives a reconnect: it is saved to this tab's sessionStorage on every change, and once
 * the page has hydrated the flow mounts again from what was saved.
 */
export function GuidedFlow(props: GuidedFlowProps) {
  const hydrated = useHydrated();
  return <Flow key={hydrated ? 'restored' : 'first'} {...props} restore={hydrated} />;
}

function Flow({ mapId, plan, record, plannedStart, ours, ownerName, contacts, caseBenefits = [], onSave, restore }: GuidedFlowProps & { restore: boolean }) {
  const router = useRouter();
  const [saved] = useState(() => (restore ? loadDraft(tabStorage(), mapId) : null));
  const [draft, setDraft] = useState<MapPlan>(() => saved?.draft ?? newDraft(plan, record, ownerName, new Date().toISOString()));
  const [index, setIndex] = useState(saved?.index ?? 0);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (restore) saveDraft(tabStorage(), mapId, { draft, index });
  }, [restore, mapId, draft, index]);
  const step = GUIDED_STEPS[index]!;
  const last = index === GUIDED_STEPS.length - 1;
  const info = planInfoFor(draft.info, record, plannedStart);
  const names = { ours, partner: record.partnerName };

  const apply = (...changes: MapChange[]) => {
    const { plan: next, outcome } = applyToDraft(draft, changes, { now: new Date().toISOString(), actorName: ownerName }, record);
    setDraft(next);
    return outcome;
  };

  const save = () => {
    setFailure(null);
    startTransition(async () => {
      try {
        const result = await onSave(fillInput(mapId, draft));
        if (!result.ok) {
          setFailure(result.message);
          return;
        }
        clearDraft(tabStorage(), mapId);
        router.push(mapPath(mapId));
      } catch {
        setFailure(COPY.GUIDED_FAILED);
      }
    });
  };

  const next = () => {
    if (last) save();
    else setIndex(index + 1);
  };

  const body: Record<GuidedStepKey, React.ReactNode> = {
    partner: <PartnerStep info={info} apply={apply} />,
    objectives: <ObjectivesStep draft={draft} info={info} names={names} apply={apply} caseBenefits={caseBenefits} />,
    people: <PeopleStep draft={draft} info={info} names={names} apply={apply} contacts={contacts} />,
    activities: <ActivitiesStep draft={draft} info={info} names={names} apply={apply} />,
    milestones: <MilestonesStep draft={draft} info={info} names={names} apply={apply} />,
  };

  return (
    <div className="grid w-full gap-5 md:grid-cols-[12rem_minmax(0,1fr)]">
      <nav aria-label={COPY.GUIDED_STEPS_LABEL} className="md:pt-2">
        <p className="text-xs font-medium text-ink-3">{COPY.GUIDED_STEP_OF(index + 1, GUIDED_STEPS.length)}</p>
        <div className="mt-2 h-1 rounded-full bg-surface-2 md:hidden">
          <div className="h-full rounded-full bg-brand" style={{ width: `${((index + 1) / GUIDED_STEPS.length) * 100}%` }} />
        </div>
        <ol className="mt-3 hidden space-y-1 md:block">
          {GUIDED_STEPS.map((s, i) => (
            <li key={s.key} aria-current={i === index ? 'step' : undefined}
              className={cn('flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm', i === index ? 'bg-surface font-medium text-ink' : 'text-ink-3')}>
              <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                i < index ? 'bg-brand text-on-brand' : i === index ? 'bg-brand-soft text-brand-strong' : 'bg-surface-2')}>
                {i < index ? <Check className="h-3 w-3" aria-hidden /> : i + 1}
              </span>
              {COPY.GUIDED_STEP_NAMES[s.key]}
            </li>
          ))}
        </ol>
      </nav>

      <div className="min-w-0">
        {pending && last && <SavingPanel />}
        {/* Hidden, not unmounted, while saving: a failure brings the step back as it was. */}
        <div hidden={pending && last}>
          <h1 className="text-xl font-semibold tracking-tight text-balance sm:text-2xl">{step.title}</h1>
          <div className="mt-4 flex gap-3 rounded-xl border border-brand/20 bg-brand-soft/60 p-3 text-sm text-ink-2">
            <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-brand-strong" aria-hidden />
            <p>
              {step.tip}{' '}
              <a href={step.learnMore} target="_blank" rel="noreferrer" className="font-medium text-brand-strong underline-offset-2 hover:underline">
                {COPY.GUIDED_LEARN_MORE}
              </a>
            </p>
          </div>
          {failure && (
            <div className="mt-4 rounded-lg bg-danger-soft p-3">
              <p role="alert" className="text-sm text-danger">{failure}</p>
            </div>
          )}
          {/* Until the page has hydrated the flow is about to mount again (above), so nothing typed into it would survive. */}
          <fieldset disabled={!restore} className="m-0 min-w-0 border-0 p-0">
            <div className="mt-6">{body[step.key]}</div>
            <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-line pt-4">
              {index > 0 && <Button variant="ghost" onClick={() => setIndex(index - 1)}>{COPY.GUIDED_BACK}</Button>}
              <div className="ml-auto flex gap-2">
                {index > 0 && !last && <Button variant="ghost" onClick={() => setIndex(index + 1)}>{COPY.GUIDED_SKIP}</Button>}
                <Button variant="primary" onClick={next} disabled={pending}>
                  {last ? (pending ? COPY.GUIDED_SAVING : COPY.GUIDED_SAVE) : COPY.GUIDED_NEXT}
                </Button>
              </div>
            </div>
          </fieldset>
        </div>
      </div>
    </div>
  );
}

/** Shown in place of the last step while the MAP is saved. */
function SavingPanel() {
  return (
    <div role="status" className="flex flex-col items-center rounded-xl border border-line bg-surface px-6 py-14 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-soft">
        <Loader2 className="h-7 w-7 animate-spin text-brand-strong motion-reduce:animate-none" aria-hidden />
      </span>
      <p className="mt-5 text-base font-semibold text-ink">{COPY.GUIDED_SAVING_TITLE}</p>
      <p className="mt-1 text-sm text-ink-3">{COPY.GUIDED_SAVING_TEXT}</p>
    </div>
  );
}
