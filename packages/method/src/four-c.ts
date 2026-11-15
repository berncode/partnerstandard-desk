export const FOUR_C = ['customerBase', 'credibility', 'capability', 'commitment'] as const;
export type FourC = (typeof FOUR_C)[number];

export const FOUR_C_LABELS: Record<FourC, string> = {
  customerBase: 'Customer base',
  credibility: 'Credibility',
  capability: 'Capability',
  commitment: 'Commitment',
};

// Source: the PartnerStandard method (https://pro.partnerstandard.com), "Qualification". Levels are indexed by score 0 to 3.

export const FOUR_C_LEVELS: Record<FourC, { label: string; levels: [string, string, string, string] }> = {
  customerBase: {
    label: 'Customer base',
    levels: [
      'No overlap with our target customers, or no access to them',
      'Some overlap, but small (well under a third) or limited access',
      'Clear overlap (about a third or more) and real access',
      'Strong overlap, growing base, relationships with the decision makers',
    ],
  },
  credibility: {
    label: 'Credibility',
    levels: [
      'Nothing in their portfolio near ours; customers would not believe it',
      'Portfolio only loosely related',
      'Portfolio next to ours; credible to the end customer',
      'Recognized in our category, active in products next to ours',
    ],
  },
  capability: {
    label: 'Capability',
    levels: [
      'Cannot deliver their part (sales approach, invoicing, technical skills)',
      'Could deliver only with major changes',
      'Sales approach, deal size, sales cycle and setup fit, minor gaps',
      'Already sells or delivers similar products the same way',
    ],
  },
  commitment: {
    label: 'Commitment',
    levels: [
      'No business reason for them; the partnership would make no difference',
      'Interested, but no named people and no investment',
      'Clear business reason (their side of the hypothesis holds), a sponsor, sellers in view',
      'It matters to their goals; named active sellers; ready to invest',
    ],
  },
};
