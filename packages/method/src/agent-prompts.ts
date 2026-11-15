// What PartnerStandard Desk's MCP server tells an agent (spec 5.5): its instructions, three prompts and three resources. Method
// content, so it lives here with the method's own license. Tool names in the texts are the agent tools' names.
import { CALL_GUIDE, TOPICS } from './call-guide';
import { FOUR_C, FOUR_C_LEVELS } from './four-c';
import { RECRUITMENT_STEPS, STAGES, STAGE_LABELS, STEP_LABELS } from './stages';

export type AgentPromptName = 'after_discovery_call' | 'prepare_business_review' | 'weekly_review';

export interface AgentPrompt {
  name: AgentPromptName;
  title: string;
  description: string;
  /** The prompt's arguments, all optional text. */
  args: string[];
  text: (args: Record<string, string>) => string;
}

export interface AgentResource {
  uri: string;
  name: string;
  title: string;
  description: string;
  mimeType: 'text/markdown';
  text: string;
}

/** The server's instructions: what PartnerStandard Desk is, that decisions are the person's, where guides and KPIs live. */
export const AGENT_INSTRUCTIONS = [
  'PartnerStandard Desk is where a partner manager runs each partner from the first idea to exit: the partners and their stages, '
    + 'markets with their partner hypotheses, partner programs, business cases, Mutual Action Plans (MAPs) and business reviews. '
    + 'You act in the name of the person who connected you, on their own work only.',
  'Read tools are always allowed. Change tools, when the person allowed them, make small changes: log a call, update a '
    + 'partner\'s facts and contacts, a MAP activity or milestone, a review\'s prep, a market\'s texts, a business case or the '
    + 'company facts. Send the expectedUpdatedAt you read with a change. When the answer is a conflict, read again before you '
    + 'change anything. Calculation tools work out a business case, a program\'s cost, a 4C recommendation or a MAP\'s health '
    + 'from what you send, and store nothing.',
  'Decisions are the person\'s: moving a stage or a step, signing, closing, exit, 4C scores, whether a partner hypothesis holds '
    + 'or a market is validated, sharing, sending and deleting. Suggest them with your reasons, and let the person make them in '
    + 'PartnerStandard Desk.',
  'When the person allowed proposing, the propose tools make some of these decisions a proposal: 4C scores, a step or stage, '
    + 'closing, signing, new partners, and a hypothesis\'s or a market\'s status. Each proposal waits for the person, who accepts '
    + 'or rejects it in PartnerStandard Desk; nothing changes before. 4C scores are always desk check scores: the confirmed check and '
    + 'moving into Exit stay the person\'s alone. Read list_proposals before you propose again: a new proposal of yours for the '
    + 'same target replaces the one that waits.',
  'For the partnership method, guides and KPIs, use the PartnerStandard Knowledge Hub\'s own MCP server. The resources here hold '
    + 'only the stage names, the four Cs and the discovery call\'s six topics.',
].join('\n\n');

/** An argument as given, or `fallback` when it is missing or blank. */
const arg = (args: Record<string, string>, key: string, fallback: string): string => args[key]?.trim() || fallback;

export const AGENT_PROMPTS: ReadonlyArray<AgentPrompt> = [
  {
    name: 'after_discovery_call',
    title: 'After a discovery call',
    description: 'Log a discovery call on the partner\'s page, then suggest or propose what it means for the partner hypothesis and the 4C.',
    args: ['partner'],
    text: (args) => [
      `I had a discovery call with ${arg(args, 'partner', 'a partner')}. Find my notes from the call, for example in Granola.`,
      'Find the partner with list_partners and get_partner, then log the call with log_call, kind discovery, with the notes as '
        + 'they are: notes under the six topic headings go into the topics, the rest goes to Other notes.',
      'Then read the partner hypothesis of its market with get_market. Tell me whether the call supports it, and which 4C scores '
        + 'the call suggests, each with a reason from the notes.',
      'If you can propose, propose those desk check scores with propose_4c_scores, each letter with its evidence from the notes, '
        + 'and the hypothesis\'s status with propose_hypothesis_status if the call settles it. I accept or reject them in PartnerStandard Desk.',
      'Don\'t change the hypothesis, the scores or the stage yourself: I decide those in PartnerStandard Desk.',
    ].join('\n\n'),
  },
  {
    name: 'prepare_business_review',
    title: 'Prepare the business review for a partner',
    description: 'Read the MAP, the business case and the last review, then fill the prep of the coming business review.',
    args: ['partner'],
    text: (args) => [
      `Prepare the business review for ${arg(args, 'partner', 'my partner')}.`,
      'Find its MAP with list_maps and read it with get_map. Read its business case with list_cases and get_case, and the coming '
        + 'review with get_review (list_reviews shows the held ones, with what was agreed last time).',
      'Then fill the prep with prepare_review: a reason for each activity of the horizon that isn\'t done, the numbers you can '
        + 'back up, the blockers, and commitments for the next horizon, each with its side. Send only what the MAP, the case or '
        + 'my notes support.',
      'Tell me what you filled and what is still open. Don\'t hold the review: I do that with the partner.',
    ].join('\n\n'),
  },
  {
    name: 'weekly_review',
    title: 'Weekly review',
    description: 'Read This week and list what needs the partner manager, most urgent first.',
    args: [],
    text: () => [
      'Run my weekly review. Read This week with this_week.',
      'List what needs me, most urgent first, one line each with what to do next: business reviews coming up, partnerships '
        + 'that need attention, MAP activities due, and partners waiting in recruitment. Use get_map or get_partner when a line '
        + 'needs more.',
      'Change nothing.',
    ].join('\n\n'),
  },
];

const stagesText = [
  '# Stages',
  'A partner moves through five stages. Every company is a partner from the day it is added; only its stage and step change.',
  ...STAGES.map((s, i) => {
    const line = `${i + 1}. ${STAGE_LABELS[s]} (\`${s}\`)`;
    if (s !== 'recruitment') return line;
    return `${line}, in four steps: ${RECRUITMENT_STEPS.map((step) => `${STEP_LABELS[step]} (\`${step}\`)`).join(', ')}.`;
  }),
  'Moving a stage or a step, signing, closing and exit are the person\'s decisions in PartnerStandard Desk.',
].join('\n\n');

const fourCsText = [
  '# The four Cs',
  'Each C is scored from 0 to 3. A partner has two sets of scores: the desk check, from research before the first call, and '
    + 'the confirmed check, after talking with the partner. A 0 on any C means skip at the desk and stop once confirmed. The scores are the person\'s to set.',
  ...FOUR_C.map((c) => [
    `## ${FOUR_C_LEVELS[c].label} (\`${c}\`)`,
    ...FOUR_C_LEVELS[c].levels.map((text, score) => `- ${score}: ${text}`),
  ].join('\n')),
].join('\n\n');

const callTopicsText = [
  '# The discovery call\'s six topics',
  'The discovery call is for learning, not selling or qualifying. log_call sorts notes under these headings into the six '
    + 'topics; text under any other heading goes to Other notes.',
  ...TOPICS.map((t) => [
    `## ${CALL_GUIDE[t].title}`,
    `What to learn: ${CALL_GUIDE[t].learn}`,
    'Questions:',
    ...CALL_GUIDE[t].questions.map((q) => `- ${q}`),
  ].join('\n')),
].join('\n\n');

/** Read-only method resources. Guides and KPIs stay with the Knowledge Hub's own MCP server. */
export const AGENT_RESOURCES: ReadonlyArray<AgentResource> = [
  {
    uri: 'partnerdesk://method/stages', name: 'stages', title: 'Stages and steps', mimeType: 'text/markdown',
    description: 'The five stages of a partnership and the four steps of recruitment, with the ids the tools use.',
    text: stagesText,
  },
  {
    uri: 'partnerdesk://method/four-cs', name: 'four-cs', title: 'The four Cs', mimeType: 'text/markdown',
    description: 'Customer base, credibility, capability and commitment, with what each score from 0 to 3 means.',
    text: fourCsText,
  },
  {
    uri: 'partnerdesk://method/call-topics', name: 'call-topics', title: 'Discovery call topics', mimeType: 'text/markdown',
    description: 'The six topics of the discovery call, what to learn and what to ask, as log_call sorts notes into them.',
    text: callTopicsText,
  },
];
