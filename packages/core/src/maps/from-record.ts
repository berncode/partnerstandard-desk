// A new MAP (spec 5.2): empty apart from its info. The partner type's contacts are not added: the guided step offers them.
import type { PartnerType } from '@partner-desk/method';
import { DEFAULT_HORIZON_DAYS, type MapPlan } from './types';

export interface NewMapSource {
  partnerId: string;
  partnerType: PartnerType;
  contacts: Array<{ name: string; title: string; email: string | null }>;
}

/** An empty MAP needs no ids: the guided step makes ids for the contacts it adds. */
export function newMapPlan(src: NewMapSource): MapPlan {
  return {
    info: { partnerId: src.partnerId, partnerType: src.partnerType, horizonDays: DEFAULT_HORIZON_DAYS, laterHorizons: [], nextReviewDate: null },
    objectives: [], activities: [], people: [], milestones: [], exitTriggers: [],
    reviews: [], reviewNumbers: [], reviewItems: [],
  };
}
