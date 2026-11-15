export const TOPICS = [
  'revenueModel',
  'costDrivers',
  'differentiators',
  'strategicBets',
  'customerPains',
  'partnershipExperience',
] as const;
export type Topic = (typeof TOPICS)[number];

// Source: "Call Guide: Partner Hypothesis – Initial Outreach" (owner's Drive doc),
// as used in the Recruitment app, adapted to PartnerStandard Desk's plain-words rule. The discovery call is for learning, not selling or qualifying.

export const TOPIC_TITLES: Record<Topic, string> = {
  revenueModel: 'Revenue Model',
  costDrivers: 'Cost Drivers',
  differentiators: 'Differentiators',
  strategicBets: 'Strategic Bets',
  customerPains: 'Customer Pains',
  partnershipExperience: 'Partnership Experience',
};

export const CALL_GUIDE: Record<
  Topic,
  { title: string; learn: string; questions: string[]; notePrompt: string }
> = {
  revenueModel: {
    title: 'Revenue Model',
    learn: 'How the partner makes money today. Primary revenue streams and their relative importance.',
    questions: [
      'Can you walk me through how your organization currently generates revenue?',
      'Which revenue streams matter most right now, and which are growing fastest?',
      'Are you exploring any new monetization paths for the next 12 - 24 months?',
    ],
    notePrompt:
      'List each revenue stream (e.g. subscriptions, services, ads, data licensing) and mark which are core or emerging.',
  },
  costDrivers: {
    title: 'Cost Drivers',
    learn: 'Major cost centers and pain points. Areas where efficiency gains would have real impact.',
    questions: [
      'What are the biggest cost drivers for delivering your product or service?',
      'Which processes or teams consume the most resources. Support, research and development, winning new customers, something else?',
      'Where do you see the best opportunities to reduce cost or increase speed?',
      'What have you tried so far to address these costs?',
    ],
    notePrompt:
      'Capture each high-cost area, any numbers you can get (for example what it costs them to win a customer, or how many customers they lose), and current mitigation efforts.',
  },
  differentiators: {
    title: 'Differentiators',
    learn:
      'How the partner positions itself. Unique features, credentials, geography, or expertise that set it apart.',
    questions: [
      'What do your customers say you do better than anyone else?',
      'Which features, certifications, or geographic reach give you an edge?',
      'Against competitors, where do you believe you win most consistently?',
    ],
    notePrompt: 'Bullet the differentiators and note proof points or customer quotes that back them up.',
  },
  strategicBets: {
    title: 'Strategic Bets',
    learn: 'The partner’s medium-term plans. Market expansion, product roadmap, sustainability or innovation goals.',
    questions: [
      'Looking ahead one to two years, what strategic initiatives are highest priority?',
      'Are there new regions, segments, or products you plan to enter?',
      'Which technology or feature launches are on your roadmap?',
      'Do you have other stated objectives that influence strategy?',
    ],
    notePrompt:
      'Record each future initiative, associated timeline, and any resources or partnerships they expect to need.',
  },
  customerPains: {
    title: 'Customer Pains',
    learn:
      'Problems their customers face. Especially those the partner addresses now or wants to address next.',
    questions: [
      'What customer pain points do you solve most often?',
      'Which problems do customers still struggle with after adopting your solution?',
      'Are there recurring issues around data, integration, visibility, or workflow you’d like to tackle next?',
    ],
    notePrompt: 'List each pain point, current solution (if any), and gaps the partner acknowledges.',
  },
  partnershipExperience: {
    title: 'Partnership Experience',
    learn: 'Past partnership outcomes, lessons learned, and goals for future collaborations.',
    questions: [
      'Can you share examples of partnerships you’ve tried. What worked well and what didn’t?',
      'What criteria must a new partnership meet to be worthwhile for you?',
      'Are there red flags or deal-breakers you’ve learned to avoid?',
      'What would success look like if we explored a partnership together?',
    ],
    notePrompt:
      'Write down successful partnership traits, past pitfalls, decision-making criteria, and desired outcomes.',
  },
};
