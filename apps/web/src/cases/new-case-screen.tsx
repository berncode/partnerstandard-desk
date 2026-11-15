'use client';

import { caseCreate } from '@/app/(signed-in)/actions/cases';
import type { ProgramOption } from '@/programs/title';
import { NewCaseForm, type CasePartnerOption } from './new-case-form';

/** The New case page's form, in a card, making the case through the `caseCreate` server action. */
export function NewCaseScreen({ partners, programs, initialPartnerId }: {
  partners: CasePartnerOption[];
  programs: ProgramOption[];
  initialPartnerId?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <NewCaseForm partners={partners} programs={programs} initialPartnerId={initialPartnerId} create={caseCreate} />
    </div>
  );
}
