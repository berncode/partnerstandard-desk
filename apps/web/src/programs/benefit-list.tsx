'use client';

// The words come from COPY.

import { useId, useRef } from 'react';
import { BENEFITS, levelNames, type BenefitGroup, type Level, type OwnBenefit, type Program } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { useViewer } from '@/storage-context';
import { cn } from '@/ui/cn';
import { checkbox, control, removeButton } from './form-styles';

/** The most own benefits a program keeps (the validation's limit). */
const MAX_OWN = 40;
const KEY_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';

/** `own_` plus 8 characters. */
function ownKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `own_${Array.from(bytes, (b) => KEY_CHARS[b % KEY_CHARS.length]).join('')}`;
}

/** A row of the list: tick box, text, tag (prototype 2's `.check`), so the boxes line up. */
export const checkRow = 'grid min-h-9 grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 border-b border-line py-1 text-[13.5px] last:border-b-0';

/** The tag on a benefit Preferred gets from Registered: the Registered level's name. */
function LevelTag({ name }: { name: string }) {
  return <span className="rounded-[5px] bg-surface-2 px-1.5 py-px text-[11px] font-semibold whitespace-nowrap text-ink-2">{name}</span>;
}

/**
 * What a level's partners get (PD spec §4.8): four groups of tick boxes, each ending with **+ Add your own**, which adds
 * a ticked line with a text field (focused) and a remove button. On Preferred, what Registered gives shows ticked,
 * grayed out and tagged with the Registered level's name; an own benefit added under Preferred shows unticked on
 * Registered and can be ticked there. Removing an own benefit removes it from both levels.
 */
export function BenefitList({ program: p, tier, onChange }: { program: Program; tier: Level; onChange: (p: Program) => void }) {
  const base = useId();
  /** The own benefit to focus once it is on screen: the one just added. */
  const focusKey = useRef<string | null>(null);
  // A company server's viewer reads the benefits, with no Add your own or Remove (owner, 2026-11-14).
  const viewer = useViewer();
  const regName = levelNames(p).reg;
  const locked = (k: string) => tier === 'pref' && p.reg.includes(k);
  const ticked = (k: string) => p[tier].includes(k);

  const tick = (k: string, on: boolean) => {
    const rest = p[tier].filter((x) => x !== k);
    onChange({ ...p, [tier]: on ? [...rest, k] : rest });
  };
  const add = (g: BenefitGroup) => {
    const k = ownKey();
    focusKey.current = k;
    onChange({ ...p, own: [...p.own, { k, g, n: '' }], [tier]: [...p[tier], k] });
  };
  const rename = (k: string, n: string) => onChange({ ...p, own: p.own.map((o) => (o.k === k ? { ...o, n } : o)) });
  const drop = (k: string) => onChange({
    ...p, own: p.own.filter((o) => o.k !== k), reg: p.reg.filter((x) => x !== k), pref: p.pref.filter((x) => x !== k),
  });

  const lockedRow = (k: string, name: string) => (
    <li key={k} className={cn(checkRow, 'text-ink-3')}>
      <input type="checkbox" id={`${base}-${k}`} className={checkbox} checked disabled />
      <label htmlFor={`${base}-${k}`} className="min-w-0 break-words">{name}</label>
      <LevelTag name={regName} />
    </li>
  );

  const ownRow = (o: OwnBenefit) => {
    const name = o.n.trim() || COPY.PROG_OWN_BENEFIT;
    return (
      <li key={o.k} className={checkRow}>
        <input type="checkbox" className={checkbox} aria-label={name} checked={ticked(o.k)} onChange={(e) => tick(o.k, e.target.checked)} />
        <input className={cn(control, 'h-8')} value={o.n} placeholder={COPY.PROG_OWN_BENEFIT} aria-label={COPY.PROG_OWN_BENEFIT} maxLength={200}
          ref={(el) => {
            if (el && focusKey.current === o.k) {
              focusKey.current = null;
              el.focus();
            }
          }}
          onChange={(e) => rename(o.k, e.target.value)} />
        {viewer ? <span /> : <button type="button" className={cn(removeButton, 'h-8')} aria-label={COPY.PROG_REMOVE_OWN(o.n.trim())} onClick={() => drop(o.k)}>×</button>}
      </li>
    );
  };

  return (
    <div className="grid gap-3.5">
      {BENEFITS.map(({ g, items }) => {
        const heading = `${base}-${g.replace(/\W+/g, '-')}`;
        return (
          <div key={g} role="group" aria-labelledby={heading}>
            <h3 id={heading} className="mb-1.5 text-[12.5px] font-semibold text-ink-2">{g}</h3>
            <ul>
              {items.map(([k, name]) => (locked(k) ? lockedRow(k, name) : (
                <li key={k} className={checkRow}>
                  <input type="checkbox" id={`${base}-${k}`} className={checkbox} checked={ticked(k)} onChange={(e) => tick(k, e.target.checked)} />
                  <label htmlFor={`${base}-${k}`} className="min-w-0 break-words">{name}</label>
                  <span />
                </li>
              )))}
              {p.own.filter((o) => o.g === g).map((o) => (locked(o.k) ? lockedRow(o.k, o.n.trim() || COPY.PROG_OWN_BENEFIT) : ownRow(o)))}
            </ul>
            {p.own.length < MAX_OWN && !viewer && (
              <button type="button" onClick={() => add(g)}
                className="mt-1.5 cursor-pointer rounded text-[13.5px] font-medium text-brand-strong outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand">
                {COPY.PROG_ADD_OWN}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
