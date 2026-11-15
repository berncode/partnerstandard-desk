import type { Recommendation } from '@partner-desk/core';
import { Chip, type ChipTone } from '@/ui/chip';

const RECOMMENDATION_TONE: Record<Recommendation['kind'], ChipTone> = {
  proceed: 'brand',
  call: 'info',
  not_now: 'warn',
  skip: 'danger',
  stop: 'danger',
};

/** The desk or confirmed check's advice. It never blocks anything. */
export function RecommendationChip({ recommendation, className }: { recommendation: Recommendation; className?: string }) {
  return <Chip tone={RECOMMENDATION_TONE[recommendation.kind]} className={className}>{recommendation.text}</Chip>;
}
