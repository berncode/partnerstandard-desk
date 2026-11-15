// The words come from packages/copy.
import {
  PARTNER_TYPE_LABELS,
  RECRUITMENT_PARTNER_TYPES,
  STAGE_LABELS,
  STEP_LABELS,
} from '@partner-desk/method';
import {
  CALL_KIND_LABELS,
  CASO_ANSWER_LABELS,
  CHANGE_ENTITY_LABELS,
  CLOSED_LABELS,
  HOW_MARKET_BUYS_LABELS,
  HYPOTHESIS_STATUS_LABELS,
  LEVEL_LABELS,
  MAP_ACTIVITY_SIDE_LABELS,
  MAP_ACTIVITY_STATUS_LABELS,
  MAP_CATEGORY_LABELS,
  MAP_EXIT_STATUS_LABELS,
  MAP_HEALTH_LABELS,
  MAP_ROLE_LABELS,
  MAP_SIDE_LABELS,
  MARKET_STATUS_LABELS,
  PERSON_ROLE_LABELS,
  SOURCE_LABELS,
  SHEET_COPY,
  TARGET_CUSTOMER_TYPE_LABELS,
  VALUE_KIND_LABELS,
  VALUE_STATE_LABELS,
} from '@partner-desk/copy';

const REVIEW = SHEET_COPY.MAP.REVIEW_LABELS;
const PROPOSAL = SHEET_COPY.PROPOSALS.LABELS;

/** The partner types a market can have, with their usual names. */
const MARKET_PARTNER_TYPE_LABELS = Object.fromEntries(RECRUITMENT_PARTNER_TYPES.map((t) => [t, PARTNER_TYPE_LABELS[t]]));

/** Dropdown labels: the words the app uses. Keys are in core's order. */
export const ENUM_LABELS = {
  partnerType: PARTNER_TYPE_LABELS,
  marketPartnerType: MARKET_PARTNER_TYPE_LABELS,
  stage: STAGE_LABELS,
  step: STEP_LABELS,
  targetCustomerType: TARGET_CUSTOMER_TYPE_LABELS,
  closed: CLOSED_LABELS,
  source: SOURCE_LABELS,
  personRole: PERSON_ROLE_LABELS,
  callKind: CALL_KIND_LABELS,
  casoAnswer: CASO_ANSWER_LABELS,
  marketStatus: MARKET_STATUS_LABELS,
  howMarketBuys: HOW_MARKET_BUYS_LABELS,
  valueKind: VALUE_KIND_LABELS,
  valueState: VALUE_STATE_LABELS,
  hypothesisStatus: HYPOTHESIS_STATUS_LABELS,
  changeEntity: CHANGE_ENTITY_LABELS,
  level: LEVEL_LABELS,
  mapHealth: MAP_HEALTH_LABELS,
  // A MAP's lists, in the MAP app's words.
  mapSide: MAP_SIDE_LABELS,
  mapActivitySide: MAP_ACTIVITY_SIDE_LABELS,
  mapCategory: MAP_CATEGORY_LABELS,
  mapActivityStatus: MAP_ACTIVITY_STATUS_LABELS,
  mapRole: MAP_ROLE_LABELS,
  mapExitStatus: MAP_EXIT_STATUS_LABELS,
  // A MAP's review tabs.
  reviewState: REVIEW.state,
  scoreKey: REVIEW.number,
  reviewItemKind: REVIEW.itemKind,
  hypothesisAnswer: REVIEW.answer,
  caseSource: REVIEW.source,
  // The Partners file's Proposals tab.
  proposalKind: PROPOSAL.kind,
  proposalField: PROPOSAL.what,
  proposalStatus: PROPOSAL.status,
} as const satisfies Record<string, Record<string, string>>;

export type EnumName = keyof typeof ENUM_LABELS;

const PARTNER_TYPE_ALIASES = { si: 'system-integrator', systemintegrator: 'system-integrator', msp: 'managed', cosell: 'co-seller' };

// Common ways people type values by hand, keyed by normalized input.
const ALIASES: Partial<Record<EnumName, Record<string, string>>> = {
  partnerType: PARTNER_TYPE_ALIASES,
  marketPartnerType: PARTNER_TYPE_ALIASES,
  step: { discovery: 'discovery_call', mutualactionplan: 'map' },
  // The MAP app's aliases.
  mapActivityStatus: { complete: 'done', completed: 'done', notapplicable: 'na', todo: 'not_started', open: 'not_started' },
  mapRole: { sponsor: 'exec_sponsor', executive: 'exec_sponsor' },
};

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function labelFor(name: EnumName, value: string): string {
  return (ENUM_LABELS[name] as Record<string, string>)[value] ?? value;
}

/** Every label of a dropdown, in core's order. */
export function labelsOf(name: EnumName): string[] {
  return Object.values(ENUM_LABELS[name]);
}

/** The value a hand-typed cell means, ignoring case, spaces and punctuation; null when it means none. */
export function valueFor(name: EnumName, input: string): string | null {
  const key = normalize(input);
  if (!key) return null;
  const labels = ENUM_LABELS[name] as Record<string, string>;
  for (const [value, label] of Object.entries(labels)) {
    if (normalize(value) === key || normalize(label) === key) return value;
  }
  const alias = ALIASES[name]?.[key];
  return alias !== undefined && alias in labels ? alias : null;
}
