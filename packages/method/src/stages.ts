export const STAGES = ['recruitment', 'onboarding', 'growth', 'expansion', 'exit'] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABELS: Record<Stage, string> = {
  recruitment: 'Recruitment',
  onboarding: 'Onboarding',
  growth: 'Growth',
  expansion: 'Expansion',
  exit: 'Exit',
};
export const EVALUATION_LABEL = 'Evaluation';

export const RECRUITMENT_STEPS = ['researched', 'discovery_call', 'qualification', 'map'] as const;
export type RecruitmentStep = (typeof RECRUITMENT_STEPS)[number];
export const STEP_LABELS: Record<RecruitmentStep, string> = {
  researched: 'Researched',
  discovery_call: 'Discovery call',
  qualification: 'Qualification',
  map: 'MAP',
};

export const VIEWS = ['potential', 'active', 'closed'] as const;
export type View = (typeof VIEWS)[number];
export const VIEW_LABELS: Record<View, string> = {
  potential: 'Potential',
  active: 'Active',
  closed: 'Closed',
};
