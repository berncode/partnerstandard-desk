'use client';

// The step's cards use Recruitment's `Section`; the words come from COPY, and unreadable Reasons rows show in the card.
import { COPY } from '@partner-desk/copy';
import { Section } from '@/ui/pieces';
import { Callouts } from '../callouts';
import { useProgramEditor } from '../program-editor';
import { ISSUE_TABS, RowIssues } from '../row-issues';
import { TextList } from '../text-list';
import type { StepProps } from './step-props';

/** Step 1, Why join (PD spec §4.3): the reasons a partner joins besides money, which open the Program Sheet and the public page. */
export function WhyStep({ program: p, onChange }: StepProps) {
  const { issues } = useProgramEditor();
  return (
    <Section title={COPY.PROG_WHY_TITLE} description={COPY.PROG_WHY_HINT}>
      <RowIssues className="mb-3" issues={issues} tabs={ISSUE_TABS.reasons} />
      <TextList items={p.why} onChange={(why) => onChange({ ...p, why })} max={10}
        label={COPY.PROG_REASON} removeLabel={COPY.PROG_REMOVE_REASON} addLabel={COPY.PROG_ADD_REASON}
        placeholder={COPY.PROG_REASON_PLACEHOLDER} />
      {!p.why.some((x) => x.trim()) && <Callouts className="mt-3" items={[{ tone: 'warn', text: COPY.PROG_NO_REASON }]} />}
    </Section>
  );
}
