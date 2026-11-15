'use client';

// Our figures in Company facts (PD spec 5.3), internal: what a new case copies. The Business Case app's "Your internal
// figures" card (the figures and the default cost lines), as a card of Company facts. A case keeps its own copy;
// changing the card never changes a case that exists.
import type { CaseIssue, CompanyFacts, Currency } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { FiguresForm } from '@/cases/figures-form';
import { issuesWithin } from '@/cases/issues';
import { costGroups, OurCostLinesForm } from '@/cases/our-cost-lines';
import { Section } from '@/ui/pieces';

export function OurFiguresCard({ ours, currency, issues, onChange }: {
  ours: CompanyFacts['ours'];
  currency: Currency;
  /** The facts' issues, with their paths from the facts (`ours.figures.serve.close`). */
  issues: CaseIssue[];
  onChange: (ours: CompanyFacts['ours']) => void;
}) {
  return (
    <Section title={COPY.FACTS_OURS} className="border-warn/40" description={<span className="text-warn">{COPY.FACTS_OURS_HINT}</span>}>
      <div className="grid items-start gap-5 min-[720px]:grid-cols-2">
        <FiguresForm figures={ours.figures} onChange={(figures) => onChange({ ...ours, figures })} issues={issuesWithin(issues, 'ours.figures')} currency={currency} />
        <div className="min-w-0">
          <h3 className="text-[13.5px] font-semibold">{COPY.FACTS_OURS_COSTS}</h3>
          <p className="mt-0.5 mb-3 text-xs text-ink-3">{COPY.FACTS_OURS_COSTS_HINT}</p>
          <OurCostLinesForm lines={ours.costs} onChange={(costs) => onChange({ ...ours, costs })} issues={issuesWithin(issues, 'ours.costs')}
            groups={costGroups(true)} currency={currency} />
        </div>
      </div>
    </Section>
  );
}
