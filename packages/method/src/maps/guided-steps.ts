import { MAP_LEARN_MORE as LEARN_MORE } from '../links';

export type GuidedStepKey = 'partner' | 'objectives' | 'people' | 'activities' | 'milestones';

export interface GuidedStep {
  key: GuidedStepKey;
  title: string;
  tip: string;
  learnMore: string;
}

export const GUIDED_STEPS: GuidedStep[] = [
  {
    key: 'partner',
    title: 'Who is the partner?',
    tip: 'Agree on a MAP as early as possible, ideally before the agreement is signed. The MAP is the critical document for operational success; the agreement is merely the legal framework.',
    learnMore: LEARN_MORE.lifecycle,
  },
  {
    key: 'objectives',
    title: 'What does success look like, for both sides?',
    tip: 'Write each objective so the partner would sign it. Both sides get equal space: no one’s goals come first.',
    learnMore: LEARN_MORE.map,
  },
  {
    key: 'people',
    title: 'Who is committed, by name?',
    tip: '“Unless commitment is made, there are only promises and hopes, but no plans.” Name real people and titles on both sides, including an executive sponsor.',
    learnMore: LEARN_MORE.recruitment,
  },
  {
    key: 'activities',
    title: 'What will each side do during this horizon?',
    tip: 'Concrete, time-bound activities with one owner each. Be just as transparent about what you commit as about what you ask.',
    learnMore: LEARN_MORE.onboarding,
  },
  {
    key: 'milestones',
    title: 'When do we check in, and when do we stop?',
    tip: 'Set check-in points at day 30, 60 and 90. Discuss exit triggers upfront: it makes the hard conversation easy later.',
    learnMore: LEARN_MORE.map,
  },
];
