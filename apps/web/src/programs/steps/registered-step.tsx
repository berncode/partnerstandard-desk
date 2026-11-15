'use client';

// The step's cards use Recruitment's `Section`; the words come from COPY, and unreadable Entry and Benefits rows show in their cards.
import { levelNames } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { Section } from '@/ui/pieces';
import { BenefitList } from '../benefit-list';
import { Field } from '../field';
import { control, ROW2 } from '../form-styles';
import { useProgramEditor } from '../program-editor';
import { ISSUE_TABS, RowIssues } from '../row-issues';
import { TextList } from '../text-list';
import type { StepProps } from './step-props';

/** Step 3, the starting level (PD spec §4.5): its name, what it takes to join, and what its partners get. */
export function RegisteredStep({ program: p, errors, onChange }: StepProps) {
  const { issues } = useProgramEditor();
  const { reg, pref } = levelNames(p);
  return (
    <div className="grid gap-4">
      <Section title={COPY.PROG_START_LEVEL} description={COPY.PROG_START_LEVEL_HINT}>
        <div className={ROW2}>
          <Field label={COPY.PROG_LEVEL_NAME} error={errors.regName}>
            {(describedBy) => (
              <input className={control} value={p.regName} maxLength={200} aria-describedby={describedBy}
                aria-invalid={errors.regName ? true : undefined} onChange={(e) => onChange({ ...p, regName: e.target.value })} />
            )}
          </Field>
        </div>
      </Section>

      <Section title={COPY.PROG_JOIN} description={COPY.PROG_JOIN_HINT}>
        <RowIssues className="mb-3" issues={issues} tabs={ISSUE_TABS.entry} />
        <TextList items={p.entry} onChange={(entry) => onChange({ ...p, entry })} max={20}
          label={COPY.PROG_REQUIREMENT} removeLabel={COPY.PROG_REMOVE_REQUIREMENT} addLabel={COPY.PROG_ADD_REQUIREMENT} />
      </Section>

      <Section title={COPY.PROG_LEVEL_GETS(reg)} description={COPY.PROG_REG_BENEFITS_HINT(p.prefOn ? pref : null)}>
        <RowIssues className="mb-3" issues={issues} tabs={ISSUE_TABS.benefits} />
        <BenefitList program={p} tier="reg" onChange={onChange} />
      </Section>
    </div>
  );
}
