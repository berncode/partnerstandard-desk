import {
  confirmedRecommendation, costCheck, deskRecommendation, EXAMPLES, newCompanyFacts, newProgram, simulateCase, simulateOurCase, summarizeMap,
  type BusinessCase, type JoinedPlan,
} from '@partner-desk/core';
import { describe, expect, it } from 'vitest';
import type { Deps } from '../deps';
import { makeTestDeps } from '../testing';
import { agentContext } from './context';
import { AGENT_TOOLS, runTool, toolsFor } from './tools';

/** The parts of `Deps` a command could read or write (as in own-company.test.ts), and the companies. */
const WATCHED = [
  'partnerBooks', 'markets', 'programs', 'companyFacts', 'cases', 'maps', 'directory', 'shareLinks', 'reviewLinks', 'mapLinks',
  'mapSessions', 'mapEvents', 'rateLimits', 'events', 'companies',
] as const;

/** Deps whose stores and tables note every call. */
function watchedDeps() {
  const deps = makeTestDeps({ companies: { u_anna: 'co_aaaaaaaaaa' } });
  const calls: string[] = [];
  const watch = <T extends object>(target: T, name: string): T => new Proxy(target, {
    get(t, key, receiver) {
      const v = Reflect.get(t, key, receiver) as unknown;
      if (typeof v !== 'function') return v;
      return (...args: unknown[]) => { calls.push(`${name}.${String(key)}`); return (v as (...a: unknown[]) => unknown).apply(t, args); };
    },
  });
  const watched = { ...deps } as Deps;
  for (const name of WATCHED) (watched as unknown as Record<string, object>)[name] = watch(deps[name] as object, name);
  return { watched, calls };
}

/** What an agent sends: plain JSON. */
const json = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const CASE: BusinessCase = json(EXAMPLES.saas.case);
const FACTS = json({ ...newCompanyFacts('co_aaaaaaaaaa'), currency: 'EUR' as const, yearly: 18000, once: 6000, renew: 90, spend: 2600000, revenue: 6500000 });
const PROGRAM = json(newProgram('reseller', FACTS, { id: 'pg_aaaaaaaaaa', companyName: 'Halden' }));

/** A signed MAP with one activity 10 days overdue and one milestone coming up. */
function plan(): Pick<JoinedPlan, 'info' | 'activities' | 'milestones' | 'exitTriggers'> {
  return {
    info: {
      partnerName: 'Acme', partnerType: 'reseller', stage: 'onboarding', startDate: '2026-08-15', horizonDays: 90, nextReviewDate: null,
      pastHorizons: [], closed: null, closedReason: '',
    },
    activities: [{
      id: 'a1', title: 'Kickoff', category: 'other', side: 'joint', ownerId: null, dueDate: '2026-10-18', status: 'in_progress', completedDate: null,
      milestoneId: null, note: '', updatedAt: '2026-10-20T09:00:00.000Z', updatedBy: 'Anna',
    }],
    milestones: [{ id: 'm1', name: 'First deal', targetDate: '2026-11-20', criteria: '', achievedDate: null }],
    exitTriggers: [],
  };
}

const SAMPLES: Record<string, Record<string, unknown>> = {
  calculate_case: { case: CASE },
  check_program_cost: { companyFacts: FACTS, program: PROGRAM },
  recommend_4c: { desk: { customerBase: 2, credibility: 0 } },
  map_health: { ...plan(), today: '2026-10-28', lastProgressAt: '2026-10-25T09:00:00.000Z' },
};

describe('the calculation tools', () => {
  it('are the four of spec 5.4, at level calc, each POST /calc/<name>, listed at every level', () => {
    const calc = AGENT_TOOLS.filter((t) => t.level === 'calc');
    expect(calc.map((t) => t.name).sort()).toEqual(Object.keys(SAMPLES).sort());
    for (const t of calc) expect(t.rest).toEqual({ method: 'POST', path: `/calc/${t.name.replace(/_/g, '-')}` });
    for (const t of calc) expect(toolsFor('read')).toContain(t);
  });

  it('calc tools touch no store', async () => {
    const { watched, calls } = watchedDeps();
    const ctx = await agentContext(makeTestDeps({ companies: { u_anna: 'co_aaaaaaaaaa' } }), { userId: 'u_anna', displayName: 'Anna', agentName: 'Claude', level: 'read', via: { kind: 'app', clientId: 'c_claude' } });
    const blind = { ...ctx, deps: watched };
    for (const [name, input] of Object.entries(SAMPLES)) {
      const result = await runTool(blind, name, input);
      expect({ name, ok: result.ok }).toEqual({ name, ok: true });
    }
    expect(calls).toEqual([]);
  });

  it('calculate_case works out both sides as the Business case screens do', async () => {
    const ctx = await agentContext(makeTestDeps(), { userId: 'u_anna', displayName: 'Anna', agentName: 'Claude', level: 'read', via: { kind: 'app', clientId: 'c_claude' } });
    const partner = simulateCase(CASE);
    expect(await runTool(ctx, 'calculate_case', { case: CASE })).toEqual({ ok: true, value: { partner, ours: simulateOurCase(CASE, partner) } });
  });

  it('calculate_case refuses a case whose partner type is not in its offer, and a case that is not valid', async () => {
    const ctx = await agentContext(makeTestDeps(), { userId: 'u_anna', displayName: 'Anna', agentName: 'Claude', level: 'read', via: { kind: 'app', clientId: 'c_claude' } });
    expect(await runTool(ctx, 'calculate_case', { case: { ...CASE, typeId: 'gone' } })).toMatchObject({ ok: false, error: 'invalid', fieldErrors: { 'case.typeId': expect.any(String) } });
    expect(await runTool(ctx, 'calculate_case', { case: { ...CASE, deals: [1, 2] } })).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('check_program_cost is the Programs screen\'s cost check', async () => {
    const ctx = await agentContext(makeTestDeps(), { userId: 'u_anna', displayName: 'Anna', agentName: 'Claude', level: 'read', via: { kind: 'app', clientId: 'c_claude' } });
    expect(await runTool(ctx, 'check_program_cost', { companyFacts: FACTS, program: PROGRAM })).toEqual({ ok: true, value: costCheck(FACTS, PROGRAM) });
    expect(await runTool(ctx, 'check_program_cost', { companyFacts: { ...FACTS, yearly: -1 }, program: PROGRAM })).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('recommend_4c gives the desk and the confirmed recommendation, the confirmed one first', async () => {
    const ctx = await agentContext(makeTestDeps(), { userId: 'u_anna', displayName: 'Anna', agentName: 'Claude', level: 'read', via: { kind: 'app', clientId: 'c_claude' } });
    const empty = { customerBase: null, credibility: null, capability: null, commitment: null };
    const desk = { ...empty, customerBase: 2, credibility: 0 } as const;
    expect(await runTool(ctx, 'recommend_4c', { desk: { customerBase: 2, credibility: 0 } })).toEqual({
      ok: true, value: { desk: deskRecommendation(desk), confirmed: null, recommendation: deskRecommendation(desk) },
    });
    const confirmed = { customerBase: 3, credibility: 2, capability: 1, commitment: 2 } as const;
    expect(await runTool(ctx, 'recommend_4c', { desk, confirmed })).toEqual({
      ok: true, value: { desk: deskRecommendation(desk), confirmed: confirmedRecommendation(confirmed), recommendation: confirmedRecommendation(confirmed) },
    });
    expect(await runTool(ctx, 'recommend_4c', { desk: { credibility: 4 } })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await runTool(ctx, 'recommend_4c', { desk: { trust: 1 } })).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('map_health is the MAP screen\'s health and next milestone', async () => {
    const ctx = await agentContext(makeTestDeps(), { userId: 'u_anna', displayName: 'Anna', agentName: 'Claude', level: 'read', via: { kind: 'app', clientId: 'c_claude' } });
    const joined: JoinedPlan = { ...plan(), objectives: [], people: [], reviews: [], reviewNumbers: [], reviewItems: [] };
    const expected = summarizeMap(joined, '2026-10-28', '2026-10-25T09:00:00.000Z');
    expect(expected).toMatchObject({ health: 'at_risk', nextMilestone: '2026-11-20' });
    expect(await runTool(ctx, 'map_health', SAMPLES.map_health)).toEqual({ ok: true, value: expected });
    expect(await runTool(ctx, 'map_health', { ...SAMPLES.map_health, today: 'tomorrow' })).toMatchObject({ ok: false, error: 'invalid' });
  });
});
