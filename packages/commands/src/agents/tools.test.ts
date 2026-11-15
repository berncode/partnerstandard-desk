import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FORBIDDEN, ok } from '../result';
import { makeTestDeps } from '../testing';
import { agentContext } from './context';
import { page } from './paging';
import { AGENT_TOOLS, findTool, runTool, runToolIn, toolsFor, type AgentTool } from './tools';

const who = { userId: 'u_anna', displayName: 'Anna', agentName: 'Claude', via: { kind: 'app', clientId: 'c_claude' } } as const;
const SNAKE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

describe('the agent tool registry', () => {
  it('every tool name is unique and snake_case, and every REST path is unique per method', () => {
    const names = AGENT_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(SNAKE);
    const routes = AGENT_TOOLS.map((t) => `${t.rest.method} ${t.rest.path}`);
    expect(new Set(routes).size).toBe(routes.length);
    for (const t of AGENT_TOOLS) expect(t.rest.path).toMatch(/^\/[a-z0-9\-/{}A-Z]*$/);
  });

  it('no tool input schema has a companyId field', () => {
    const named = (schema: unknown): string[] => {
      if (typeof schema !== 'object' || schema === null) return [];
      const s = schema as { properties?: Record<string, unknown> };
      const own = Object.keys(s.properties ?? {});
      return [...own, ...Object.values(s).flatMap((v) => (Array.isArray(v) ? v.flatMap(named) : named(v)))];
    };
    for (const t of AGENT_TOOLS) {
      expect({ tool: t.name, companyId: named(z.toJSONSchema(t.input)).includes('companyId') }).toEqual({ tool: t.name, companyId: false });
    }
  });

  it('every path parameter is a required field of the tool input', () => {
    for (const t of AGENT_TOOLS) {
      const params = [...t.rest.path.matchAll(/\{([A-Za-z]+)\}/g)].map((m) => m[1]!);
      const required = (z.toJSONSchema(t.input) as { required?: string[] }).required ?? [];
      for (const p of params) expect({ tool: t.name, param: p, required: required.includes(p) }).toEqual({ tool: t.name, param: p, required: true });
    }
  });

  it('get_review is GET /reviews/{mapId}, with reviewId an optional field', () => {
    const t = findTool('get_review')!;
    expect(t.rest).toEqual({ method: 'GET', path: '/reviews/{mapId}' });
    const schema = z.toJSONSchema(t.input) as { properties?: object; required?: string[] };
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual(['mapId', 'reviewId']);
    expect(schema.required).toEqual(['mapId']);
  });

  it('every tool has a title and a description, with no em dash', () => {
    for (const t of AGENT_TOOLS) {
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      expect(`${t.title} ${t.description}`).not.toMatch(/—/);
    }
  });

  it('the read tools are the fourteen of spec 5.1, list_webhooks (spec 7.1) and list_proposals (proposals spec 6.2), all GET', () => {
    const read = AGENT_TOOLS.filter((t) => t.level === 'read');
    expect(read.map((t) => t.name).sort()).toEqual([
      'get_case', 'get_company_facts', 'get_map', 'get_market', 'get_partner', 'get_program', 'get_review', 'list_cases', 'list_maps',
      'list_markets', 'list_partners', 'list_programs', 'list_proposals', 'list_reviews', 'list_webhooks', 'this_week',
    ]);
    for (const t of read) expect(t.rest.method).toBe('GET');
  });

  it('toolsFor: read and calc always, change at change or propose, propose at propose only', () => {
    expect(toolsFor('read')).toEqual(AGENT_TOOLS.filter((t) => t.level === 'read' || t.level === 'calc'));
    expect(toolsFor('change')).toEqual(AGENT_TOOLS.filter((t) => t.level !== 'propose'));
    expect(toolsFor('propose')).toEqual(AGENT_TOOLS);
    expect(toolsFor('change').some((t) => t.level === 'change')).toBe(true);
    expect(toolsFor('propose').some((t) => t.level === 'propose')).toBe(true);
  });

  it('no agent tool reaches importPartners: new partners are only ever proposed', () => {
    const dir = fileURLToPath(new URL('.', import.meta.url));
    const sources = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(sources).toContain('propose-tools.ts');
    for (const file of sources) {
      expect({ file, imports: /\bimportPartners\b/.test(readFileSync(join(dir, file), 'utf8')) }).toEqual({ file, imports: false });
    }
    expect(AGENT_TOOLS.some((t) => /import/.test(t.name) || /import/.test(t.rest.path))).toBe(false);
  });

  it('findTool finds a tool by name and nothing else', () => {
    expect(findTool('get_map')?.name).toBe('get_map');
    expect(findTool('getMap')).toBeUndefined();
    expect(findTool('constructor')).toBeUndefined();
  });
});

describe('runTool', () => {
  /** A change tool that only notes it ran: no change tool exists before task 4. */
  function fakeChange() {
    let ran = 0;
    const tool: AgentTool<{ note: string }, string> = {
      name: 'fake_change', title: 'Fake', description: 'Fake', level: 'change',
      input: z.object({ note: z.string() }).strict(), rest: { method: 'POST', path: '/fake' },
      async run(_ctx, input) { ran++; return ok(input.note); },
    };
    return { tools: [tool as AgentTool], ran: () => ran };
  }

  it('runTool refuses a change tool for a read actor with forbidden', async () => {
    const deps = makeTestDeps();
    const fake = fakeChange();
    const reader = await agentContext(deps, { ...who, level: 'read' });
    expect(await runToolIn(fake.tools, reader, 'fake_change', { note: 'x' })).toEqual(FORBIDDEN);
    expect(fake.ran()).toBe(0);
    const changer = await agentContext(deps, { ...who, level: 'change' });
    expect(await runToolIn(fake.tools, changer, 'fake_change', { note: 'x' })).toEqual(ok('x'));
    expect(fake.ran()).toBe(1);
  });

  it('runTool refuses a propose tool below propose with forbidden, and a change tool at propose runs', async () => {
    const deps = makeTestDeps();
    let ran = 0;
    const tool = (name: string, level: 'change' | 'propose'): AgentTool => ({
      name, title: 'Fake', description: 'Fake', level, input: z.object({}).strict(), rest: { method: 'POST', path: `/${name}` },
      async run() { ran++; return ok(name); },
    });
    const tools = [tool('fake_propose', 'propose'), tool('fake_change', 'change')];
    for (const level of ['read', 'change'] as const) {
      const ctx = await agentContext(deps, { ...who, level });
      expect(await runToolIn(tools, ctx, 'fake_propose', {})).toEqual(FORBIDDEN);
      expect(await runToolIn(tools, ctx, 'fake_propose', { bad: 1 })).toEqual(FORBIDDEN);
    }
    expect(ran).toBe(0);
    const proposer = await agentContext(deps, { ...who, level: 'propose' });
    expect(await runToolIn(tools, proposer, 'fake_propose', {})).toEqual(ok('fake_propose'));
    expect(await runToolIn(tools, proposer, 'fake_change', {})).toEqual(ok('fake_change'));
    expect(ran).toBe(2);
  });

  it('a read actor sending bad input to a change tool is forbidden, not told what is wrong', async () => {
    const fake = fakeChange();
    const reader = await agentContext(makeTestDeps(), { ...who, level: 'read' });
    expect(await runToolIn(fake.tools, reader, 'fake_change', { other: 1 })).toEqual(FORBIDDEN);
  });

  it('runTool turns a bad input into invalid with field errors', async () => {
    const ctx = await agentContext(makeTestDeps({ companies: { u_anna: 'co_aaaaaaaaaa' } }), { ...who, level: 'read' });
    const result = await runTool(ctx, 'list_partners', { stage: 'nowhere', limit: 500, companyId: 'co_aaaaaaaaaa' });
    expect(result).toMatchObject({ ok: false, error: 'invalid' });
    if (result.ok) return;
    expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual(['companyId', 'limit', 'stage']);
  });

  it('an unknown tool name is not_found', async () => {
    const ctx = await agentContext(makeTestDeps(), { ...who, level: 'change' });
    expect(await runTool(ctx, 'delete_everything', {})).toMatchObject({ ok: false, error: 'not_found' });
  });

  it('a tool with no input takes a missing input as empty', async () => {
    const ctx = await agentContext(makeTestDeps(), { ...who, level: 'read' });
    expect(await runTool(ctx, 'this_week', undefined)).toEqual(ok({ reviews: [], needYou: [], due: [], waiting: [], proposalsWaiting: 0 }));
  });
});

describe('page', () => {
  const items = Array.from({ length: 120 }, (_, i) => i);

  it('pages 120 items as 50, 50 and 20, the cursor the index in base 36', () => {
    const first = page(items, undefined, 50);
    expect(first).toEqual({ items: items.slice(0, 50), nextCursor: (50).toString(36) });
    const second = page(items, first.nextCursor!, 50);
    expect(second).toEqual({ items: items.slice(50, 100), nextCursor: (100).toString(36) });
    expect(page(items, second.nextCursor!, 50)).toEqual({ items: items.slice(100), nextCursor: null });
  });

  it('a bad cursor starts at 0', () => {
    for (const bad of ['', '-1', 'zz!', '1.5', 'Infinity', ' 1']) expect(page(items, bad, 10).items[0]).toBe(0);
  });

  it('a cursor past the end gives an empty last page', () => {
    expect(page(items, (500).toString(36), 10)).toEqual({ items: [], nextCursor: null });
  });

  it('an empty list is one empty page', () => {
    expect(page([], undefined, 50)).toEqual({ items: [], nextCursor: null });
  });
});
