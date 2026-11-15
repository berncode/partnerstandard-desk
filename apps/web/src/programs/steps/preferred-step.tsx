'use client';

// The step's cards use Recruitment's `Section`; the words come from COPY, and unreadable Benefits, Requirements and Performance bar rows show in their cards.

import Link from 'next/link';
import { useId, useRef } from 'react';
import { BADGE_URL, CERTIFICATE_URL, KIND, levelCheck, levelNames, PLURAL, PREF_REQ, rateLine, WORD, type Bar, type PrefReq } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { useViewer } from '@/storage-context';
import { Button } from '@/ui/button';
import { cn } from '@/ui/cn';
import { Section } from '@/ui/pieces';
import { BenefitList, checkRow } from '../benefit-list';
import { Callouts } from '../callouts';
import { Field } from '../field';
import { checkbox, control, removeButton, ROW2 } from '../form-styles';
import { Note } from '../note';
import { NumberInput } from '../number-input';
import { useProgramEditor } from '../program-editor';
import { ISSUE_TABS, RowIssues } from '../row-issues';
import { programPath } from '../steps';
import type { StepProps } from './step-props';

const NEW_BAR: Bar = { label: '', value: 0, unit: COPY.PROG_A_YEAR };
const MAX_BARS = 20;
/**
 * A performance bar row: what you measure, at least, unit, remove. On a phone what you measure takes its own line (so
 * it isn't cut off), with at least and unit, each with its own small label, on the next.
 */
const BAR_ROW = 'grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_28px] items-end gap-1.5 min-[561px]:grid-cols-[minmax(0,1fr)_110px_120px_28px] min-[561px]:items-center';
const PHONE_LABEL = 'text-xs text-ink-3 min-[561px]:hidden';
const linkClass = 'font-medium text-brand-strong underline-offset-2 hover:underline';

/**
 * Step 4, the level partners earn (PD spec §4.6): its name, what its partners get on top (the money line, then the
 * benefits), what they have to do (requirements and the performance bar), keeping it, rolling it out, and the level
 * check. Without the level, the way to add it back.
 */
export function PreferredStep({ company, program: p, errors, onChange }: StepProps) {
  const { reg, pref } = levelNames(p);
  const ids = useId();
  const { issues } = useProgramEditor();
  /** The bar row to focus once it is on screen: the one just added. */
  const focusBar = useRef<number | null>(null);
  const toTop = () => window.scrollTo(0, 0);
  // A company server's viewer reads the level, with no Add, Remove or measure buttons (owner, 2026-11-14).
  const viewer = useViewer();

  if (!p.prefOn) {
    const [oneLevel] = levelCheck(company, p);
    return (
      <Section title={COPY.PROG_PREF_OFF_TITLE(pref)}
        description={KIND[p.type] === 'affiliate' ? COPY.PROG_AFFILIATE_ONE_LEVEL : oneLevel!.text}>
        {/* The level's rows stay in the sheet while it is off: their problems show here. */}
        <RowIssues className="mb-3" issues={issues} tabs={ISSUE_TABS.preferred} />
        {!viewer && <Button variant="primary" onClick={() => onChange({ ...p, prefOn: true })}>{COPY.PROG_ADD_LEVEL(pref)}</Button>}
      </Section>
    );
  }

  const setReq = <K extends keyof PrefReq>(key: K, value: PrefReq[K]) => onChange({ ...p, prefReq: { ...p.prefReq, [key]: value } });
  const setBar = (i: number, patch: Partial<Bar>) => onChange({ ...p, bars: p.bars.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const certified = p.prefReq.certified;
  const peopleError = errors['prefReq.certified.people'];
  const barErrors = p.bars.map((_, i) => ['label', 'value', 'unit'].map((k) => errors[`bars.${i}.${k}`]).find(Boolean));

  return (
    <div className="grid gap-4">
      <Section title={COPY.PROG_PREF_LEVEL} description={COPY.PROG_PREF_LEVEL_HINT(reg)}>
        <div className={ROW2}>
          <Field label={COPY.PROG_LEVEL_NAME} error={errors.prefName}>
            {(describedBy) => (
              <input className={control} value={p.prefName} maxLength={200} aria-describedby={describedBy}
                aria-invalid={errors.prefName ? true : undefined} onChange={(e) => onChange({ ...p, prefName: e.target.value })} />
            )}
          </Field>
          {!viewer && (
            <div className="grid content-start gap-1">
              {/* Takes the place of a label, so the button lines up with the field beside it. */}
              <span aria-hidden className="hidden text-xs min-[561px]:block">&nbsp;</span>
              <Button className="h-9 justify-self-start" onClick={() => onChange({ ...p, prefOn: false })}>{COPY.PROG_REMOVE_LEVEL}</Button>
            </div>
          )}
        </div>
      </Section>

      <Section title={COPY.PROG_LEVEL_GETS(pref)} description={COPY.PROG_PREF_BENEFITS_HINT(reg)}>
        <RowIssues className="mb-3" issues={issues} tabs={ISSUE_TABS.benefits} />
        <div className="grid gap-3.5">
          <div role="group" aria-labelledby={`${ids}-money`}>
            <h3 id={`${ids}-money`} className="mb-1.5 text-[12.5px] font-semibold text-ink-2">{COPY.PROG_STEP_MONEY}</h3>
            {p.money.model === 'none' ? <Note>{COPY.PROG_NO_CASH}</Note> : (
              <ul>
                <li className={checkRow}>
                  <input type="checkbox" className={checkbox} checked disabled aria-labelledby={`${ids}-money-line`} />
                  <span id={`${ids}-money-line`} className="min-w-0 break-words">
                    {COPY.PROG_HIGHER(WORD[p.money.model], rateLine(company, p, 'reg'), rateLine(company, p, 'pref'))}
                  </span>
                  <Link href={programPath(p.id, 'money')} onClick={toTop} className={linkClass}>{COPY.PROG_CHANGE}</Link>
                </li>
              </ul>
            )}
          </div>
          <BenefitList program={p} tier="pref" onChange={onChange} />
        </div>
      </Section>

      <Section title={COPY.PROG_PREF_TODO(pref)} description={COPY.PROG_PREF_TODO_HINT}>
        <RowIssues className="mb-3" issues={issues} tabs={ISSUE_TABS.preferred} />
        <h3 className="mb-1.5 text-[12.5px] font-semibold text-ink-2">{COPY.PROG_FOR_EVERY(pref)}</h3>
        <ul>
          {PREF_REQ.map(([key, name, unit]) => {
            const id = `${ids}-req-${key}`;
            if (key === 'certified') {
              return (
                <li key={key} className={checkRow}>
                  <input type="checkbox" id={id} className={checkbox} checked={certified.on}
                    onChange={(e) => setReq('certified', { ...certified, on: e.target.checked })} />
                  <label htmlFor={id} className="min-w-0 break-words">{name}</label>
                  <NumberInput id={`${id}-people`} label={name} labelHidden unit={unit} value={certified.people} disabled={!certified.on}
                    className="w-[104px]" invalid={Boolean(peopleError)} describedBy={peopleError ? `${id}-error` : undefined}
                    onChange={(people) => setReq('certified', { ...certified, people })} />
                  {peopleError && <p id={`${id}-error`} className="col-span-3 text-xs text-danger">{peopleError}</p>}
                </li>
              );
            }
            const on = p.prefReq[key] as boolean;
            return (
              <li key={key} className={checkRow}>
                <input type="checkbox" id={id} className={checkbox} checked={on} onChange={(e) => setReq(key, e.target.checked)} />
                <label htmlFor={id} className="min-w-0 break-words">{name}</label>
                <span />
              </li>
            );
          })}
        </ul>

        <h3 className="mt-4 mb-1.5 text-[12.5px] font-semibold text-ink-2">{COPY.PROG_BAR_FOR(PLURAL[p.type])}</h3>
        {p.bars.length > 0 && (
          <div>
            <div aria-hidden className={cn(BAR_ROW, 'mb-1 hidden text-xs text-ink-3 min-[561px]:grid')}>
              <span>{COPY.PROG_BAR_MEASURE}</span><span className="pr-2 text-right">{COPY.PROG_BAR_AT_LEAST}</span><span>{COPY.PROG_BAR_UNIT}</span><span />
            </div>
            <ul className="grid gap-2.5 min-[561px]:gap-1.5">
              {p.bars.map((b, i) => (
                <li key={i} className="border-line max-[560px]:border-b max-[560px]:pb-2.5 max-[560px]:last:border-b-0">
                  <div className={BAR_ROW}>
                    <input className={cn(control, 'col-span-2 min-[561px]:col-span-1')} value={b.label} aria-label={COPY.PROG_BAR_MEASURE} maxLength={200}
                      aria-invalid={barErrors[i] ? true : undefined} aria-describedby={barErrors[i] ? `${ids}-bar-${i}` : undefined}
                      ref={(el) => {
                        if (el && focusBar.current === i) {
                          focusBar.current = null;
                          el.focus();
                        }
                      }}
                      onChange={(e) => setBar(i, { label: e.target.value })} />
                    <div className="order-3 grid gap-1 min-[561px]:order-none">
                      <span aria-hidden className={PHONE_LABEL}>{COPY.PROG_BAR_AT_LEAST}</span>
                      <NumberInput id={`${ids}-bar-${i}-value`} label={COPY.PROG_BAR_AT_LEAST} labelHidden value={b.value}
                        invalid={Boolean(errors[`bars.${i}.value`])} describedBy={barErrors[i] ? `${ids}-bar-${i}` : undefined}
                        onChange={(value) => setBar(i, { value })} />
                    </div>
                    <div className="order-4 grid gap-1 min-[561px]:order-none">
                      <span aria-hidden className={PHONE_LABEL}>{COPY.PROG_BAR_UNIT}</span>
                      <input className={control} value={b.unit} aria-label={COPY.PROG_BAR_UNIT} maxLength={200} onChange={(e) => setBar(i, { unit: e.target.value })} />
                    </div>
                    {!viewer && (
                      <button type="button" className={cn(removeButton, 'order-2 self-center min-[561px]:order-none')} aria-label={COPY.PROG_REMOVE_MEASURE(i)}
                        onClick={() => onChange({ ...p, bars: p.bars.filter((_, j) => j !== i) })}>×</button>
                    )}
                  </div>
                  {barErrors[i] && <p id={`${ids}-bar-${i}`} className="mt-1 text-xs text-danger">{barErrors[i]}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {p.bars.length < MAX_BARS && !viewer && (
          <Button size="sm" className="mt-1.5" onClick={() => { focusBar.current = p.bars.length; onChange({ ...p, bars: [...p.bars, NEW_BAR] }); }}>
            {COPY.PROG_ADD_MEASURE}
          </Button>
        )}
      </Section>

      <Section title={COPY.PROG_KEEPING} description={COPY.PROG_KEEPING_HINT}>
        <div className={ROW2}>
          <NumberInput id={`${ids}-notice`} label={COPY.PROG_NOTICE} unit={COPY.UNIT_DAYS} value={p.notice} error={errors.notice}
            onChange={(notice) => onChange({ ...p, notice })} />
          <div className="grid content-start gap-1">
            <span aria-hidden className="hidden text-xs min-[561px]:block">&nbsp;</span>
            <label className="flex min-h-9 items-center gap-2 text-[13.5px] text-ink">
              <input type="checkbox" className={checkbox} checked={p.plan} onChange={(e) => onChange({ ...p, plan: e.target.checked })} />
              {COPY.PROG_PLAN}
            </label>
          </div>
        </div>
      </Section>

      <Section title={COPY.PROG_ROLLOUT} description={COPY.PROG_ROLLOUT_HINT}>
        <div className={ROW2}>
          <Field label={COPY.PROG_PILOTS} error={errors.pilots}>
            {(describedBy) => (
              <input className={control} value={p.pilots} placeholder={COPY.PROG_PILOTS_PLACEHOLDER} maxLength={2000} aria-describedby={describedBy}
                aria-invalid={errors.pilots ? true : undefined} onChange={(e) => onChange({ ...p, pilots: e.target.value })} />
            )}
          </Field>
          <Field label={COPY.PROG_PUBLISH} error={errors.publish}>
            {(describedBy) => (
              <input type="date" className={control} value={p.publish} aria-describedby={describedBy}
                aria-invalid={errors.publish ? true : undefined} onChange={(e) => onChange({ ...p, publish: e.target.value })} />
            )}
          </Field>
        </div>
        <Note>
          {COPY.PROG_TEMPLATES}{' '}
          <a href={CERTIFICATE_URL} target="_blank" rel="noreferrer" className={linkClass}>{COPY.PROG_CERTIFICATE}</a>,{' '}
          <a href={BADGE_URL} target="_blank" rel="noreferrer" className={linkClass}>{COPY.PROG_BADGE}</a>.
        </Note>
      </Section>

      <Section title={COPY.PROG_LEVEL_CHECK}>
        <Callouts items={levelCheck(company, p)} />
      </Section>
    </div>
  );
}
