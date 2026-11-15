'use client';

// The partner page's header, after the Recruitment app's: the partner type joins the website under the name; signing and the exit join the close area.
import { EndArea } from './end-area';
import { usePartner } from './partner-context';
import { partnerRecommendation, showsRecommendation } from './partner-model';
import { RecommendationChip } from './recommendation-chip';
import { StageStepper } from './stage-stepper';

/** The open partner type: the advice, the stepper, and closing, signing or the exit. */
export function Header() {
  const { partner } = usePartner();
  const recommendation = showsRecommendation(partner) ? partnerRecommendation(partner) : null;
  return (
    <div data-testid="type-header" className="grid gap-3 rounded-xl border border-line bg-surface p-4">
      {recommendation && (
        <div className="flex justify-end">
          <RecommendationChip recommendation={recommendation} />
        </div>
      )}
      <StageStepper />
      <EndArea />
    </div>
  );
}
