export const CASO_LETTERS = ['culture', 'additionalValue', 'sponsorship', 'alignedObjectives'] as const;
export type CasoLetter = (typeof CASO_LETTERS)[number];

// Source: the PartnerStandard method (https://pro.partnerstandard.com), "CASO" (optional, with help text for each letter).

export const CASO_HELP: Record<CasoLetter, { label: string; question: string }> = {
  culture: {
    label: 'Culture',
    question: 'Do the two companies work in compatible ways?',
  },
  additionalValue: {
    label: 'Additional value',
    question: 'Does the combination create more than each alone (1 + 1 = 3)?',
  },
  sponsorship: {
    label: 'Sponsorship',
    question: 'Is there a senior sponsor on both sides?',
  },
  alignedObjectives: {
    label: 'Aligned objectives',
    question: 'Do both sides want the same outcome?',
  },
};
