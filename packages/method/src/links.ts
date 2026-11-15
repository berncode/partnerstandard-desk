const guide = (slug: string) => `https://pro.partnerstandard.com/guides/${slug}`;

export const LINKS: Record<string, string> = {
  marketHypothesisVsPartnerHypothesis: guide('market-hypothesis-vs-partner-hypothesis'),
  partnerRecruitment: guide('partner-recruitment'),
  qualifyingChannelPartnersWith4c: guide('qualifying-channel-partners-with-the-4c-method'),
  qualifyingPartnerOpportunityWithCaso: guide('qualifying-partner-opportunity-with-the-caso-method'),
  partnerValueProposition: guide('partner-value-proposition'),
};

/** The hub pages the MAP's guided steps link to. */
const HUB = 'https://pro.partnerstandard.com';
export const MAP_LEARN_MORE = {
  map: `${HUB}/guides/partnership-architecture/operating-model`,
  recruitment: `${HUB}/guides/partner-recruitment`,
  onboarding: `${HUB}/guides/partner-onboarding`,
  lifecycle: `${HUB}/guides/partner-lifecycle-management`,
  course: `${HUB}/training`,
  template: `${HUB}/products/mutual-action-plan`,
} as const;
