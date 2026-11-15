import { describe, expect, it } from 'vitest';
import { AGENT_INSTRUCTIONS, AGENT_PROMPTS, AGENT_RESOURCES } from './agent-prompts';
import { CALL_GUIDE, TOPICS } from './call-guide';
import { FOUR_C, FOUR_C_LEVELS } from './four-c';
import { RECRUITMENT_STEPS, STAGES, STAGE_LABELS, STEP_LABELS } from './stages';

/** Every text an agent reads: the instructions, each prompt with sample arguments, and each resource. */
function texts(): string[] {
  const out = [AGENT_INSTRUCTIONS];
  for (const p of AGENT_PROMPTS) {
    out.push(p.title, p.description, p.text(Object.fromEntries(p.args.map((a) => [a, `<${a}>`]))));
  }
  for (const r of AGENT_RESOURCES) out.push(r.name, r.title, r.description, r.text);
  return out;
}

describe('the agent prompts, instructions and resources', () => {
  it('AGENT_PROMPTS and AGENT_INSTRUCTIONS have no em dash and no "candidate"', () => {
    for (const t of texts()) {
      expect(t.includes('—'), t).toBe(false);
      expect(/candidate/i.test(t), t).toBe(false);
    }
  });

  it('are the three prompts of spec 5.5, each using its arguments', () => {
    expect(AGENT_PROMPTS.map((p) => p.name)).toEqual(['after_discovery_call', 'prepare_business_review', 'weekly_review']);
    for (const p of AGENT_PROMPTS) {
      const text = p.text(Object.fromEntries(p.args.map((a) => [a, `<${a}>`])));
      for (const a of p.args) expect(text).toContain(`<${a}>`);
      expect(text.length).toBeGreaterThan(50);
    }
  });

  it('a prompt without its argument still reads as a sentence', () => {
    for (const p of AGENT_PROMPTS) expect(p.text({})).not.toMatch(/undefined|<|>/);
  });

  it('the prompts name only tools an agent has, and leave decisions to the person', () => {
    const after = AGENT_PROMPTS.find((p) => p.name === 'after_discovery_call')!.text({ partner: 'Acme' });
    expect(after).toContain('log_call');
    expect(after).not.toMatch(/score_4c|move_stage|mark_signed/);
    expect(AGENT_PROMPTS.find((p) => p.name === 'prepare_business_review')!.text({ partner: 'Acme' })).toContain('prepare_review');
    expect(AGENT_PROMPTS.find((p) => p.name === 'weekly_review')!.text({})).toContain('this_week');
  });

  it('the instructions say what PartnerStandard Desk is, that decisions are the person\'s, and where guides and KPIs live', () => {
    expect(AGENT_INSTRUCTIONS).toContain('PartnerStandard Desk');
    expect(AGENT_INSTRUCTIONS).toMatch(/decisions/i);
    expect(AGENT_INSTRUCTIONS).toContain('Knowledge Hub');
    expect(AGENT_INSTRUCTIONS).toMatch(/KPI/);
  });

  it('the instructions say decisions are proposals the person answers, desk scores only, and to read list_proposals first', () => {
    expect(AGENT_INSTRUCTIONS).toMatch(/propose/);
    expect(AGENT_INSTRUCTIONS).toContain('desk check');
    expect(AGENT_INSTRUCTIONS).toContain('confirmed check');
    expect(AGENT_INSTRUCTIONS).toContain('list_proposals');
    const after = AGENT_PROMPTS.find((p) => p.name === 'after_discovery_call')!.text({ partner: 'Acme' });
    expect(after).toContain('propose_4c_scores');
    expect(after).toContain('desk check');
  });

  it('the resources hold the stages and steps, the four Cs with their texts, and the call topics', () => {
    expect(AGENT_RESOURCES.map((r) => r.uri)).toEqual([
      'partnerdesk://method/stages', 'partnerdesk://method/four-cs', 'partnerdesk://method/call-topics',
    ]);
    const [stages, fourCs, topics] = AGENT_RESOURCES.map((r) => r.text) as [string, string, string];
    for (const s of STAGES) expect(stages).toContain(STAGE_LABELS[s]);
    for (const s of RECRUITMENT_STEPS) expect(stages).toContain(STEP_LABELS[s]);
    for (const c of FOUR_C) for (const level of FOUR_C_LEVELS[c].levels) expect(fourCs).toContain(level);
    for (const t of TOPICS) {
      expect(topics).toContain(CALL_GUIDE[t].title);
      expect(topics).toContain(CALL_GUIDE[t].learn);
    }
    for (const r of AGENT_RESOURCES) expect(r.mimeType).toBe('text/markdown');
  });
});
