// The words for the choices in PartnerStandard Desk's lists (dropdowns in the sheets, menus in the app). Keys are core's enum
// values, in core's order (packages/core/src/partners/types.ts and markets/types.ts). The labels are the Recruitment app's.

export const TARGET_CUSTOMER_TYPE_LABELS = { enterprise: 'Enterprise', smb: 'SMB', unknown: 'Unknown' } as const;
export const CLOSED_LABELS = { not_now: 'Not now', no: 'No' } as const;
export const SOURCE_LABELS = {
  research: 'Research', ai_search: 'AI search', competitor_of: 'Competitor of', existing_partner: 'Existing partner',
} as const;
export const PERSON_ROLE_LABELS = { contact: 'Contact', sponsor: 'Sponsor', seller: 'Seller' } as const;
export const CALL_KIND_LABELS = { discovery: 'Discovery', follow_up: 'Follow-up' } as const;
export const CASO_ANSWER_LABELS = { yes: 'Yes', partly: 'Partly', no: 'No' } as const;

export const MARKET_STATUS_LABELS = {
  open: 'Open', validated: 'Validated', partly_validated: 'Partly validated', invalidated: 'Invalidated',
} as const;
export const HOW_MARKET_BUYS_LABELS = {
  customer_first: 'Customer first', capability_first: 'Capability first', unknown: 'Unknown',
} as const;
export const VALUE_KIND_LABELS = {
  margin_or_fees: 'Margin or fees', services_revenue: 'Services revenue', portfolio: 'Portfolio', non_financial: 'Non-financial',
} as const;
export const VALUE_STATE_LABELS = { assumption: 'Assumption', confirmed: 'Confirmed', dropped: 'Dropped' } as const;
export const HYPOTHESIS_STATUS_LABELS = { draft: 'Draft', holds: 'Holds', dropped: 'Dropped' } as const;
export const CHANGE_ENTITY_LABELS = {
  market: 'Market hypothesis', value_point: 'Value point', hypothesis: 'Partner hypothesis',
} as const;
/** A partner type's level in its program, as the Partners tab writes it. On screen a level shows the program's own name for it. */
export const LEVEL_LABELS = { reg: 'Registered', pref: 'Preferred' } as const;
/** A MAP's health (core's `Health`), as the Partners tab writes it next to each partner type. */
export const MAP_HEALTH_LABELS = { on_track: 'On track', at_risk: 'At risk', off_track: 'Off track' } as const;

// A MAP's lists, as its sheet writes them: the MAP app's words. Keys are core's values, in core's order (packages/core/src/maps/types.ts).
export const MAP_SIDE_LABELS = { us: 'Us', partner: 'Partner' } as const;
export const MAP_ACTIVITY_SIDE_LABELS = { us: 'Us', partner: 'Partner', joint: 'Joint' } as const;
export const MAP_CATEGORY_LABELS = { sales: 'Sales', marketing: 'Marketing', product: 'Product', other: 'Other' } as const;
export const MAP_ACTIVITY_STATUS_LABELS = {
  not_started: 'Not started', in_progress: 'In progress', blocked: 'Blocked', done: 'Done', na: 'N/A',
} as const;
export const MAP_ROLE_LABELS = {
  exec_sponsor: 'Executive Sponsor', partner_manager: 'Partner Manager', sales_lead: 'Sales Lead', marketing_lead: 'Marketing Lead',
  technical_lead: 'Technical Lead', other: 'Other',
} as const;
export const MAP_EXIT_STATUS_LABELS = { ok: 'OK', watch: 'Watch', triggered: 'Triggered' } as const;
