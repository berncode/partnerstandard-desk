// The How it works guide: its text, as data.
// The app's own words, under AGPL 3.0 like the code (spec 2026-11-07 §13.3); the method it explains is in
// @partner-desk/method. Every name of a button, tab, page or label comes from the app's own words
// (COPY, the stage, step and view labels, and the lists the app shows), marked with ui(), so a renamed button renames itself here.
import { COPY, copyFor } from './copy';
import { EVALUATION_LABEL, FOUR_C_LABELS, LINKS, MAP_LEARN_MORE, PARTNER_TYPE_LABELS, STAGE_LABELS, STEP_LABELS, VIEW_LABELS } from '@partner-desk/method';
import { CLOSED_LABELS, HYPOTHESIS_STATUS_LABELS, MARKET_STATUS_LABELS } from './option-labels';

/** The app's pages a guide link can open: the sidebar's, since the guide knows no partner, market or MAP id. */
export const GUIDE_PAGES = [
  '/this-week', '/partners', '/markets', '/programs', '/business-cases', '/plans', '/reviews', '/call-guide', '/company-facts', '/settings',
] as const;
export type GuidePage = (typeof GUIDE_PAGES)[number];

/** Places in a Where line that are a thing you pick, not a button: written in lowercase, never a button's name. */
export const GUIDE_PLACES = {
  partner: 'the partner',
  partnerType: 'its partner type',
  market: 'your market',
  program: 'your program',
  plan: 'its MAP',
  review: 'the review',
  businessCase: 'the case',
} as const;

/** A name as the app shows it, marked for the guide's renderer (bold) and for the test that it is the app's. */
export const ui = (label: string): string => `**${label}**`;

export const GUIDE_DIAGRAM_IDS = ['journey', 'account', 'marketsFeedProgram', 'mapOverTime', 'howItEnds', 'agentsMap', 'proposalPath'] as const;
/** The pictures wider than a phone: each scrolls sideways inside its own frame, never the page. */
export const GUIDE_WIDE_DIAGRAMS: readonly GuideDiagramId[] = ['agentsMap', 'proposalPath'];
export type GuideDiagramId = (typeof GUIDE_DIAGRAM_IDS)[number];

/** "Partners › the partner › Mark signed": the first part names `page` and links to it. */
export interface GuideWhere {
  page: GuidePage;
  trail: string[];
}

export interface GuideSection {
  id: string;
  title: string;
  /** One or two sentences: what it's for. */
  why: string;
  /** A Knowledge Hub page, from LINKS or MAP_LEARN_MORE. */
  hub?: string;
  where: GuideWhere[];
  /** Numbered, one action each. */
  steps: string[];
  appDoes: string[];
  diagram?: GuideDiagramId;
  /**
   * A section told in parts, each under its own small heading, after the why and the where (Agents and the API, owner
   * 2026-11-14). Its steps and app-does lists may then be empty.
   */
  parts?: GuidePart[];
}

/** One part of a section: lines, numbered steps in cards, a table, a picture, in that order. */
export interface GuidePart {
  heading: string;
  lines?: string[];
  groups?: { title: string; steps: string[]; note?: string }[];
  table?: { head: string[]; rows: string[][] };
  diagram?: GuideDiagramId;
}

/** Every line a reader reads in a part, for the checks and the company server's swaps. */
export const partLines = (part: GuidePart): string[] => [
  part.heading,
  ...(part.lines ?? []),
  ...(part.groups ?? []).flatMap((g) => [g.title, ...g.steps, ...(g.note ? [g.note] : [])]),
  ...(part.table ? [...part.table.head, ...part.table.rows.flat()] : []),
];

/** The sections, in the spec's order (section 5, 1 to 18), with Agents and the API before the questions (plan 10 built them). */
export const GUIDE_SECTION_IDS = [
  'the-idea', 'set-up', 'markets', 'programs', 'researched', 'discovery-call', 'qualification', 'map', 'business-cases',
  'signing', 'closing', 'onboarding', 'reviews', 'expansion', 'exit', 'this-week', 'your-partner', 'agents', 'questions',
] as const;
export type GuideSectionId = (typeof GUIDE_SECTION_IDS)[number];

/** A hub page the app links to already. A key typed wrong fails when the module loads, so in every test. */
function hub(url: string | undefined): string {
  if (!url) throw new Error('A guide section names a hub page the app has no link for.');
  return url;
}

const P = GUIDE_PLACES;
const S = STAGE_LABELS;
const T = STEP_LABELS;

export const GUIDE_INTRO =
  'PartnerStandard Desk is one place to run each partner, from the first idea to exit. Every company is a partner from the day you add it, and only its stage and step change after that.';

export const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: 'the-idea',
    title: 'The idea in two minutes',
    why: `One company is one account, with a part for each way you work with it, like ${COPY.PARTNER_AS_TYPE('Acme', PARTNER_TYPE_LABELS.reseller)}. `
      + 'Each partner type has its own stage, markets, program, MAP and business cases.',
    where: [],
    steps: [],
    appDoes: [
      `Each partner type moves through the stages ${ui(S.recruitment)}, ${ui(S.onboarding)}, ${ui(S.growth)}, ${ui(S.expansion)} and ${ui(S.exit)}. `
        + `${ui(S.recruitment)} has four steps: ${ui(T.researched)}, ${ui(T.discovery_call)}, ${ui(T.qualification)} and ${ui(T.map)}.`,
      `After signing, a review closes each horizon of the MAP and plans the next one. That loop is ${EVALUATION_LABEL}.`,
      'You decide every move. The app gives advice before a step and offers the next move, but it never makes one for you.',
      'Your work lives in your own Google Drive, in the folder PartnerStandard / PartnerStandard Desk. Those files are the app’s database: '
        + 'work in the app, share through its links, and don’t edit, move or delete them in Drive.',
    ],
    diagram: 'account',
  },
  {
    id: 'set-up',
    title: 'Set up once',
    why: `Two pages hold what the rest of the app uses: ${ui(COPY.NAV_SETTINGS)} for your company and account, and ${ui(COPY.NAV_COMPANY_FACTS)} for the facts every business case and program starts from. `
      + 'Fill them in once, and change them when things change.',
    where: [
      { page: '/settings', trail: [COPY.NAV_SETTINGS] },
      { page: '/company-facts', trail: [COPY.NAV_COMPANY_FACTS] },
    ],
    steps: [
      `Open ${ui(COPY.NAV_SETTINGS)}, fill in ${ui(COPY.SETTINGS_COMPANY_FIELD)} and click ${ui(COPY.SAVE)}. The search prompts name your company with it, and both sides see it on a MAP.`,
      `Set your ${ui(COPY.SETTINGS_TIME_ZONE)} and click ${ui(COPY.SETTINGS_TIME_ZONE_SAVE)}. Reminders and digests go out at 8:00 in it.`,
      `Under ${ui(COPY.SETTINGS_EMAILS)}, choose which emails you get.`,
      `Open ${ui(COPY.NAV_COMPANY_FACTS)} and fill in ${ui(COPY.FACTS_CUSTOMER)}, ${ui(COPY.FACTS_DIRECT)}, ${ui(COPY.FACTS_DEALS)} and ${ui(COPY.FACTS_OURS)}.`,
    ],
    appDoes: [
      `A new business case and a program start from ${ui(COPY.NAV_COMPANY_FACTS)}. ${ui(COPY.FACTS_OURS)} stays internal and never reaches a partner.`,
      `${ui(COPY.SETTINGS_STORAGE)} shows where your files are: the folder PartnerStandard / PartnerStandard Desk in your Google Drive.`,
      `${ui(COPY.SETTINGS_DELETE)} removes your account, your company name and your list of files from PartnerStandard Desk. Your spreadsheets stay in your Google Drive.`,
    ],
  },
  {
    id: 'markets',
    title: 'Markets and hypotheses',
    why: 'A market is one country or region and one partner type. Its market hypothesis says why partners will sell there, and its partner hypotheses say who to look for. '
      + 'Your calls test both, so they keep changing.',
    hub: hub(LINKS.marketHypothesisVsPartnerHypothesis),
    where: [
      { page: '/markets', trail: [COPY.NAV_MARKETS, COPY.NEW_MARKET] },
      { page: '/markets', trail: [COPY.NAV_MARKETS, P.market, COPY.TAB_HYPOTHESES] },
    ],
    steps: [
      `On ${ui(COPY.NAV_MARKETS)}, click ${ui(COPY.NEW_MARKET)} and answer four short steps. Or click ${ui(COPY.COPY_FROM_ANOTHER_MARKET)} to start from one you have; every copied item is marked to check again.`,
      `On ${ui(COPY.TAB_MARKET_HYPOTHESIS)}, write which market and why partners will sell there. Set ${ui(COPY.STATUS_TITLE)} to ${ui(MARKET_STATUS_LABELS.validated)} or ${ui(MARKET_STATUS_LABELS.invalidated)} as your calls back it or not.`,
      `On ${ui(COPY.TAB_VALUE)}, add what partners get from selling your product with ${ui(COPY.ADD_VALUE_POINT)}. Each point starts as an assumption; calls confirm it or drop it.`,
      `On ${ui(COPY.TAB_HYPOTHESES)}, click ${ui(COPY.ADD_HYPOTHESIS)} for each kind of partner you look for, and fill in ${ui(COPY.THEIR_SIDE)}, ${ui(COPY.OUR_SIDE)}, the value points that matter and ${ui(COPY.COMPANIES_LIKE)}. `
        + 'Each one grows before, during and after your calls.',
      `On ${ui(COPY.TAB_MARKET_HYPOTHESIS)}, under ${ui(COPY.FIND_WITH_AI)}, click ${ui(COPY.COPY_SEARCH_PROMPT)} and paste the prompt into ChatGPT, Claude or Gemini. Bring the answer back on ${ui(COPY.TAB_PIPELINE)} with ${ui(COPY.IMPORT_AI_RESULTS)}.`,
      `Click ${ui(COPY.EXCLUSIONS)}, then ${ui(COPY.ADD_COMPANY)} for each company to leave out of searches and imports. With more than one market, ${ui(COPY.IMPORT_FROM_MARKET)} adds another market’s list.`,
      `Read ${ui(COPY.TAB_CHANGES)} to see how your thinking moved. In the week after a call, changing a hypothesis or a value point asks what changed and why.`,
    ],
    appDoes: [
      'Each market is a spreadsheet in the folder PartnerStandard / PartnerStandard Desk.',
      'The search prompt lists your partners of this type and the market’s exclusions, so the AI leaves them out.',
      `Each partner hypothesis on ${ui(COPY.TAB_HYPOTHESES)} has its own search prompt, with its linked partners as examples, to find more companies like them.`,
      `An agent may propose new partners, or the status of the market or a partner hypothesis. A proposal of new partners waits on ${ui(COPY.TAB_PIPELINE)}: ${ui(COPY.PROPOSAL_REVIEW_COMPANIES)} opens the import preview with duplicates and exclusions marked. A status waits at the top of the market, or on its hypothesis on ${ui(COPY.TAB_HYPOTHESES)}.`,
    ],
  },
  {
    id: 'programs',
    title: COPY.NAV_PROGRAMS,
    why: 'A program is what you offer the partners of one type: why they join, the levels and the money. Markets feed programs: when a partner from a market signs, the app proposes the program that market feeds.',
    where: [
      { page: '/programs', trail: [COPY.NAV_PROGRAMS, COPY.NAV_ADD_PROGRAM] },
      { page: '/markets', trail: [COPY.NAV_MARKETS, P.market, COPY.TAB_MARKET_HYPOTHESIS, COPY.FEEDS_PROGRAM] },
    ],
    steps: [
      `On ${ui(COPY.NAV_PROGRAMS)}, click ${ui(COPY.NAV_ADD_PROGRAM)} and pick the partner type. You can run several programs for one type, for example one per region.`,
      `If you have a program of that type, or a market of that type with a partner hypothesis at ${ui(HYPOTHESIS_STATUS_LABELS.holds)}, choose how to start: ${ui(COPY.PROG_START_FRESH)}, a copy, or the market. If not, the program starts fresh at once.`,
      `Work through ${ui(COPY.PROG_STEP_WHY)}, ${ui(COPY.PROG_STEP_BASICS)}, the two levels and ${ui(COPY.PROG_STEP_MONEY)}. The first level is ${ui(COPY.PROG_START_LEVEL)}: every partner who signs starts there, and a higher level is up to you.`,
      `Open ${ui(COPY.PROG_SHEET_TITLE)} to see the program on one page, and ${ui(COPY.PROG_DOWNLOAD_PDF)} if you need it as a file. ${ui(COPY.PROG_PUBLIC_TITLE)} is a first draft of the program’s page for your website.`,
      `On each market of that type, set ${ui(COPY.FEEDS_PROGRAM)} on its ${ui(COPY.TAB_MARKET_HYPOTHESIS)} tab.`,
    ],
    appDoes: [
      'Starting from a market fills in the ideal partner from its partner hypothesis that holds, the ideal customer, the reasons to join from the value points your calls confirmed, and the focus. That market then feeds the program.',
      'A box at the top of every program page shows how many partners are at each level and which markets feed it.',
      'When you mark a partner signed, the app proposes the program its market feeds. The partner joins at the starting level.',
      `Each program is a spreadsheet in the folder PartnerStandard / PartnerStandard Desk. The ${ui(COPY.PROG_SHEET_TITLE)} and the public page are tabs in it.`,
    ],
    diagram: 'marketsFeedProgram',
  },
  {
    id: 'researched',
    title: `${S.recruitment}: ${T.researched}`,
    why: `${ui(T.researched)} is the first step: a company you want to look at as a partner. Add it, then look at what you can see from outside before any call.`,
    hub: hub(LINKS.partnerRecruitment),
    where: [
      { page: '/partners', trail: [COPY.NAV_PARTNERS, COPY.ADD_PARTNER] },
      { page: '/markets', trail: [COPY.NAV_MARKETS, P.market, COPY.TAB_PIPELINE, COPY.ADD_PARTNER] },
      { page: '/partners', trail: [COPY.NAV_PARTNERS, P.partner, COPY.ADD_PARTNER_TYPE] },
    ],
    steps: [
      `On ${ui(COPY.NAV_PARTNERS)}, click ${ui(COPY.ADD_PARTNER)}. Fill in the company and its ${ui(COPY.FIELD_PARTNER_TYPE)}, and pick a market if you have one. ${ui(COPY.FIELD_WHERE)} starts at ${ui(T.researched)}.`,
      `Or add it from a market: on ${ui(COPY.TAB_PIPELINE)}, click ${ui(COPY.ADD_PARTNER)}, or bring in the search prompt’s answer with ${ui(COPY.IMPORT_AI_RESULTS)}.`,
      `For a company you already work with, pick its stage under ${ui(COPY.WHERE_GROUP_WORKING)} and fill in ${ui(COPY.FIELD_SIGNED_ON)}.`,
      `On the partner’s page, score what you can see from outside in the ${ui(COPY.DESK_TITLE)}. ${ui(FOUR_C_LABELS.commitment)} usually stays empty until you talk.`,
      `To work with the same company in another way, open it and click ${ui(COPY.ADD_PARTNER_TYPE)}.`,
    ],
    appDoes: [
      'If you add a company you already have with another partner type, the app adds that type to the same account.',
      'If the company is already a partner of that type, or on the market’s exclusions, the app tells you before it adds anything.',
    ],
  },
  {
    id: 'discovery-call',
    title: `${S.recruitment}: ${T.discovery_call}`,
    why: 'A discovery call is for learning, not for selling. What you learn feeds the partner hypothesis, which you started before the call and keep refining.',
    where: [
      { page: '/call-guide', trail: [COPY.NAV_CALL_GUIDE] },
      { page: '/partners', trail: [COPY.NAV_PARTNERS, P.partner, P.partnerType, COPY.LOG_CALL] },
    ],
    steps: [
      `Before the call, open ${ui(COPY.NAV_CALL_GUIDE)} for the six topics and the questions to ask.`,
      `On the partner’s page, under ${ui(COPY.CALLS_TITLE)}, click ${ui(COPY.LOG_CALL)} and set the date and the kind of call.`,
      `Write what you learned under each topic. Or paste your notes into ${ui(COPY.PASTE_NOTES)} and click ${ui(COPY.SORT_INTO_TOPICS)}.`,
      `Read what landed under each topic and fix it, then click ${ui(COPY.SAVE_CALL)}.`,
      `After the first discovery call of a partner at ${ui(T.researched)}, the app offers ${ui(COPY.MOVE_TO_DISCOVERY_CALL)}. Click it, or ${ui(COPY.KEEP_IN_RESEARCHED)}.`,
      `Under ${ui(COPY.HYPOTHESIS_TITLE)}, pick the market’s hypothesis this partner matches, or click ${ui(COPY.WRITE_FROM_CALL)} for a new draft. Then ${ui(COPY.EDIT_HYPOTHESIS)} opens it on the market.`,
    ],
    appDoes: [
      `A partner hypothesis lives in a market. If the partner is in none yet, add it with ${ui(COPY.ADD_TO_MARKET)} under ${ui(COPY.MARKETS_TITLE)}.`,
      `${ui(COPY.WRITE_FROM_CALL)} adds a draft to the market and links it to this partner.`,
      `On the market’s ${ui(COPY.TAB_HYPOTHESES)} tab, the editor shows the call notes of the linked partners. ${ui(COPY.USE_AS_EVIDENCE)} adds a note as evidence for their side or ours.`,
    ],
  },
  {
    id: 'qualification',
    title: `${S.recruitment}: ${T.qualification}`,
    why: 'Qualification checks the partner against the four Cs again, with what you learned on the call. The app’s advice before a move never blocks it: you decide.',
    hub: hub(LINKS.qualifyingChannelPartnersWith4c),
    where: [
      { page: '/partners', trail: [COPY.NAV_PARTNERS, P.partner, P.partnerType, COPY.QUALIFICATION_TITLE] },
    ],
    steps: [
      `In the stepper at the top of the partner type, click ${ui(T.qualification)}.`,
      `If none of its linked partner hypotheses is at ${ui(HYPOTHESIS_STATUS_LABELS.holds)} yet, the app advises you to finish one first. Click ${ui(COPY.GO_AHEAD_ANYWAY)} or ${ui(COPY.CANCEL)}.`,
      `Under ${ui(COPY.QUALIFICATION_TITLE)}, score the four Cs again (${ui(FOUR_C_LABELS.customerBase)}, ${ui(FOUR_C_LABELS.credibility)}, ${ui(FOUR_C_LABELS.capability)} and ${ui(FOUR_C_LABELS.commitment)}), with a line of evidence for each.`,
      `Answer the ${ui(COPY.QUESTIONS_TITLE)} if they help. They are optional.`,
      `Read the recommendation, then click ${ui(COPY.PROCEED_TO_MAP)}, or close the partner with ${ui(CLOSED_LABELS.not_now)} or ${ui(CLOSED_LABELS.no)}.`,
    ],
    appDoes: [
      'Before the move to MAP, the app checks that all four Cs are scored and that the recommendation is to go ahead. If not, it says why, and you decide.',
      `The number of active sellers is counted from ${ui(COPY.PEOPLE_TITLE)} on the partner’s page.`,
      `An agent may propose desk check scores, also after a call, with evidence for each letter. The proposal waits in the desk check: ${ui(COPY.PROPOSAL_ACCEPT)}, ${ui(COPY.PROPOSAL_ACCEPT_SOME)} or ${ui(COPY.PROPOSAL_REJECT)}. A proposed step shows the stepper’s advice first, when it has some. The confirmed check stays yours alone.`,
    ],
  },
  {
    id: 'map',
    title: `${S.recruitment}: ${T.map}`,
    why: 'The Mutual Action Plan is the plan both sides agree: objectives, named people, activities and dates. Agree it as early as possible, ideally before the agreement is signed.',
    hub: hub(MAP_LEARN_MORE.map),
    where: [
      { page: '/partners', trail: [COPY.NAV_PARTNERS, P.partner, P.partnerType, COPY.START_MAP] },
      { page: '/plans', trail: [COPY.NAV_PLANS, P.plan, COPY.MAP_SHARE] },
    ],
    steps: [
      `After ${ui(COPY.PROCEED_TO_MAP)}, click ${ui(COPY.START_MAP_NOW)}. Or, from the ${ui(T.map)} step on, click ${ui(COPY.START_MAP)} under ${ui(COPY.MAP_TITLE)}.`,
      `Walk through the guided steps: ${ui(COPY.GUIDED_STEP_NAMES.partner)}, ${ui(COPY.GUIDED_STEP_NAMES.objectives)}, ${ui(COPY.GUIDED_STEP_NAMES.people)}, ${ui(COPY.GUIDED_STEP_NAMES.activities)} and ${ui(COPY.GUIDED_STEP_NAMES.milestones)}.`,
      `In ${ui(COPY.GUIDED_STEP_NAMES.people)}, type each person’s name and pick their role, under your company and under the partner, and click ${ui(COPY.GUIDED_ADD)}. Name an executive sponsor on each side.`,
      `Click ${ui(COPY.GUIDED_SAVE)}.`,
      `On the MAP, under ${ui(COPY.MAP_PEOPLE)}, click ${ui(COPY.MAP_ADD_EMAIL)} for each person. Links and reminders need it.`,
      `Click ${ui(COPY.MAP_SHARE)}. Each person gets their own link and edits their side, with no account. Use ${ui(COPY.MAP_COPY_LINK)}, or ${ui(COPY.MAP_SEND_LINK)} when the app can send email.`,
      `When both sides agree the MAP, answer ${ui(COPY.YES)} under ${ui(COPY.MAP_TITLE)} on the partner’s page.`,
    ],
    appDoes: [
      'Before signing, the MAP plans horizon 1, which starts the day the agreement is signed.',
      'If you mark a partner signed before the MAP is agreed, the app advises against it. You can still go ahead.',
      `${ui(COPY.NAV_PLANS)} in the sidebar lists every MAP, with the ones that need attention first.`,
      'Each MAP is a spreadsheet in the folder PartnerStandard / PartnerStandard Desk.',
    ],
  },
  {
    id: 'business-cases',
    title: COPY.NAV_BUSINESS_CASES,
    why: 'A business case shows on one page what the partner earns with you and what you get, over five years. Make one before you agree terms, and share the partner’s side with them.',
    where: [
      { page: '/partners', trail: [COPY.NAV_PARTNERS, P.partner, P.partnerType, COPY.NEW_CASE] },
      { page: '/business-cases', trail: [COPY.NAV_BUSINESS_CASES, COPY.NEW_CASE] },
    ],
    steps: [
      `On the partner’s page, under ${ui(COPY.CASE_AREA_TITLE)}, click ${ui(COPY.NEW_CASE)}. Or, on ${ui(COPY.NAV_BUSINESS_CASES)}, click ${ui(COPY.NEW_CASE)}, pick the partner and its type, and click ${ui(COPY.NEW_CASE_ACTION)}.`,
      'The case uses the program its partner type is in, or the one its market feeds. If neither says, the app asks you to pick one.',
      'On the first tab, the offer to the partner, set the products and the partner’s terms.',
      `Read ${ui(COPY.CASE_PARTNER_TAB_TITLE)} for what the partner gets, and ${ui(COPY.CASE_OURS_TAB_TITLE)} for what it is worth to you. ${ui(COPY.CASE_OURS_TAB_TITLE)} is internal.`,
      'On the last tab, share a link with the partner, or download the one-pager as a PDF.',
    ],
    appDoes: [
      `A case starts from ${ui(COPY.NAV_COMPANY_FACTS)} and the program of its partner type.`,
      `A case keeps its numbers until you update it. ${ui(COPY.CASE_UPDATE)}, on the offer tab, fills them in again.`,
      'You can make as many cases as you like for a partner type, at any stage, one for each idea you talk through.',
      'The partner’s link shows their side only, as it is now. Each case is a spreadsheet in the folder PartnerStandard / PartnerStandard Desk.',
    ],
  },
  {
    id: 'signing',
    title: 'Signing',
    why: 'Signing the agreement ends Recruitment. The partner moves to Onboarding, joins the program you pick, and horizon 1 of its MAP starts that day.',
    where: [
      { page: '/partners', trail: [COPY.NAV_PARTNERS, P.partner, P.partnerType, COPY.MARK_SIGNED] },
    ],
    steps: [
      `On the partner’s page, open its partner type and click ${ui(COPY.MARK_SIGNED)} under the stepper.`,
      `Fill in ${ui(COPY.FIELD_DATE_SIGNED)}. It starts at today.`,
      `Under ${ui(COPY.FIELD_PROGRAM)}, keep the program the app proposes or pick another. It proposes the program the partner’s market feeds.`,
      'If the date signed differs from the MAP’s planned start, a box offers to move its open activities and milestones by the same number of days, so the plan keeps its timing. Leave it checked to move them.',
      `Click ${ui(COPY.MARK_SIGNED)}. If the MAP isn’t agreed yet, the app advises against signing first: click ${ui(COPY.GO_AHEAD_ANYWAY)} or ${ui(COPY.CANCEL)}.`,
      `Signed by mistake? Click ${ui(COPY.UNDO_SIGNING)}, then ${ui(COPY.UNDO_SIGNING)} again to confirm.`,
    ],
    appDoes: [
      `The partner type moves to ${ui(S.onboarding)}, and on ${ui(COPY.NAV_PARTNERS)} from ${ui(VIEW_LABELS.potential)} to ${ui(VIEW_LABELS.active)}.`,
      'Horizon 1 of its MAP starts on the date signed.',
      `The partner joins the program at its starting level. You can change its ${ui(COPY.FIELD_LEVEL)} on the partner’s page later.`,
      `From now on the stage moves one at a time on the stepper, back or forward, but never back to ${ui(S.recruitment)}.`,
      `${ui(COPY.UNDO_SIGNING)} takes the partner back to ${ui(S.recruitment)}, step ${ui(T.map)}, and clears the date. Calls and the MAP stay. After an exit, a signing can’t be undone.`,
      `An agent may propose signing, with the date. The proposal waits under the stepper, and ${ui(COPY.PROPOSAL_ACCEPT)} opens this same dialog with the date filled in: answer its questions and click ${ui(COPY.MARK_SIGNED)}.`,
    ],
  },
  {
    id: 'closing',
    title: 'Closing before signing',
    why: 'Not every partner signs. Closing ends the work before signing and keeps everything, so you can pick it up again later.',
    where: [
      { page: '/partners', trail: [COPY.NAV_PARTNERS, P.partner, P.partnerType, COPY.CLOSE_PARTNER] },
      { page: '/partners', trail: [COPY.NAV_PARTNERS, VIEW_LABELS.closed, P.partner, COPY.REOPEN] },
    ],
    steps: [
      `On the partner type, click ${ui(COPY.CLOSE_PARTNER)} under the stepper.`,
      `Choose ${ui(CLOSED_LABELS.not_now)} for a fit that isn’t ready, or ${ui(CLOSED_LABELS.no)} for one that isn’t a fit. Write the ${ui(COPY.FIELD_REASON)}.`,
      `Click ${ui(COPY.CLOSE_PARTNER)}.`,
      `To pick it up again, find it under ${ui(VIEW_LABELS.closed)} on ${ui(COPY.NAV_PARTNERS)}, open it and click ${ui(COPY.REOPEN)}. It is back at the step where you closed it.`,
    ],
    appDoes: [
      `A closed partner keeps its step, calls, MAP and cases. ${ui(CLOSED_LABELS.no)} also leaves the company out of future search prompts.`,
      `Only a partner that hasn’t signed can be closed. A signed one ends with ${ui(COPY.MARK_EXITED)}.`,
      `Removing a partner type is different: the remove button under the stepper takes that type out of ${ui(COPY.NAV_PARTNERS)}, and with the company’s last type, the company and its contacts too. `
        + 'You choose whether its cases and MAP go to the Drive trash or stay in Drive; either way their links stop working. To stop working with a partner, close it or exit it.',
      `An agent may propose closing, as ${ui(CLOSED_LABELS.not_now)} or ${ui(CLOSED_LABELS.no)} with its reason. The proposal waits under the stepper, and ${ui(COPY.PROPOSAL_ACCEPT)} opens the close dialog filled in: check it and click ${ui(COPY.CLOSE_PARTNER)}.`,
    ],
    diagram: 'howItEnds',
  },
  {
    id: 'onboarding',
    title: S.onboarding,
    why: 'Onboarding gets the partner ready to sell: training done, the first customer engagement, the first deal. Horizon 1 of the MAP plans it, from the day the agreement is signed.',
    hub: hub(MAP_LEARN_MORE.onboarding),
    where: [
      { page: '/partners', trail: [COPY.NAV_PARTNERS, P.partner, P.partnerType, COPY.OPEN_MAP] },
      { page: '/plans', trail: [COPY.NAV_PLANS, P.plan, COPY.MAP_NOTIFY] },
    ],
    steps: [
      `On the partner type, under ${ui(COPY.MAP_TITLE)}, click ${ui(COPY.OPEN_MAP)}.`,
      `Work through its ${ui(COPY.MAP_ACTIVITIES)} with the partner. Each one has one owner and a date; update its status as it moves.`,
      `Click ${ui(COPY.MAP_NOTIFY)} to set this MAP’s emails: ${ui(COPY.MAP_NOTIFY_REMIND)}, ${ui(COPY.MAP_NOTIFY_ALERTS)} and ${ui(COPY.MAP_NOTIFY_PARTNER_DIGEST)}. Then click ${ui(COPY.SAVE)}.`,
      `On ${ui(COPY.NAV_PARTNERS)}, the ${ui(COPY.COLUMN_MAP_HEALTH)} column shows how each MAP is going and its next milestone. Click ${ui(COPY.SORT_BY_MAP_HEALTH)} to see the ones that need you first.`,
    ],
    appDoes: [
      'Horizon 1 runs the length picked when the MAP was made: 90 days, unless you picked 30, 60, 120 or 180. Until signing, you can change it at the top of the MAP.',
      'Activity owners with an email get a reminder before an activity is due, and weekly while it is overdue. You get an email when someone changes the MAP through their link.',
      `Each Monday you get one email with your MAPs’ news: done, due, overdue and blocked. Choose your emails under ${ui(COPY.SETTINGS_EMAILS)} in ${ui(COPY.NAV_SETTINGS)}.`,
    ],
  },
  {
    id: 'reviews',
    title: `${S.growth} and business reviews`,
    why: `A business review closes each horizon of the MAP: what was done, what it brought, and what comes next. That loop is ${EVALUATION_LABEL}, and it runs for as long as the partnership does.`,
    hub: hub(MAP_LEARN_MORE.lifecycle),
    where: [
      { page: '/reviews', trail: [COPY.NAV_REVIEWS, P.review] },
      { page: '/partners', trail: [COPY.NAV_PARTNERS, P.partner, P.partnerType, COPY.MAP_PREPARE_REVIEW] },
    ],
    steps: [
      `Three weeks before a horizon ends, its review comes up. Click ${ui(COPY.MAP_PREPARE_REVIEW)} under ${ui(COPY.REVIEW_AREA_TITLE)} on the partner type, or open it from ${ui(COPY.NAV_REVIEWS)} in the sidebar.`,
      `Check the ${ui(COPY.REVIEW_DATE)}, then click ${ui(COPY.REVIEW_START_PREP)}. The prep fills itself from the MAP, the business case and the last review.`,
      `Under ${ui(COPY.REVIEW_AREA_RESULTS)}, fill in the ${ui(COPY.REVIEW_SCORECARD)}: what happened against the targets. Say why each activity that isn’t done isn’t.`,
      `Under ${ui(COPY.REVIEW_AREA_HYPOTHESIS)}, answer ${ui(COPY.REVIEW_ANSWER_LABELS.holds)}, ${ui(COPY.REVIEW_ANSWER_LABELS.changed)} or ${ui(COPY.REVIEW_ANSWER_LABELS.doesnt_hold)} for each partner hypothesis.`,
      `Under ${ui(COPY.REVIEW_AREA_NEXT)}, click ${ui(COPY.REVIEW_ADD_COMMITMENT)} for each thing either side will do, with a side and a due date, and set the ${ui(COPY.REVIEW_TARGETS_NEXT)}.`,
      `Under ${ui(COPY.REVIEW_AREA_BLOCKERS)}, click ${ui(COPY.REVIEW_ADD_BLOCKER)} for what stands in the way. ${ui(COPY.REVIEW_MAKE_COMMITMENT)} turns one into a commitment.`,
      `Under ${ui(COPY.REVIEW_AREA_RELATIONSHIP)}, score how likely they are to recommend you and note how it is going.`,
      `Under ${ui(COPY.REVIEW_DECISIONS)}, write anything else you agreed, and pick the next horizon’s length.`,
      `Click ${ui(COPY.REVIEW_CLOSE)}, check the ${ui(COPY.REVIEW_HELD_ON_LABEL)} date and click ${ui(COPY.REVIEW_CLOSE)} again. Then ${ui(COPY.REVIEW_SUMMARY_SEND)} sends the partner a summary.`,
    ],
    appDoes: [
      `Closing the review, in one step: it is marked held on the ${ui(COPY.REVIEW_HELD_ON_LABEL)} date, the next horizon starts that day, each commitment becomes an activity in the MAP, and the next review is set to the new horizon’s last day.`,
      `The first review closes onboarding, and the app offers to move the partner to ${ui(S.growth)}. Follow the offer and click ${ui(S.growth)} on the stepper. The stage never changes by itself.`,
      `On the partner type, ${ui(COPY.REVIEW_AREA_TITLE)} lists the held reviews and, when there is a business case, compares the results since signing with it.`,
    ],
    diagram: 'mapOverTime',
  },
  {
    id: 'expansion',
    title: S.expansion,
    why: 'Expansion grows a partnership that works: more of what you sell together, another way of working together, or new markets. Agree each step with a business case.',
    where: [
      { page: '/partners', trail: [COPY.NAV_PARTNERS, P.partner, P.partnerType, COPY.NEW_CASE] },
      { page: '/partners', trail: [COPY.NAV_PARTNERS, P.partner, COPY.ADD_PARTNER_TYPE] },
      { page: '/markets', trail: [COPY.NAV_MARKETS, P.market, COPY.TAB_MARKET_HYPOTHESIS, COPY.FEEDS_PROGRAM] },
    ],
    steps: [
      `When you start to grow the partnership, move the stage to ${ui(S.expansion)} on the stepper.`,
      `Make a business case for the idea: under ${ui(COPY.CASE_AREA_TITLE)}, click ${ui(COPY.NEW_CASE)}.`,
      `To work with the company in another way, click ${ui(COPY.ADD_PARTNER_TYPE)}, pick the type and answer ${ui(COPY.FIELD_WHERE)}. It gets its own stage, MAP and cases.`,
      `To take the partner into another market, pick it in ${ui(COPY.ADD_TO_MARKET)} under ${ui(COPY.MARKETS_TITLE)} on the partner type, and click ${ui(COPY.ADD)}.`,
      `To open a new region for the same program, make a market of that partner type and set its ${ui(COPY.FEEDS_PROGRAM)} to that program.`,
    ],
    appDoes: [
      'A box at the top of the program page shows which markets feed it and how many partners are at each level.',
      `A partner can move up a level: change its ${ui(COPY.FIELD_LEVEL)} on the partner’s page.`,
    ],
  },
  {
    id: 'exit',
    title: S.exit,
    why: 'Some partnerships end: the market changes, or it stops working for one side. Mark the exit, so the record shows when and why, and take what you learned back to your hypotheses.',
    where: [
      { page: '/partners', trail: [COPY.NAV_PARTNERS, P.partner, P.partnerType, COPY.MARK_EXITED] },
    ],
    steps: [
      `While the exit is under way, you can move the stage to ${ui(S.exit)} on the stepper, one stage at a time.`,
      `Click ${ui(COPY.MARK_EXITED)}, fill in the ${ui(COPY.FIELD_EXIT_DATE)} and the ${ui(COPY.FIELD_REASON)}, and click ${ui(COPY.MARK_EXITED)}.`,
      `Wrong date or reason? Click ${ui(COPY.CORRECT_EXIT)}, change them and click ${ui(COPY.CORRECT_EXIT)}.`,
      `Open the partner’s market and, on ${ui(COPY.TAB_HYPOTHESES)}, change the partner hypothesis with what you learned.`,
    ],
    appDoes: [
      `The partner moves to ${ui(VIEW_LABELS.closed)} on ${ui(COPY.NAV_PARTNERS)} and keeps its record: calls, MAP, cases and reviews.`,
      `Its MAP drops off ${ui(COPY.NAV_THIS_WEEK)}, and the partner gets no more weekly copies of it.`,
      'An exit date can’t be before the signing. After an exit, the signing can’t be undone, only the exit corrected.',
    ],
  },
  {
    id: 'this-week',
    title: `Every day: ${COPY.NAV_THIS_WEEK}`,
    why: `${ui(COPY.NAV_THIS_WEEK)} is the first page after you sign in. It gathers what needs you across your partners, Monday to Sunday, so you don’t have to open each one.`,
    where: [
      { page: '/this-week', trail: [COPY.NAV_THIS_WEEK] },
      { page: '/partners', trail: [COPY.NAV_PARTNERS] },
    ],
    steps: [
      `Open ${ui(COPY.NAV_THIS_WEEK)} and work down its four lists: ${ui(COPY.WEEK_REVIEWS)}, ${ui(COPY.WEEK_NEED)}, ${ui(COPY.WEEK_DUE)} and ${ui(COPY.WEEK_WAITING)}.`,
      `Click ${ui(COPY.WEEK_MARK_DONE)} next to an activity you finished.`,
      `On ${ui(COPY.NAV_PARTNERS)}, switch between ${ui(VIEW_LABELS.potential)} (in Recruitment), ${ui(VIEW_LABELS.active)} (signed) and ${ui(VIEW_LABELS.closed)} (closed or exited).`,
      `Filter by partner type, market, program or stage, and switch between ${ui(COPY.LAYOUT_LIST)} and ${ui(COPY.LAYOUT_BOARD)}. In the list, ${ui(COPY.SORT_BY_MAP_HEALTH)} puts the partners that need you first.`,
    ],
    appDoes: [
      `${ui(COPY.WEEK_REVIEWS)}: a review due in the next three weeks or overdue, and a held review whose summary isn’t sent two days later.`,
      `${ui(COPY.WEEK_NEED)}: a MAP that is at risk or off track, an exit trigger to watch, or a MAP whose health changed since Monday’s email.`,
      `${ui(COPY.WEEK_DUE)}: open activities on your side or joint ones, due by Sunday or overdue.`,
      `${ui(COPY.WEEK_WAITING)}: a partner whose step hasn’t moved for 14 days, or one at ${ui(T.map)} whose MAP isn’t agreed yet.`,
      `${ui(COPY.WEEK_PROPOSALS)}, first when any wait: each proposal your agents made, with ${ui(COPY.PROPOSAL_ACCEPT)}, ${ui(COPY.PROPOSAL_REJECT)} and ${ui(COPY.PROPOSAL_SHOW)}. ${ui(COPY.PROPOSAL_SHOW)} opens the page it changes, where you answer one that needs a dialog or advice. The sidebar shows how many wait beside ${ui(COPY.NAV_THIS_WEEK)}.`,
    ],
  },
  {
    id: 'your-partner',
    title: 'What your partner sees',
    why: 'Your partner never needs an account. They see what you share through a link, and you decide who gets which.',
    where: [
      { page: '/plans', trail: [COPY.NAV_PLANS, P.plan, COPY.MAP_SHARE] },
      { page: '/reviews', trail: [COPY.NAV_REVIEWS, P.review, COPY.REVIEW_SUMMARY_SEND] },
      { page: '/business-cases', trail: [COPY.NAV_BUSINESS_CASES, P.businessCase] },
    ],
    steps: [
      `On the MAP, click ${ui(COPY.MAP_SHARE)}. Everyone in its People with an email, on either side, gets their own link. Use ${ui(COPY.MAP_COPY_LINK)}, or ${ui(COPY.MAP_SEND_LINK)} when the app can send email.`,
      `To turn one person’s link off, click ${ui(COPY.MAP_REVOKE)}, then ${ui(COPY.MAP_REMOVE_ACCESS)}.`,
      `On a held review, click ${ui(COPY.REVIEW_SUMMARY_SEND)}, check the people under ${ui(COPY.REVIEW_SUMMARY_TO)}, and check ${ui(COPY.REVIEW_SUMMARY_INCLUDE_SCORECARD)} only if they should see the numbers. Then click ${ui(COPY.REVIEW_SUMMARY_SEND)}.`,
      'On a business case’s last tab, share a link with the partner. There you can also stop sharing, or make a new link, which turns the old one off.',
    ],
    appDoes: [
      'The MAP link shows the whole MAP, and each person edits only their own side. It works until you revoke it, or until it goes unused for 90 days.',
      'The summary shows what was done and what wasn’t, the commitments, the blockers and the next review. The partner hypothesis, the decisions and the relationship note stay with you. Sending again turns the earlier link off.',
      'The case link shows only the partner’s side of the case, as it is now. Your side stays internal.',
      `A partner contact who owns an activity gets a reminder before it is due. The Monday copy of the MAP goes to them only if you check ${ui(COPY.MAP_NOTIFY_PARTNER_DIGEST)}.`,
    ],
  },
  {
    id: 'agents',
    title: 'Agents and the API',
    why: `${COPY.DESK_AGENT} is not an AI inside PartnerStandard Desk. It is how the Desk shows any assistant or tool you connect: Claude, ChatGPT, n8n or your own script. `
      + `You connect it, you choose what it may do, and what it does is saved as “${COPY.DESK_AGENT} for” your name. `
      + `Only ${ui(COPY.NAV_SETTINGS)} shows each one’s own name, so you can tell them apart and turn one off.`,
    where: [{ page: '/settings', trail: [COPY.NAV_SETTINGS, COPY.AGENTS_TITLE] }],
    steps: [],
    appDoes: [],
    parts: [
      {
        heading: 'The big picture',
        lines: [
          'Every helper comes in through the same door as you. The Desk checks who acts and what it may do before anything is read or saved. '
            + 'A webhook, if you add one, tells your own tool that something happened.',
        ],
        diagram: 'agentsMap',
      },
      {
        heading: 'How you connect a helper',
        groups: [
          {
            title: 'An AI assistant, like Claude or ChatGPT',
            steps: [
              `Under ${ui(COPY.AGENTS_TITLE)}, click ${ui(COPY.AGENTS_COPY_ADDRESS)}.`,
              'Add the address to your assistant as a connector.',
              `A PartnerStandard Desk page opens. Under ${ui(COPY.AGENT_ALLOW_LEVEL)}, pick what it may do (it offers only what your assistant asked for), then click ${ui(COPY.AGENT_ALLOW)}.`,
            ],
            note: 'Then ask your assistant, for example “Log my call with Brightwater” or “Which partners need me this week?”',
          },
          {
            title: 'A tool or script, like n8n, Zapier or Make',
            steps: [
              `Under ${ui(COPY.API_KEYS)}, click ${ui(COPY.API_KEY_CREATE)}, name the key and pick what it can do.`,
              `Click ${ui(COPY.API_KEY_CREATE)} again, then ${ui(COPY.API_KEY_COPY)} at once. It can’t be shown again.`,
              'Paste the key into the tool.',
            ],
            note: 'The key’s name is only for you, in Settings.',
          },
          {
            title: 'A notification, with a webhook',
            steps: [
              `Under ${ui(COPY.WEBHOOKS)}, click ${ui(COPY.WEBHOOK_ADD)} and enter your tool’s address.`,
              `Pick the events under ${ui(COPY.WEBHOOK_EVENTS_LABEL)}, click ${ui(COPY.WEBHOOK_ADD)} again, then ${ui(COPY.WEBHOOK_SECRET_COPY)}.`,
            ],
            note: 'Your tool uses the secret to check that a delivery came from PartnerStandard Desk. A webhook sends ids only, and only for what happens after you add it; your tool reads the details through the API, with a key.',
          },
        ],
      },
      {
        heading: 'What a helper may do',
        lines: [
          'You choose one of three levels when you connect it. People always decide: no helper can sign, close, move a stage or send anything to a partner.',
        ],
        table: {
          head: ['Level', 'It can', 'For example'],
          rows: [
            [ui(COPY.AGENT_LEVEL_READ), 'See your partners, markets, programs, cases, MAPs and reviews.', '“Summarize where Tallis Cloud stands.”'],
            [ui(COPY.AGENT_LEVEL_CHANGE), 'Also log calls, update MAP activities and fill in reviews.', '“Mark the webinar plan done.”'],
            [ui(COPY.AGENT_LEVEL_PROPOSE), 'Also propose decisions: 4C scores, a step or stage, closing, signing, new partners, or the status of a hypothesis or a market. Each one waits for you.', '“Move Ashgrove Data to Discovery call.”'],
          ],
        },
      },
      {
        heading: 'The path of a proposal',
        lines: [
          `A proposal is a decision an agent asks you to make. It waits on ${ui(COPY.NAV_THIS_WEEK)} and on the page it changes. Answer with ${ui(COPY.PROPOSAL_ACCEPT)}, ${ui(COPY.PROPOSAL_ACCEPT_SOME)} or ${ui(COPY.PROPOSAL_REJECT)}. Nothing changes before you answer.`,
          `What you accept is saved in your name, like “Ruth, proposed by ${COPY.DESK_AGENT}”. An agent proposes desk check scores only, and never a move into ${ui(S.exit)}. A proposal you don’t answer expires after 30 days.`,
          `An assistant you connected before keeps its level. To let it propose, remove it in the assistant, add it again and pick ${ui(COPY.AGENT_LEVEL_PROPOSE)}. If Settings then lists it twice, turn the older one off.`,
        ],
        diagram: 'proposalPath',
      },
      {
        heading: 'Which name shows where',
        table: {
          head: ['Where', 'What it says', 'Why'],
          rows: [
            ['A proposal’s card', `“${COPY.PROPOSAL_BY(COPY.DESK_AGENT)}”`, 'The work is your Desk Agent’s, working for you.'],
            ['Who changed something last', `“${COPY.DESK_AGENT} for Ruth”`, 'A helper did it, and for whom.'],
            ['After you accept', `“Ruth, proposed by ${COPY.DESK_AGENT}”`, 'You decided; the helper only suggested.'],
            [`${ui(COPY.NAV_SETTINGS)}, ${ui(COPY.AGENTS_TITLE)}`, 'Claude, n8n sync, Zapier', 'The real names, so you know which one to turn off.'],
          ],
        },
        lines: [`Everywhere except ${ui(COPY.NAV_SETTINGS)}, a helper shows as ${COPY.DESK_AGENT}. Behind the scenes the Desk still knows which tool made each proposal, so two helpers never replace each other’s proposals.`],
      },
      {
        heading: 'Turning a helper off',
        lines: [
          `Under ${ui(COPY.AGENTS_TITLE)}, click ${ui(COPY.TURN_OFF)} beside it. It stops at once. Your Google sign-in stays as it is.`,
          `Its waiting proposals stay, as “${COPY.PROPOSAL_BY_OFF(COPY.DESK_AGENT)}”, and you can still answer them.`,
        ],
      },
    ],
  },
  {
    id: 'questions',
    title: 'Questions people ask',
    why: 'Short answers to what people ask most.',
    where: [],
    steps: [],
    appDoes: [],
  },
];

/** A question and its answer, for the questions section. */
export interface GuideQuestion {
  question: string;
  answer: string;
}

/** The questions section's pairs ([builder's call]: the order, from what was unclear while building). */
export const GUIDE_QUESTIONS: GuideQuestion[] = [
  {
    question: 'Closed or exited: what is the difference?',
    answer: `A partner that never signed is closed, as ${ui(CLOSED_LABELS.not_now)} or ${ui(CLOSED_LABELS.no)}, and you can ${ui(COPY.REOPEN)} it. `
      + `A signed partner whose partnership ended is marked exited. Both show under ${ui(VIEW_LABELS.closed)} on ${ui(COPY.NAV_PARTNERS)} and keep their record.`,
  },
  {
    question: 'Can I undo a signing?',
    answer: `Yes, until the partner has exited. Click ${ui(COPY.UNDO_SIGNING)} on the partner type. It goes back to ${ui(S.recruitment)}, step ${ui(T.map)}, and its signed date is cleared. `
      + 'Calls and the MAP stay. After an exit you can only correct the exit.',
  },
  {
    question: 'I put in the wrong exit date. Can I fix it?',
    answer: `Yes. Click ${ui(COPY.CORRECT_EXIT)} on the partner type, change the ${ui(COPY.FIELD_EXIT_DATE)} or the ${ui(COPY.FIELD_REASON)}, and click ${ui(COPY.CORRECT_EXIT)}. `
      + 'The partner stays exited. The date can’t be before the signing.',
  },
  {
    question: 'Where are my files?',
    answer: 'In your Google Drive, in the folder PartnerStandard / PartnerStandard Desk: your partners, each market, MAP, business case and program are spreadsheets there. '
      + `${ui(COPY.SETTINGS_STORAGE)} in ${ui(COPY.NAV_SETTINGS)} shows it. Deleting a case, a MAP or a program in the app moves its file to the Drive trash, where you can restore it.`,
  },
  {
    question: 'What happens if I edit a sheet by hand?',
    // The owner's decisions of 2026-11-01 and 2026-11-03: the folder is the app's database; only an admin
    // changes its files. The tolerant reading below stays as protection. Row saves (Partners,
    // markets, most MAP rows) merge onto the row found by id; only whole-record saves (cases, programs) and MAP
    // activities refuse a row changed in the sheet.
    answer: 'Please don’t. The folder PartnerStandard / PartnerStandard Desk is the app’s database: work in the app, share through its links. Only an admin who knows what a change does should edit, move or delete its files. If a file is changed, the app re-reads it before it saves, changes only your rows and leaves rows it can’t read alone. A case, program or activity changed in the sheet asks you to refresh.',
  },
  {
    question: `What does ${COPY.SETTINGS_DELETE} remove?`,
    answer: `${ui(COPY.SETTINGS_DELETE)} in ${ui(COPY.NAV_SETTINGS)} removes your account, your company name and your list of files from PartnerStandard Desk, and every link you shared stops working. `
      + 'Your spreadsheets stay in your Google Drive.',
  },
  {
    question: `Why doesn’t ${COPY.SETTINGS_DELETE} sign me out of Google?`,
    answer: 'All PartnerStandard tools share one Google sign-in, and PartnerStandard Desk never takes it away, so the other tools keep working. '
      + `To remove that access, use ${ui(COPY.GOOGLE_CONNECTIONS_LINK)}, linked in ${ui(COPY.NAV_SETTINGS)}. That signs you out of the other PartnerStandard tools too.`,
  },
];

/**
 * The pictures in the guide (apps/web/src/guide/diagrams): the text alternative of each, and every word drawn in it. Stage, step and
 * button names come from the app's own words; the rest is new and goes on the Copy review. Each section says the same in its text.
 */
export const GUIDE_DIAGRAMS: Record<GuideDiagramId, { alt: string; labels: Record<string, string> }> = {
  journey: {
    alt: `The partner journey, from the first idea to exit. Three hypotheses come first: ${COPY.TAB_MARKET_HYPOTHESIS}, partner hypothesis and ${COPY.TAB_VALUE}. `
      + `Then ${S.recruitment}, with the steps ${T.researched}, ${T.discovery_call}, ${T.qualification} and ${T.map}, and Signed at the end. `
      + `After signing come ${S.onboarding}, ${S.growth}, ${EVALUATION_LABEL}, ${S.expansion} and ${S.exit}. ${EVALUATION_LABEL} is the review that closes each horizon and leads back to ${S.growth}. `
      + `A partner can be closed at any ${S.recruitment} step. Below, bars show what exists along the way: the hypotheses, programs, business cases, the MAP, the signing date and the reviews. After exit, lessons go back to the hypotheses.`,
    labels: {
      groupHypotheses: 'Hypotheses (in the market)',
      groupRecruitment: `Stage: ${S.recruitment}, with its steps`,
      groupAfter: 'Stages after signing',
      marketHypothesis: COPY.TAB_MARKET_HYPOTHESIS,
      partnerHypothesis: 'Partner hypothesis',
      valueProposition: COPY.TAB_VALUE,
      researched: T.researched,
      researchedSub: 'added',
      discoveryCall: T.discovery_call,
      qualification: T.qualification,
      qualificationSub: '4C',
      map: T.map,
      mapSub: 'agreed',
      signed: 'Signed',
      signedSub: `to ${S.onboarding}`,
      onboarding: S.onboarding,
      onboardingSub: 'horizon 1',
      growth: S.growth,
      evaluation: EVALUATION_LABEL,
      evaluationSub: 'review loop',
      expansion: S.expansion,
      exit: S.exit,
      loop: 'each horizon, leads back to Growth',
      closed: `Closed at any ${S.recruitment} step: “${CLOSED_LABELS.not_now}” or “${CLOSED_LABELS.no}”, with a reason`,
      existsTitle: 'What exists along the way',
      barHypotheses: 'Hypotheses and value proposition, refined all the way through',
      barProgramDraft: 'Program, a draft',
      barProgram: 'Program: the partner joins it, with a level, when it signs',
      barCase: 'Business case: one or more per partner type, each kept with its date (a new one for Expansion)',
      barMap: 'MAP: one per partner type, agreed before signing; horizon 1 starts at signing, then one horizon after another',
      barSigning: 'Signing date (the agreement itself stays outside PartnerStandard Desk)',
      barReviews: 'Reviews and scorecard: one at the end of each horizon',
      lessons: 'After exit, lessons go back to the hypotheses',
    },
  },
  agentsMap: {
    alt: `An AI assistant like Claude or ChatGPT comes in as a connector, and a tool or script like n8n with an API key. Both pass the Desk's checks first: `
      + `who acts, like “${COPY.DESK_AGENT} for Ruth”, whether the level you allowed lets it, that nothing is overwritten, and whether it is a decision, which waits for you. `
      + `Then your work is read or saved, and you see “${COPY.PROPOSAL_BY(COPY.DESK_AGENT)}” on a card and “${COPY.DESK_AGENT} for Ruth” in the history. A webhook tells your tool that something happened, with ids only.`,
    labels: {
      outside: 'OUTSIDE THE DESK',
      desk: 'PARTNERSTANDARD DESK',
      work: 'YOUR WORK',
      assistant: 'AI assistant',
      assistantSub: 'Claude, ChatGPT, Cursor',
      assistantHow: 'connects as a connector',
      tool: 'Tool or script',
      toolSub: 'n8n, Zapier or a script',
      toolHow: 'uses an API key',
      connector: 'connector',
      key: 'API key',
      door: 'The same door for everyone',
      doorSub: 'for you, the app and every helper',
      who: `1. Who acts? ${COPY.DESK_AGENT} for Ruth`,
      may: '2. May it? The level you allowed',
      fresh: '3. Up to date? Nothing is overwritten',
      decision: '4. A decision? It waits for you',
      reads: 'reads, saves',
      workTitle: 'Your partners',
      workSub: 'markets, MAPs, cases',
      see: 'What you see',
      seeCard: `This week: “${COPY.PROPOSAL_BY(COPY.DESK_AGENT)}”`,
      seeHistory: `History: “${COPY.DESK_AGENT} for Ruth”`,
      webhook: 'webhook: “partner.signed”, ids only',
    },
  },
  proposalPath: {
    alt: `A helper proposes, for example moving Ashgrove Data to Discovery call. It waits for you on This week and on the partner's page. `
      + `You accept, accept some or reject. Only an accept saves it, as “Ruth, proposed by ${COPY.DESK_AGENT}”. Not answered in 30 days, it expires and nothing changes.`,
    labels: {
      proposes: 'A helper proposes',
      proposesSub1: '“Ashgrove Data:',
      proposesSub2: 'step to Discovery call”',
      waits: 'It waits for you',
      waitsSub1: 'on This week and on',
      waitsSub2: 'the partner’s page',
      decide: 'You decide',
      decideSub1: `${COPY.PROPOSAL_ACCEPT}, ${COPY.PROPOSAL_ACCEPT_SOME}`,
      decideSub2: `or ${COPY.PROPOSAL_REJECT}`,
      accept: 'accept',
      saved: 'Saved',
      savedSub1: '“Ruth, proposed',
      savedSub2: `by ${COPY.DESK_AGENT}”`,
      expires: 'Not answered in 30 days: it expires, nothing changes.',
      reject: 'Reject: nothing changes, your note is kept.',
    },
  },
  account: {
    alt: `One company is one account, with a part for each partner type. Acme has ${COPY.PARTNER_AS_TYPE('Acme', PARTNER_TYPE_LABELS.reseller)} and ${COPY.PARTNER_AS_TYPE('Acme', PARTNER_TYPE_LABELS.technology)}. `
      + `Each part has its own stage, markets, program, MAP and business cases. In the example the reseller is in ${S.growth} and the technology partner is in ${S.recruitment}.`,
    labels: {
      account: 'Acme',
      accountSub: 'one company, one account',
      reseller: COPY.PARTNER_AS_TYPE('Acme', PARTNER_TYPE_LABELS.reseller),
      technology: COPY.PARTNER_AS_TYPE('Acme', PARTNER_TYPE_LABELS.technology),
      owns: 'Each part has its own:',
      resellerStage: `Stage: ${S.growth}`,
      technologyStage: `Stage: ${S.recruitment}`,
      markets: 'Markets',
      program: 'Program',
      map: T.map,
      cases: COPY.NAV_BUSINESS_CASES,
    },
  },
  marketsFeedProgram: {
    alt: `Two markets of one partner type, Reseller in the DACH region and Reseller in the Nordics, both feed one program. When a partner from either market signs, the app proposes that program, and the partner joins it at ${COPY.PROG_START_LEVEL.toLowerCase()}.`,
    labels: {
      marketOne: 'Reseller · DACH',
      marketTwo: 'Reseller · Nordics',
      marketKind: 'Market',
      feeds: COPY.FEEDS_PROGRAM,
      program: 'Reseller program',
      programKind: 'Program',
      partner: 'A partner from a market',
      signs: 'signs',
      joins: `joins at ${COPY.PROG_START_LEVEL.toLowerCase()}`,
    },
  },
  mapOverTime: {
    alt: `A MAP over time. Signing starts horizon 1. Each horizon is 90 days unless you pick another length. A business review closes each horizon, and its commitments become the next horizon’s activities. `
      + `The first review, at the end of horizon 1, offers the move from ${S.onboarding} to ${S.growth}.`,
    labels: {
      signing: 'Signing',
      horizon1: 'Horizon 1',
      horizon2: 'Horizon 2',
      horizon3: 'Horizon 3',
      review1: 'Review 1',
      review2: 'Review 2',
      review3: 'Review 3',
      commitments1: 'The commitments of a review',
      commitments2: 'become the next horizon’s activities',
      lengthNote: 'Each horizon is 90 days unless you pick another length.',
      firstReview: 'The first review offers the move',
      from: S.onboarding,
      to: S.growth,
    },
  },
  howItEnds: {
    alt: `How a partner ends. Before signing, ${COPY.CLOSE_PARTNER} closes it as “${CLOSED_LABELS.not_now}” or “${CLOSED_LABELS.no}”, and ${COPY.REOPEN} brings it back to the step where you closed it. `
      + `After signing, ${COPY.MARK_EXITED} moves it to ${S.exit}.`,
    labels: {
      before: 'Before signing',
      after: 'After signing',
      recruitment: S.recruitment,
      close: COPY.CLOSE_PARTNER,
      closed: VIEW_LABELS.closed,
      notNow: CLOSED_LABELS.not_now,
      no: CLOSED_LABELS.no,
      reopen: COPY.REOPEN,
      onboarding: S.onboarding,
      growth: S.growth,
      expansion: S.expansion,
      markExited: COPY.MARK_EXITED,
      exit: S.exit,
    },
  },
};

/**
 * Every name the guide may show: the app's own words where the work lives (a company server's on the database) and the
 * lists it shows, and the places of a Where line.
 */
export function guideNames(storage: 'google' | 'database' = 'google'): Set<string> {
  const names = new Set<string>();
  const collect = (value: unknown): void => {
    if (typeof value === 'string') names.add(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  [
    copyFor(storage), STAGE_LABELS, STEP_LABELS, VIEW_LABELS, EVALUATION_LABEL, CLOSED_LABELS, MARKET_STATUS_LABELS, HYPOTHESIS_STATUS_LABELS, FOUR_C_LABELS,
    GUIDE_PLACES,
  ].forEach(collect);
  return names;
}
