import { describe, expect, it } from 'vitest';
import { COPY } from './copy';
import {
  GUIDE_DIAGRAM_IDS,
  GUIDE_WIDE_DIAGRAMS,
  GUIDE_INTRO,
  GUIDE_PAGES,
  GUIDE_PLACES,
  GUIDE_QUESTIONS,
  GUIDE_SECTIONS,
  GUIDE_SECTION_IDS,
  guideNames,
  partLines,
  ui,
  type GuideSection,
} from './guide';
import { EVALUATION_LABEL, FOUR_C_LABELS, LINKS, MAP_LEARN_MORE, STAGE_LABELS, STEP_LABELS, VIEW_LABELS } from '@partner-desk/method';
import { CLOSED_LABELS, HYPOTHESIS_STATUS_LABELS, MARKET_STATUS_LABELS } from './option-labels';

const strongs = (s: string) => [...s.matchAll(/\*\*(.+?)\*\*/g)].map((m) => m[1]!);
const texts = (s: GuideSection) => [s.why, ...s.steps, ...s.appDoes, ...(s.parts ?? []).flatMap(partLines)];
const questionTexts = () => GUIDE_QUESTIONS.flatMap((q) => [q.question, q.answer]);

describe('the How it works guide', () => {
  it('has its sections in the spec order, each id once', () => {
    expect(GUIDE_SECTIONS.map((s) => s.id)).toEqual([...GUIDE_SECTION_IDS]);
  });

  it('every name the guide shows is one the app uses', () => {
    const names = guideNames();
    for (const s of GUIDE_SECTIONS) {
      for (const t of texts(s)) for (const n of strongs(t)) expect(names.has(n), `${s.id}: ${n}`).toBe(true);
      for (const w of s.where) for (const n of w.trail) expect(names.has(n), `${s.id}: ${n}`).toBe(true);
    }
    for (const t of questionTexts()) for (const n of strongs(t)) expect(names.has(n), `questions: ${n}`).toBe(true);
  });

  it('links only to the hub pages the app already uses', () => {
    const hub = new Set([...Object.values(LINKS), ...Object.values(MAP_LEARN_MORE)]);
    for (const s of GUIDE_SECTIONS) if (s.hub) expect(hub.has(s.hub), s.id).toBe(true);
  });

  it('gives every section a why, a where and at least one step, except the idea and the questions', () => {
    for (const s of GUIDE_SECTIONS) {
      expect(s.title.trim(), s.id).not.toBe('');
      expect(s.why.trim(), s.id).not.toBe('');
      if (s.id === 'the-idea' || s.id === 'questions') continue;
      expect(s.where.length, s.id).toBeGreaterThan(0);
      expect(s.steps.length + (s.parts?.length ?? 0), s.id).toBeGreaterThan(0);
    }
  });

  it('never says candidate, and never says to write the partner hypothesis only after the call', () => {
    for (const s of GUIDE_SECTIONS) {
      for (const t of [s.title, ...texts(s)]) {
        expect(t).not.toMatch(/candidate/i);
        expect(t).not.toMatch(/(write|written)[^.]*partner hypothesis[^.]*after/i);
      }
    }
    for (const t of questionTexts()) {
      expect(t).not.toMatch(/candidate/i);
      expect(t).not.toMatch(/(write|written)[^.]*partner hypothesis[^.]*after/i);
    }
  });

  it('asks nothing bigger than a short paragraph', () => {
    for (const s of GUIDE_SECTIONS) for (const t of texts(s)) expect(t.length, s.id).toBeLessThanOrEqual(400);
    for (const t of questionTexts()) expect(t.length, t.slice(0, 40)).toBeLessThanOrEqual(400);
  });

  it('answers at least the questions the spec lists, in the questions section, which has no steps', () => {
    const section = GUIDE_SECTIONS.find((s) => s.id === 'questions');
    expect(section?.steps).toEqual([]);
    expect(section?.where).toEqual([]);
    const asked = GUIDE_QUESTIONS.map((q) => q.question).join(' ');
    // Spec section 5, item 18, and the plan: closed or exited, undo a signing, correct an exit, files, a hand edit, Delete account.
    for (const topic of [/closed/i, /exited/i, /undo/i, /exit date/i, /files/i, /by hand/i, new RegExp(COPY.SETTINGS_DELETE)]) {
      expect(asked).toMatch(topic);
    }
    for (const q of GUIDE_QUESTIONS) {
      expect(q.question.trim().endsWith('?'), q.question).toBe(true);
      expect(q.answer.trim(), q.question).not.toBe('');
    }
  });

  it('says the files are the app’s database: don’t edit, move or delete them, except an admin', () => {
    const faq = GUIDE_QUESTIONS.find((q) => /by hand/i.test(q.question));
    expect(faq?.answer).toContain('Only an admin who knows what a change does should edit, move or delete its files.');
    const overview = GUIDE_SECTIONS.find((s) => s.id === 'the-idea')!.appDoes.join('\n');
    expect(overview).toContain('don’t edit, move or delete them in Drive');
  });

  it('links onboarding and reviews to their hub pages', () => {
    expect(GUIDE_SECTIONS.find((s) => s.id === 'onboarding')?.hub).toBe(MAP_LEARN_MORE.onboarding);
    expect(GUIDE_SECTIONS.find((s) => s.id === 'reviews')?.hub).toBe(MAP_LEARN_MORE.lifecycle);
  });

  it('starts each Where line with the name of the page it links to', () => {
    const pageNames: Record<(typeof GUIDE_PAGES)[number], string> = {
      '/this-week': COPY.NAV_THIS_WEEK,
      '/partners': COPY.NAV_PARTNERS,
      '/markets': COPY.NAV_MARKETS,
      '/programs': COPY.NAV_PROGRAMS,
      '/business-cases': COPY.NAV_BUSINESS_CASES,
      '/plans': COPY.NAV_PLANS,
      '/reviews': COPY.NAV_REVIEWS,
      '/call-guide': COPY.NAV_CALL_GUIDE,
      '/company-facts': COPY.NAV_COMPANY_FACTS,
      '/settings': COPY.NAV_SETTINGS,
    };
    for (const s of GUIDE_SECTIONS) for (const w of s.where) expect(w.trail[0], s.id).toBe(pageNames[w.page]);
  });

  it('draws the account, the markets feeding a program, how a partner ends and a MAP over time, with known diagrams only', () => {
    expect(GUIDE_SECTIONS.find((s) => s.id === 'the-idea')?.diagram).toBe('account');
    expect(GUIDE_SECTIONS.find((s) => s.id === 'programs')?.diagram).toBe('marketsFeedProgram');
    expect(GUIDE_SECTIONS.find((s) => s.id === 'closing')?.diagram).toBe('howItEnds');
    expect(GUIDE_SECTIONS.find((s) => s.id === 'reviews')?.diagram).toBe('mapOverTime');
    for (const s of GUIDE_SECTIONS) if (s.diagram) expect(GUIDE_DIAGRAM_IDS, s.id).toContain(s.diagram);
  });

  it('the guide names the third level and has a proposals line in each of the five sections', () => {
    const section = (id: string) => GUIDE_SECTIONS.find((s) => s.id === id)!;
    // Agents and the API: the third level by its name on screen, and what a proposal is (agent proposals spec 10.4).
    const agents = texts(section('agents')).join('\n');
    expect(agents).toContain(ui(COPY.AGENT_LEVEL_PROPOSE));
    expect(agents).toContain('A proposal is a decision an agent asks you to make');
    for (const name of [COPY.PROPOSAL_ACCEPT, COPY.PROPOSAL_ACCEPT_SOME, COPY.PROPOSAL_REJECT]) expect(agents).toContain(ui(name));
    expect(agents).toMatch(/30 days/);
    // One line each on proposals there, in the places the screens show them.
    const one = (id: string) => {
      const lines = texts(section(id)).filter((t) => /proposal/i.test(t));
      expect(lines, id).toHaveLength(1);
      return lines[0]!;
    };
    expect(one('this-week')).toContain(ui(COPY.WEEK_PROPOSALS));
    expect(one('this-week')).toContain(ui(COPY.PROPOSAL_SHOW));
    expect(one('qualification')).toContain('desk check');
    expect(one('markets')).toContain(ui(COPY.PROPOSAL_REVIEW_COMPANIES));
    expect(one('signing')).toContain(ui(COPY.MARK_SIGNED));
    expect(one('closing')).toContain(ui(COPY.CLOSE_PARTNER));
  });

  it('opens with two sentences', () => {
    expect(GUIDE_INTRO.match(/[.!?](\s|$)/g)).toHaveLength(2);
  });

  it('marks a name with ui(), and knows the app’s labels and its places', () => {
    expect(ui(COPY.MARK_SIGNED)).toBe('**Mark signed**');
    const names = guideNames();
    for (const label of [
      COPY.MARK_SIGNED, STAGE_LABELS.growth, STEP_LABELS.discovery_call, VIEW_LABELS.closed, EVALUATION_LABEL, CLOSED_LABELS.not_now,
      MARKET_STATUS_LABELS.validated, HYPOTHESIS_STATUS_LABELS.holds, FOUR_C_LABELS.customerBase,
    ]) {
      expect(names.has(label), label).toBe(true);
    }
    for (const place of Object.values(GUIDE_PLACES)) {
      expect(names.has(place), place).toBe(true);
      // A description, never a button's name: it starts in lowercase ("its MAP" keeps the app's short name).
      expect(place.slice(0, 1)).toBe(place.slice(0, 1).toLowerCase());
    }
    expect(names.has('Mark as signed')).toBe(false);
  });

  it('Agents and the API is told in six parts with two wide pictures (owner, 2026-11-14)', () => {
    const agents = GUIDE_SECTIONS.find((s) => s.id === 'agents')!;
    expect(agents.why).toMatch(/^Desk Agent is not an AI inside PartnerStandard Desk\. It is how the Desk shows any assistant or tool you connect/);
    expect(agents.parts?.map((p) => p.heading)).toEqual([
      'The big picture', 'How you connect a helper', 'What a helper may do', 'The path of a proposal', 'Which name shows where', 'Turning a helper off',
    ]);
    expect(agents.parts?.flatMap((p) => (p.diagram ? [p.diagram] : []))).toEqual(['agentsMap', 'proposalPath']);
    expect(GUIDE_WIDE_DIAGRAMS).toEqual(['agentsMap', 'proposalPath']);
    for (const part of agents.parts ?? []) for (const line of partLines(part)) expect(line.length, line.slice(0, 40)).toBeLessThanOrEqual(400);
  });
});
