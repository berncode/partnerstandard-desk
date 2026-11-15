'use client';

// The new horizon runs in the partner record's stage (spec 5.3), so there is no stage select here.
import {
  currentHorizon, DEFAULT_HORIZON_DAYS, HORIZON_LENGTHS, normalizeName, type HorizonLength, type IsoDate, type MapStartHorizonChange, type PlanInfo,
} from '@partner-desk/core';
import { horizonMilestones } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import { CalendarCheck, CalendarPlus } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Button, buttonVariants } from '@/ui/button';
import { Dialog, DialogContent } from '@/ui/dialog';
import { formatMapDate } from '../format';
import { Field, fieldControl } from '../pieces';
import type { HorizonProgress } from '../view-model';
import { usePlan } from './plan-context';

const isLength = (days: number): days is HorizonLength => (HORIZON_LENGTHS as readonly number[]).includes(days);

/** The change that would start the next horizon now, with nothing chosen yet: what access is asked about. */
export function startHorizonProbe(info: PlanInfo, today: IsoDate): MapStartHorizonChange {
  return {
    kind: 'startHorizon', expectedStartDate: info.startDate, expectedHorizon: info.pastHorizons.length, startDate: today,
    horizonDays: info.horizonDays, milestones: [],
  };
}

/**
 * The owner's "Start next horizon" button and its dialog. Emphasized once the current horizon has ended; not shown
 * before it has started, nor before signing, where no horizon runs yet. People with a link never see it. Once the
 * horizon's review has its prep started, it points to the review instead: closing the review starts the next horizon
 * (reviews spec 5.3).
 */
export function StartHorizonButton({ phase }: { phase: HorizonProgress['phase'] }) {
  const { plan, today, allowed, reviewHref } = usePlan();
  const [open, setOpen] = useState(false);
  if ((phase !== 'running' && phase !== 'ended') || !allowed(startHorizonProbe(plan.info, today))) return null;
  const emphasized = phase === 'ended';
  const prep = plan.reviews.some((r) => r.state === 'prep' && r.horizon === currentHorizon(plan.info));
  if (prep && reviewHref) {
    return (
      <Link href={reviewHref} className={buttonVariants({ size: 'sm', variant: emphasized ? 'primary' : 'secondary' })}>
        <CalendarCheck className="h-4 w-4" aria-hidden />
        {COPY.REVIEW_GO_TO}
      </Link>
    );
  }
  return (
    <>
      <Button size="sm" variant={emphasized ? 'primary' : 'secondary'} onClick={() => setOpen(true)}>
        <CalendarPlus className="h-4 w-4" aria-hidden />
        {COPY.MAP_START_NEXT_HORIZON}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        {open && <StartHorizonForm onDone={() => setOpen(false)} />}
      </Dialog>
    </>
  );
}

function StartHorizonForm({ onDone }: { onDone: () => void }) {
  const { plan, today, dispatch } = usePlan();
  const { info } = plan;
  const horizon = info.pastHorizons.length + 2;
  const [length, setLength] = useState<HorizonLength>(isLength(info.horizonDays) ? info.horizonDays : DEFAULT_HORIZON_DAYS);
  const [withMilestones, setWithMilestones] = useState(true);
  /** Suggestions the owner unticked, by name: a name carries its day, so changing the length keeps the choice. */
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  const taken = new Set(plan.milestones.map((m) => normalizeName(m.name)));
  const suggestions = horizonMilestones({ startDate: today, horizonDays: length, horizon }).filter((m) => !taken.has(normalizeName(m.name)));

  const toggle = (name: string) => setUnticked((names) => {
    const next = new Set(names);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    return next;
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const milestones = withMilestones
      ? suggestions.filter((m) => !unticked.has(m.name)).map(({ name, criteria, day }) => ({ name, criteria, day }))
      : [];
    const outcome = dispatch({ ...startHorizonProbe(info, today), horizonDays: length, milestones });
    if (outcome.ok) onDone();
    else setError(Object.values(outcome.fieldErrors ?? {})[0] ?? outcome.message);
  };

  return (
    <DialogContent title={COPY.MAP_START_NEXT_HORIZON} description={COPY.MAP_HORIZON_DIALOG_TEXT(horizon)}>
      <form className="mt-4 space-y-4" onSubmit={submit}>
        <Field label={COPY.MAP_LENGTH} className="sm:max-w-60">
          <select className={fieldControl} value={String(length)} onChange={(e) => setLength(Number(e.target.value) as HorizonLength)}>
            {HORIZON_LENGTHS.map((d) => <option key={d} value={d}>{COPY.GUIDED_HORIZON_DAYS(d, d === DEFAULT_HORIZON_DAYS)}</option>)}
          </select>
        </Field>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" className="accent-brand" checked={withMilestones} onChange={(e) => setWithMilestones(e.target.checked)} />
            {COPY.MAP_ADD_HORIZON_MILESTONES}
          </label>
          {withMilestones && (
            suggestions.length === 0
              ? <p className="pl-6 text-xs text-ink-3">{COPY.MAP_HAS_THESE_MILESTONES}</p>
              : (
                <ul className="space-y-1.5 pl-6">
                  {suggestions.map((m) => (
                    <li key={m.name}>
                      <label className="flex items-start gap-2 text-sm">
                        <input type="checkbox" className="mt-1 accent-brand" checked={!unticked.has(m.name)} onChange={() => toggle(m.name)} />
                        <span className="min-w-0 break-words">{m.name} <span className="text-ink-3">· {formatMapDate(m.targetDate, today)}</span></span>
                      </label>
                    </li>
                  ))}
                </ul>
              )
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary">{COPY.MAP_START_HORIZON}</Button>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        </div>
      </form>
    </DialogContent>
  );
}
