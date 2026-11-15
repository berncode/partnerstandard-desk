'use client';

// New for PartnerStandard Desk (spec 4.2): each partner type joins a program of its type, at a level named as the program
// names it. Moving is a change on the page (the history keeps it); moving down to the starting level asks first.
import type { Level } from '@partner-desk/core';
import { PARTNER_TYPE_LABELS } from '@partner-desk/method';
import { COPY, LEVEL_LABELS } from '@partner-desk/copy';
import Link from 'next/link';
import { useId, useState } from 'react';
import { cn } from '@/ui/cn';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { controlClass } from '@/ui/control';
import { FIELD_ROWS, FieldRow, NARROW_SELECT, Section } from '@/ui/pieces';
import { useViewer } from '@/storage-context';
import { useAct, usePartner } from './partner-context';
import { coversType, membershipOf, programsFor } from './program-model';

const selectClass = cn(controlClass, 'px-2 disabled:opacity-70');
const linkClass = 'rounded font-medium text-brand-strong underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand';

/** What waits for a "yes": a move down to the starting level, or a partner at Preferred leaving its program. */
type Pending = { kind: 'down' } | { kind: 'program'; programId: string | null };

/**
 * Program and Level of the open partner type. Joining a program starts at its starting level; a partner at
 * Preferred that moves to another program (or out) starts again there, after a confirmation. A program that is
 * gone shows as such until another is picked. Left out for a partner type no program covers, unless one is set.
 */
export function ProgramCard() {
  const { account, partner, programs, programsListed, levelsOf, readOnly } = usePartner();
  const act = useAct();
  const programId = useId();
  const levelId = useId();
  // A company server's viewer can't make a program: the line says there is none, with no link to add one (owner, 2026-11-14).
  const viewer = useViewer();
  const [pending, setPending] = useState<Pending | null>(null);
  const membership = membershipOf(partner, programs, levelsOf, programsListed);
  // A listed program whose file is gone is offered only as gone.
  const offered = programsFor(programs, partner.partnerType)
    .filter((p) => membership.status !== 'gone' || p.programId !== membership.programId);
  if (!coversType(partner.partnerType) && membership.status === 'none') return null;

  const level: Level | null = membership.status === 'none' ? null : partner.level ?? 'reg';
  const levels = membership.status === 'in' && membership.levels.status === 'ready' ? membership.levels : null;
  const names = { reg: levels?.reg ?? LEVEL_LABELS.reg, pref: levels?.pref ?? LEVEL_LABELS.pref };

  const setProgram = (next: string | null) =>
    act({ kind: 'update', entity: 'partner', id: partner.id, patch: { programId: next, level: next === null ? null : 'reg' } }, { label: COPY.PROGRAM_CHANGED });
  const setLevel = (next: Level) => act({ kind: 'update', entity: 'partner', id: partner.id, patch: { level: next } }, { label: COPY.LEVEL_CHANGED });

  const pickProgram = (value: string) => {
    const next = value || null;
    if (next === partner.programId) return;
    if (level === 'pref' && membership.status === 'in') setPending({ kind: 'program', programId: next });
    else setProgram(next);
  };
  const pickLevel = (value: string) => {
    if (value === level) return;
    if (value === 'reg') setPending({ kind: 'down' });
    else setLevel('pref');
  };
  const confirm = () => {
    if (pending?.kind === 'down') setLevel('reg');
    else if (pending) setProgram(pending.programId);
    setPending(null);
  };

  return (
    <Section title={COPY.PROGRAM_TITLE} description={COPY.PROGRAM_TEXT}>
      <div className={FIELD_ROWS}>
        <FieldRow label={COPY.FIELD_PROGRAM} htmlFor={programId}>
          <div className="grid gap-1">
            <select id={programId} className={cn(selectClass, NARROW_SELECT)} value={partner.programId ?? ''} disabled={readOnly}
              onChange={(e) => pickProgram(e.target.value)}>
              <option value="">{COPY.NO_PROGRAM}</option>
              {offered.map((p) => <option key={p.programId} value={p.programId}>{p.title}</option>)}
              {membership.status === 'gone' && <option value={membership.programId}>{COPY.PROGRAM_GONE}</option>}
              {/* The list couldn't be read: the stored id, as the sheet holds it. */}
              {membership.status === 'unknown' && <option value={membership.programId}>{membership.programId}</option>}
            </select>
            {membership.status === 'gone' && <p className="text-xs text-warn">{COPY.PROGRAM_GONE_NOTE}</p>}
            {membership.status === 'in' && (
              <Link href={`/programs/${encodeURIComponent(membership.program.programId)}/why`} className={cn(linkClass, 'w-fit text-xs')}>
                {COPY.OPEN_PROGRAM}
              </Link>
            )}
            {offered.length === 0 && membership.status === 'none' && programsListed && (
              <p className="text-xs text-ink-3">
                {COPY.NO_PROGRAM_OF_TYPE(PARTNER_TYPE_LABELS[partner.partnerType])}
                {!viewer && <>{' '}<Link href="/programs/new" className={linkClass}>{COPY.NAV_ADD_PROGRAM}</Link></>}
              </p>
            )}
            {membership.status === 'in' && membership.levels.status === 'failed' && <p className="text-xs text-danger">{membership.levels.message}</p>}
          </div>
        </FieldRow>
        {membership.status === 'in' && level !== null && (
          <FieldRow label={COPY.FIELD_LEVEL} htmlFor={levelId}>
            {/* The level names come with the program's file; until then the level can't be changed. */}
            <select id={levelId} className={cn(selectClass, NARROW_SELECT)} value={level} disabled={readOnly || !levels} onChange={(e) => pickLevel(e.target.value)}>
              <option value="reg">{names.reg}</option>
              {(!levels || levels.prefOn) && <option value="pref">{names.pref}</option>}
              {levels && !levels.prefOn && level === 'pref' && <option value="pref">{COPY.LEVEL_GONE}</option>}
            </select>
          </FieldRow>
        )}
      </div>
      {pending && (
        <ConfirmDialog open onOpenChange={(open) => { if (!open) setPending(null); }}
          title={pending.kind === 'down' ? COPY.LEVEL_DOWN_TITLE(account.company, names.reg) : COPY.PROGRAM_CHANGE_TITLE(account.company)}
          text={pending.kind === 'down' ? COPY.LEVEL_DOWN_TEXT(names.pref, names.reg)
            : pending.programId === null ? COPY.PROGRAM_LEAVE_TEXT(names.pref) : COPY.PROGRAM_CHANGE_TEXT(names.pref)}
          action={pending.kind === 'down' ? COPY.LEVEL_DOWN_ACTION(names.reg) : COPY.PROGRAM_CHANGE_ACTION}
          onConfirm={confirm} />
      )}
    </Section>
  );
}
