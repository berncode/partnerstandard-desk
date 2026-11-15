'use client';

// The step's cards use Recruitment's `Section`; the words come from COPY. Delete program opens the Programs page
// afterwards; a program that partners or markets point to is refused with the counts, in the dialog.
import { KIND, WHO_INVOICES, type Program } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { useRouter } from 'next/navigation';
import { Section } from '@/ui/pieces';
import { DeleteProgram } from '../delete-program';
import { Field } from '../field';
import { control, ROW2, textarea } from '../form-styles';
import { Note } from '../note';
import { useProgramEditor } from '../program-editor';
import { ISSUE_TABS, RowIssues } from '../row-issues';
import type { StepProps } from './step-props';

type TextKey = 'name' | 'lead' | 'focus' | 'goals' | 'description' | 'ipp' | 'icp' | 'kpis' | 'enablement' | 'tools';

/**
 * Step 2, Basics (PD spec §4.4): the fields of the PartnerStandard Partner Program Sheet template. The focus labels the
 * program on the Programs page and in the crumbs. Delete program is at the bottom.
 */
export function BasicsStep({ program: p, errors, onChange }: StepProps) {
  const { issues } = useProgramEditor();
  const set = (key: TextKey, value: string) => onChange({ ...p, [key]: value });
  const line = (key: TextKey, label: string, { placeholder, caption, optional, max = 200 }: { placeholder?: string; caption?: string; optional?: boolean; max?: number } = {}) => (
    <Field label={label} error={errors[key]} hint={caption} optional={optional}>
      {(describedBy) => (
        <input className={control} value={p[key]} placeholder={placeholder} maxLength={max} aria-describedby={describedBy}
          aria-invalid={errors[key] ? true : undefined} onChange={(e) => set(key, e.target.value)} />
      )}
    </Field>
  );
  const long = (key: TextKey, label: string, placeholder: string) => (
    <Field label={label} error={errors[key]}>
      {(describedBy) => (
        <textarea className={textarea} value={p[key]} placeholder={placeholder} maxLength={2000} aria-describedby={describedBy}
          aria-invalid={errors[key] ? true : undefined} onChange={(e) => set(key, e.target.value)} />
      )}
    </Field>
  );

  return (
    <div className="grid gap-4">
      <Section title={COPY.PROG_BASICS_PROGRAM} description={COPY.PROG_BASICS_PROGRAM_HINT}>
        <RowIssues className="mb-3" issues={issues} tabs={ISSUE_TABS.program} />
        <div className="grid gap-3">
          <div className={ROW2}>
            {line('name', COPY.PROG_NAME, { max: 80 })}
            {line('lead', COPY.PROG_LEAD, { placeholder: COPY.PROG_LEAD_PLACEHOLDER })}
          </div>
          <div className={ROW2}>
            {line('focus', COPY.PROG_FOCUS, { optional: true, placeholder: COPY.PROG_FOCUS_PLACEHOLDER, caption: COPY.PROG_FOCUS_HINT })}
          </div>
        </div>
        <Note>{WHO_INVOICES[KIND[p.type]]}</Note>
      </Section>

      <Section title={COPY.PROG_PURPOSE} description={COPY.PROG_PURPOSE_HINT}>
        <div className="grid gap-3">
          {long('goals', COPY.PROG_GOALS, COPY.PROG_GOALS_PLACEHOLDER)}
          {long('description', COPY.PROG_DESCRIPTION, COPY.PROG_DESCRIPTION_PLACEHOLDER)}
        </div>
      </Section>

      <Section title={COPY.PROG_AUDIENCE}>
        <div className={ROW2}>
          {long('ipp', COPY.PROG_IPP, COPY.PROG_IPP_PLACEHOLDER)}
          {long('icp', COPY.PROG_ICP, COPY.PROG_ICP_PLACEHOLDER)}
        </div>
      </Section>

      <Section title={COPY.PROG_RUNNING}>
        <div className="grid gap-3">
          {long('kpis', COPY.PROG_KPIS, COPY.PROG_KPIS_PLACEHOLDER)}
          <div className={ROW2}>
            {long('enablement', COPY.PROG_ENABLEMENT, COPY.PROG_ENABLEMENT_PLACEHOLDER)}
            {long('tools', COPY.PROG_TOOLS, COPY.PROG_TOOLS_PLACEHOLDER)}
          </div>
        </div>
      </Section>

      <Section title={COPY.PROG_DELETE} description={COPY.PROG_DELETE_HINT}>
        <DeleteThisProgram program={p} />
      </Section>
    </div>
  );
}

/** Delete program, then the Programs page (owner, 2026-10-30). */
function DeleteThisProgram({ program }: { program: Program }) {
  const router = useRouter();
  const { remove } = useProgramEditor();
  return (
    <DeleteProgram
      name={program.name.trim() || COPY.PROG_THIS_PROGRAM}
      remove={remove}
      onDeleted={() => {
        router.push('/programs');
        // Programs may be kept from an earlier visit (Cache Components): read it again, without the deleted program.
        router.refresh();
      }}
    />
  );
}
