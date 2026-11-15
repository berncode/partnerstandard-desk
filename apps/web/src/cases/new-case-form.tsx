'use client';

// New for PartnerStandard Desk (spec 5.2, 6): New case asks for the partner and its type, then, only when the command says the
// person must pick, for the program (ruling: the first of the type's programs is picked already, even when it is the
// only one).
import { COPY } from '@partner-desk/copy';
import type { PartnerType } from '@partner-desk/method';
import { useRouter } from 'next/navigation';
import { useId, useLayoutEffect, useRef, useState, useTransition } from 'react';
import type { RemoteOutcome } from '@/editor/remote';
import { programsFor } from '@/partner/program-model';
import type { ProgramOption } from '@/programs/title';
import { Button } from '@/ui/button';
import { cn } from '@/ui/cn';
import { controlClass } from '@/ui/control';
import { casePath } from './case-rows';

/** A partner type a case can be for: "Acme as reseller". */
export interface CasePartnerOption {
  partnerId: string;
  label: string;
  partnerType: PartnerType;
}

export type CreateCase = (input: { partnerId: string; programId?: string }) => Promise<RemoteOutcome<{ caseId: string }>>;

/** Makes a case and opens it on its offer tab, or says why not; `askProgram` when the person must pick the program. */
export function useMakeCase(create: CreateCase) {
  const router = useRouter();
  const [pending, startPending] = useTransition();
  // Once made, nothing here may make another while the case loads (push doesn't wait).
  const made = useRef(false);
  const [finished, setFinished] = useState(false);
  // Next keeps this page, hidden, while the person is away (Cache Components): coming back, New case works again.
  useLayoutEffect(() => () => {
    made.current = false;
    setFinished(false);
  }, []);
  const make = (input: { partnerId: string; programId?: string }, onRefused: (r: { message: string; askProgram: boolean }) => void) =>
    startPending(async () => {
      if (made.current) return;
      let result: Awaited<ReturnType<CreateCase>>;
      try {
        result = await create(input);
      } catch {
        result = { ok: false, error: 'unavailable', message: COPY.ACTION_FAILED };
      }
      if (!result.ok) {
        const askProgram = result.fieldErrors?.programId !== undefined;
        onRefused({ message: result.fieldErrors?.programId ?? result.message, askProgram });
        return;
      }
      made.current = true;
      setFinished(true);
      router.push(casePath(result.caseId));
    });
  return { make, pending: pending || finished };
}

/**
 * The form: the partner type (unless `fixed`), then the program once the command asks for one. `startAsking`: the
 * program is asked at once (the area already heard that it must be picked).
 */
export function NewCaseForm({ partners, programs, initialPartnerId, fixed = false, startAsking = false, create }: {
  partners: readonly CasePartnerOption[];
  programs: readonly ProgramOption[];
  initialPartnerId?: string;
  fixed?: boolean;
  startAsking?: boolean;
  create: CreateCase;
}) {
  const partnerFieldId = useId();
  const programFieldId = useId();
  const [partnerId, setPartnerId] = useState(() => partners.find((p) => p.partnerId === initialPartnerId)?.partnerId ?? partners[0]?.partnerId ?? '');
  const partner = partners.find((p) => p.partnerId === partnerId);
  const offered = partner ? programsFor(programs, partner.partnerType) : [];
  const [asking, setAsking] = useState(startAsking);
  const [programId, setProgramId] = useState(offered[0]?.programId ?? '');
  const [message, setMessage] = useState<string | null>(startAsking ? COPY.CASE_PICK_PROGRAM : null);
  const { make, pending } = useMakeCase(create);

  const pickPartner = (next: string) => {
    setPartnerId(next);
    setAsking(false);
    setMessage(null);
    const type = partners.find((p) => p.partnerId === next)?.partnerType;
    setProgramId(type ? programsFor(programs, type)[0]?.programId ?? '' : '');
  };

  const submit = () => {
    if (!partner) return;
    setMessage(null);
    make({ partnerId: partner.partnerId, ...(asking && programId ? { programId } : {}) }, ({ message: why, askProgram }) => {
      if (askProgram) setAsking(true);
      setMessage(why);
    });
  };

  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      {!fixed && (
        <div className="grid min-w-0 gap-1">
          <label htmlFor={partnerFieldId} className="text-xs font-medium text-ink-3">{COPY.FIELD_CASE_PARTNER}</label>
          <select id={partnerFieldId} className={cn(controlClass, 'px-2')} value={partnerId} disabled={pending} onChange={(e) => pickPartner(e.target.value)}>
            {partners.map((p) => <option key={p.partnerId} value={p.partnerId}>{p.label}</option>)}
          </select>
        </div>
      )}
      {asking && offered.length > 0 && (
        <div className="grid min-w-0 gap-1">
          <label htmlFor={programFieldId} className="text-xs font-medium text-ink-3">{COPY.FIELD_CASE_PROGRAM}</label>
          <select id={programFieldId} className={cn(controlClass, 'px-2')} value={programId} disabled={pending} onChange={(e) => setProgramId(e.target.value)}>
            {offered.map((p) => <option key={p.programId} value={p.programId}>{p.title}</option>)}
          </select>
        </div>
      )}
      {message && <p role="alert" className={cn('text-sm', asking ? 'text-ink-2' : 'text-danger')}>{message}</p>}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={pending || !partner} aria-busy={pending || undefined}>
          {pending ? COPY.NEW_CASE_MAKING : COPY.NEW_CASE_ACTION}
        </Button>
      </div>
    </form>
  );
}
