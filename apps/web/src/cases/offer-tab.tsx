'use client';

// The offer tab (tab 1 of a case): its title row and the case's own offer. PartnerStandard Desk adds what changed since the
// case was filled, the term notes, and Update from Company facts and program in the place of the Business Case app's
// "Reset portfolio and partner terms".
import { parseCase, type BusinessCase } from '@partner-desk/core';
import { useMemo } from 'react';
import { caseRecalculate, caseSources } from '@/app/(signed-in)/actions/cases';
import { useViewer } from '@/storage-context';
import { useCaseEditor } from './case-editor';
import { useCasePage } from './case-page';
import { issuesWithin, settleHidden, useLastValid } from './issues';
import { OfferForm } from './offer-form';
import { RecalculateDialog } from './recalculate-dialog';
import { SourcesNote } from './sources-note';
import { TermNotes } from './term-notes';

/** The paths of the When Preferred cost lines (BC's src/ui/our-cost-lines.tsx): switching Preferred off hides them. */
const preferredLinePaths = (lines: BusinessCase['costs'], prefix: string): string[] =>
  lines.flatMap((line, i) => (line.when === 'preferred' ? [`${prefix}.${i}`] : []));

export function OfferTab() {
  const { case: c, latest, update } = useCaseEditor();
  const { programs, typeGone } = useCasePage();
  const viewer = useViewer();
  const issues = useMemo(() => {
    const parsed = parseCase(c);
    return parsed.ok ? [] : parsed.issues;
  }, [c]);
  const lastValid = useLastValid(c, issues.length === 0);
  const partner = c.partner.trim() || 'the partner';
  /** Preferred switched off hides the When Preferred cost lines (the partner's and ours): a mistake left in them would stop every save. */
  const setOffer = (offer: BusinessCase['offer']) => {
    const prev = latest();
    const next = { ...prev, offer };
    const checked = parseCase(next);
    const hiding = prev.offer.preferred.on && !offer.preferred.on;
    update(checked.ok || !hiding ? next : settleHidden(next, [...preferredLinePaths(next.costs, 'costs'), ...preferredLinePaths(next.ours.costs, 'ours.costs')], checked.issues, lastValid.current));
  };
  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight break-words">{`Offer to ${partner}`}</h2>
          {/* A viewer changes nothing, so the line about changing it is left out (owner, 2026-11-14). */}
          {!viewer && <p className="mt-1 text-sm break-words text-ink-3">{`Changing it changes only the case for ${partner}.`}</p>}
        </div>
        <RecalculateDialog caseId={c.id} programs={programs} gone={typeGone} recalculate={caseRecalculate} />
      </div>
      <SourcesNote caseId={c.id} load={caseSources} />
      <TermNotes notes={c.notes} levels={c.offer.levels} />
      <OfferForm offer={c.offer} onChange={setOffer} issues={issuesWithin(issues, 'offer')} typeId={c.typeId} />
    </div>
  );
}
