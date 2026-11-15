/**
 * Search prompt templates (spec section 3.4). Task 9 fills the {{placeholders}}.
 *
 * Placeholders, both kinds:
 *   {{companyName}} {{ourProduct}} {{ourTargetCustomers}} {{marketName}} {{partnerType}}
 *   {{whyPartnerRoute}} {{mustHaves}} {{howMarketBuys}} {{statement}}
 *   {{leaveOut}}        the "leave out" list: partners in this market, exclusions, and "no" with reasons
 *   {{outputColumns}}   the exact table columns, joined with " | "
 * Hypothesis kind only:
 *   {{lookalike}} {{theirSide}} {{examples}}
 *
 * Optional parts sit on their own line, so Task 9 can drop the whole line when the value is empty:
 *   {{statement}}, {{howMarketBuys}}, {{lookalike}}, {{theirSide}}, {{examples}}.
 */

const COMMON_HEAD = `# Find partners

## About us
- Company: {{companyName}}
- Product: {{ourProduct}}
- Target customers: {{ourTargetCustomers}}

## The market
- Market: {{marketName}}
- Partner type: {{partnerType}}
- Why the partner route works: {{whyPartnerRoute}}
- Must-haves for a partner:
{{mustHaves}}
- How the market buys: {{howMarketBuys}}
- Statement: {{statement}}
`;

const COMMON_TAIL = `
## Leave out
Do not list any of these companies. They are already on our list as this partner type, or excluded.
{{leaveOut}}

## Desk check help
For each company you find, note the public evidence on:
- Customer base: who their customers are, and how much they overlap with our target customers.
- Credibility: how close their portfolio is to ours, and whether customers would believe the combination.
- Capability: whether they already sell or deliver in the way this partner type needs.

Commitment cannot be judged from public information, so leave it out. Do not give scores.

## Honesty rules
- List only companies that exist.
- Give a source link for each company.
- Say when you are unsure.
- Never invent a company, a website, a fact or a source.

## Output
Answer with one Markdown table and exactly these columns:

{{outputColumns}}

Put one company on each row. Use one line for each cell.

Also give the same companies as a CSV file named partners.csv, so it can be imported into PartnerStandard Desk. Use the same columns in the same order, with the column names as the first row, a comma between cells and every cell in double quotes. If you cannot create files, put the CSV in a code block after the table instead.

## How many
Give at least 5 companies and at most 25, unless the market is small. Fewer is a valid answer: if only a few companies exist, list only those.
`;

const MARKET_TASK = `
## Your task
Find companies in this market that meet the must-haves above.
`;

const HYPOTHESIS_TASK = `
## Your task
We have already spoken with a company in this market. Find companies like it that also meet the must-haves above.

- Companies like this one: {{lookalike}}
- Their side of the hypothesis: {{theirSide}}
- Examples of companies we have spoken with:
{{examples}}
`;

export const PROMPT_TEMPLATE: { market: string; hypothesis: string } = {
  market: COMMON_HEAD + MARKET_TASK + COMMON_TAIL,
  hypothesis: COMMON_HEAD + HYPOTHESIS_TASK + COMMON_TAIL,
};
