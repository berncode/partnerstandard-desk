import {
  AGENT_TOOLS, agentContext, changeMap, changeMarket, changePartner, createMarket, findTool, readMarket, readPartners, rejectProposal, startMap,
  type Actor, type AgentLevel,
} from '@partner-desk/commands';
import { makeTestDeps } from '@partner-desk/commands/testing';
import { COPY } from '@partner-desk/copy';
import { ReconnectRequired } from '@partner-desk/storage';
import { describe, expect, it, vi } from 'vitest';
import { BODY_LIMIT_BYTES, handleRest, matchRoute, problem, statusFor, toolInput } from './rest';

const ANNA_CO = 'co_aaaaaaaaaa';
const BEN_CO = 'co_bbbbbbbbbb';
const anna: Actor = { kind: 'owner', userId: 'u_anna', displayName: 'Anna' };
const ben: Actor = { kind: 'owner', userId: 'u_ben', displayName: 'Ben' };
const APP = 'http://localhost:3000';

function value<T>(r: { ok: true; value: T } | { ok: false }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.value;
}

/** Anna and Ben, each with a partner and a MAP with one activity; Anna's agent at `level`. */
async function setup(level: AgentLevel = 'change') {
  const deps = makeTestDeps({ companies: { u_anna: ANNA_CO, u_ben: BEN_CO } });
  const mapOf = async (actor: Actor, companyId: string) => {
    await readPartners(deps, actor, { companyId });
    const change = async (c: Record<string, unknown>) => value(await changePartner(deps, actor, { companyId, change: c })).entityId!;
    const accountId = await change({ kind: 'add', entity: 'account', values: { company: 'Acme' } });
    const partnerId = await change({ kind: 'add', entity: 'partner', values: { accountId, partnerType: 'reseller' } });
    const { mapId } = value(await startMap(deps, actor, { companyId, partnerId }));
    const activityId = value(await changeMap(deps, actor, {
      mapId, change: { kind: 'add', entity: 'activity', values: { title: 'Kickoff', side: 'joint' } },
    })).entityId!;
    return { mapId, activityId };
  };
  const annas = await mapOf(anna, ANNA_CO);
  const bens = await mapOf(ben, BEN_CO);
  deps.events.events.length = 0;
  const ctx = await agentContext(deps, { userId: 'u_anna', displayName: 'Anna', agentName: 'n8n', level, via: { kind: 'key', keyId: 'k_n8n' } });
  return { deps, ctx, annas, bens };
}

/** One request to `/api/v1/<path>` through `handleRest`, with the agent already checked. */
async function call(
  ctx: Awaited<ReturnType<typeof setup>>['ctx'], method: string, path: string,
  options: { body?: unknown; raw?: string; headers?: Record<string, string> } = {}, log = vi.fn(),
) {
  const url = new URL(`${APP}/api/v1${path}`);
  const body = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  const request = new Request(url, {
    method, headers: { 'content-type': 'application/json', ...options.headers }, ...(body === undefined ? {} : { body }),
  });
  const segments = url.pathname.split('/').slice(3).filter(Boolean).map(decodeURIComponent);
  const response = await handleRest(request, segments, ctx, log);
  return { response, json: (await response.json()) as Record<string, unknown>, log };
}

/** A path with each `{name}` filled with an id-shaped value. */
const filled = (path: string) => path.replace(/\{(\w+)\}/g, (_, name: string) => `${name}_1`);
const segmentsOf = (path: string) => path.split('/').filter(Boolean);

describe('matchRoute', () => {
  it('matchRoute maps every tool’s rest route and nothing else', () => {
    // Each tool's own route finds it, with its path parameters.
    for (const tool of AGENT_TOOLS) {
      const match = matchRoute(tool.rest.method, segmentsOf(filled(tool.rest.path)));
      expect(match?.tool.name, `${tool.rest.method} ${tool.rest.path}`).toBe(tool.name);
      const names = [...tool.rest.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
      expect(match?.params).toEqual(Object.fromEntries(names.map((n) => [n, `${n}_1`])));
    }
    // No two tools share a route.
    const routes = AGENT_TOOLS.map((t) => `${t.rest.method} ${t.rest.path.replace(/\{\w+\}/g, '{}')}`);
    expect(new Set(routes).size).toBe(routes.length);

    // Anything else: another method, a segment more or less, a literal that differs, an empty path.
    const taken = new Set(routes);
    for (const tool of AGENT_TOOLS) {
      const segments = segmentsOf(filled(tool.rest.path));
      for (const method of ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD']) {
        if (taken.has(`${method} ${tool.rest.path.replace(/\{\w+\}/g, '{}')}`)) continue;
        expect(matchRoute(method, segments), `${method} ${tool.rest.path}`).toBeNull();
      }
      expect(matchRoute(tool.rest.method, [...segments, 'more'])?.tool.name).not.toBe(tool.name);
      if (segments.length > 1) expect(matchRoute(tool.rest.method, segments.slice(0, -1))?.tool.name).not.toBe(tool.name);
      expect(matchRoute(tool.rest.method, ['nothing', ...segments])).toBeNull();
    }
    expect(matchRoute('GET', [])).toBeNull();
    expect(matchRoute('GET', ['partner'])).toBeNull();
    expect(matchRoute('GET', ['openapi.json'])).toBeNull();
    expect(matchRoute('POST', ['maps', 'map_1', 'activity'])).toBeNull();
    expect(matchRoute('get', ['partners'])?.tool.name).toBe('list_partners');
  });
});

describe('toolInput', () => {
  it('GET takes the query: limit becomes a number, an optional field left out stays out', () => {
    const list = findTool('list_maps')!;
    expect(toolInput(list, {}, new URLSearchParams('limit=20&cursor=a&partnerId=ptn_1'), undefined))
      .toEqual({ limit: 20, cursor: 'a', partnerId: 'ptn_1' });
    const review = findTool('get_review')!;
    expect(toolInput(review, { mapId: 'map_1' }, new URLSearchParams(''), undefined)).toEqual({ mapId: 'map_1' });
    expect(toolInput(review, { mapId: 'map_1' }, new URLSearchParams('reviewId=rev_1'), undefined)).toEqual({ mapId: 'map_1', reviewId: 'rev_1' });
  });

  it('a limit that isn’t a number stays text, for the schema to refuse', () => {
    expect(toolInput(findTool('list_maps')!, {}, new URLSearchParams('limit=many'), undefined)).toEqual({ limit: 'many' });
  });

  it('POST and PATCH take the body, not the query; the path’s ids win over the body’s', () => {
    const update = findTool('update_activity')!;
    expect(toolInput(update, { mapId: 'map_1', activityId: 'act_1' }, new URLSearchParams('status=done'), {
      mapId: 'map_other', expectedUpdatedAt: '2026-11-01T10:00:00.000Z', status: 'done',
    })).toEqual({ mapId: 'map_1', activityId: 'act_1', expectedUpdatedAt: '2026-11-01T10:00:00.000Z', status: 'done' });
    expect(toolInput(update, { mapId: 'map_1', activityId: 'act_1' }, new URLSearchParams(), undefined)).toEqual({ mapId: 'map_1', activityId: 'act_1' });
  });
});

describe('REST include: repeated, comma separated, and refused values', () => {
  const getPartner = findTool('get_partner')!;

  it('repeated and comma separated values become one list, spaces trimmed', () => {
    expect(toolInput(getPartner, { accountId: 'a_1' }, new URLSearchParams('include=map&include=reviews'), null))
      .toEqual({ accountId: 'a_1', include: ['map', 'reviews'] });
    expect(toolInput(getPartner, { accountId: 'a_1' }, new URLSearchParams('include=map,cases'), null))
      .toEqual({ accountId: 'a_1', include: ['map', 'cases'] });
    expect(toolInput(getPartner, { accountId: 'a_1' }, new URLSearchParams('include=map, cases'), null))
      .toEqual({ accountId: 'a_1', include: ['map', 'cases'] });
    expect(toolInput(getPartner, { accountId: 'a_1' }, new URLSearchParams('include=map,&include=,reviews'), null))
      .toEqual({ accountId: 'a_1', include: ['map', 'reviews'] });
    // An empty one is passed on as an empty list, for the schema to refuse.
    expect(toolInput(getPartner, { accountId: 'a_1' }, new URLSearchParams('include='), null)).toEqual({ accountId: 'a_1', include: [] });
    // A field that isn't a list keeps its first value, as before.
    expect(toolInput(findTool('list_maps')!, {}, new URLSearchParams('partnerId=p_1,p_2'), undefined)).toEqual({ partnerId: 'p_1,p_2' });
  });

  it('GET /partners/{accountId}?include=map,cases reads what it names; MAP, empty and everything are refused, and no store is read', async () => {
    const { ctx, deps } = await setup('read');
    const accountId = value(await readPartners(deps, anna, { companyId: ANNA_CO })).value.accounts[0]!.id;
    const both = await call(ctx, 'GET', `/partners/${accountId}?include=map,cases`);
    expect(both.response.status).toBe(200);
    expect(both.json).toMatchObject({ account: { id: accountId }, maps: [{ read: { ok: true } }], cases: [] });
    const repeated = await call(ctx, 'GET', `/partners/${accountId}?include=map&include=reviews`);
    expect(repeated.response.status).toBe(200);
    expect(Object.keys(repeated.json)).toEqual(expect.arrayContaining(['maps', 'reviews']));
    expect(repeated.json).not.toHaveProperty('cases');

    const stores = [vi.spyOn(deps.partnerBooks, 'read'), vi.spyOn(deps.maps, 'read'), vi.spyOn(deps.cases, 'read')];
    for (const query of ['include=MAP', 'include=', 'include=everything']) {
      const { response, json } = await call(ctx, 'GET', `/partners/${accountId}?${query}`);
      expect({ query, status: response.status }).toEqual({ query, status: 422 });
      expect(response.headers.get('content-type')).toBe('application/problem+json');
      expect(json).toMatchObject({ code: 'invalid', title: COPY.FIX_FIELDS, status: 422 });
      // The field errors name include (its item, `include.0`, for a value it doesn't know).
      const fields = Object.keys(json.fieldErrors as Record<string, string>);
      expect({ query, fields: fields.length > 0 && fields.every((f) => f === 'include' || f.startsWith('include.')) }).toEqual({ query, fields: true });
    }
    for (const store of stores) expect(store).not.toHaveBeenCalled();
  });
});

describe('statusFor and problem', () => {
  it.each([
    ['invalid', 422], ['forbidden', 403], ['not_found', 404], ['file_not_found', 404], ['conflict', 409], ['auth', 424],
    ['quota', 507], ['structure', 409], ['rate_limited', 429], ['unavailable', 503], ['old_version', 409], ['not_found_route', 404],
  ] as const)('%s is %i', (error, status) => {
    expect(statusFor(error)).toBe(status);
  });

  it('a problem is application/problem+json with type, title, status, code and the field errors', async () => {
    const response = problem({ ok: false, error: 'invalid', message: COPY.FIX_FIELDS, fieldErrors: { date: 'Invalid date' } });
    expect(response.status).toBe(422);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(await response.json()).toEqual({
      type: 'https://desk.partnerstandard.com/problems/invalid', title: COPY.FIX_FIELDS, status: 422, code: 'invalid',
      fieldErrors: { date: 'Invalid date' },
    });
  });

  it('auth says to ask the person to connect Google again, not the store’s words', async () => {
    const response = problem({ ok: false, error: 'auth', message: 'Reconnect Google in Settings.' });
    expect(response.status).toBe(424);
    expect(await response.json()).toMatchObject({ title: COPY.AGENT_RECONNECT_GOOGLE, code: 'auth' });
  });
});

describe('handleRest', () => {
  it('GET /maps/{mapId} answers the map, and a read leaves no event', async () => {
    const { ctx, annas, deps } = await setup('read');
    const { response, json } = await call(ctx, 'GET', `/maps/${annas.mapId}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(json).toMatchObject({ value: { activities: [expect.objectContaining({ id: annas.activityId, title: 'Kickoff' })] } });
    expect(deps.events.events).toEqual([]);
  });

  it('a list takes limit from the query', async () => {
    const { ctx } = await setup('read');
    const { response, json } = await call(ctx, 'GET', '/maps?limit=1');
    expect(response.status).toBe(200);
    expect(json).toMatchObject({ items: [expect.anything()], nextCursor: null });
  });

  it('another user’s map id answers 404 like a missing one', async () => {
    const { ctx, bens, deps } = await setup('change');
    const theirs = await call(ctx, 'GET', `/maps/${bens.mapId}`);
    const missing = await call(ctx, 'GET', '/maps/map_zzzzzzzzzz');
    expect(theirs.response.status).toBe(404);
    expect(missing.response.status).toBe(404);
    expect(theirs.json).toEqual(missing.json);
    expect(theirs.response.headers.get('content-type')).toBe('application/problem+json');
    // Changing it is the same answer, and writes nothing.
    const patch = await call(ctx, 'PATCH', `/maps/${bens.mapId}/activities/${bens.activityId}`, {
      body: { expectedUpdatedAt: '2026-11-01T10:00:00.000Z', status: 'done' },
    });
    expect(patch.response.status).toBe(404);
    expect(patch.json).toEqual(missing.json);
    expect(deps.events.events).toEqual([]);
  });

  it('a read key PATCHing an activity gets 403', async () => {
    const { ctx, annas, deps } = await setup('read');
    const { response, json } = await call(ctx, 'PATCH', `/maps/${annas.mapId}/activities/${annas.activityId}`, {
      body: { expectedUpdatedAt: '2026-11-01T10:00:00.000Z', status: 'done' },
    });
    expect(response.status).toBe(403);
    expect(json).toMatchObject({ code: 'forbidden', title: COPY.FORBIDDEN, status: 403 });
    expect(deps.events.events).toEqual([]);
  });

  it('a change key PATCHes an activity, stamped with the key’s name for the person', async () => {
    const { ctx, annas } = await setup('change');
    const read = await call(ctx, 'GET', `/maps/${annas.mapId}`);
    const activity = (read.json.value as { activities: Array<{ id: string; updatedAt: string }> }).activities[0]!;
    const { response, json } = await call(ctx, 'PATCH', `/maps/${annas.mapId}/activities/${annas.activityId}`, {
      body: { expectedUpdatedAt: activity.updatedAt, status: 'done' },
    });
    expect(response.status).toBe(200);
    expect(json).toMatchObject({ activity: { id: annas.activityId, status: 'done', updatedBy: 'Desk Agent for Anna' } });
  });

  it('auth from the store becomes 424', async () => {
    const { ctx, annas, deps } = await setup('read');
    vi.spyOn(deps.maps, 'read').mockResolvedValue({ ok: false, error: 'auth', message: 'Reconnect Google in Settings.' });
    const { response, json } = await call(ctx, 'GET', `/maps/${annas.mapId}`);
    expect(response.status).toBe(424);
    expect(json).toMatchObject({ code: 'auth', title: COPY.AGENT_RECONNECT_GOOGLE, status: 424 });
  });

  it('auth thrown by the store becomes 424 too', async () => {
    const { ctx, annas, deps } = await setup('read');
    vi.spyOn(deps.maps, 'read').mockRejectedValue(new ReconnectRequired());
    const { response, json } = await call(ctx, 'GET', `/maps/${annas.mapId}`);
    expect(response.status).toBe(424);
    expect(json).toMatchObject({ code: 'auth', title: COPY.AGENT_RECONNECT_GOOGLE });
  });

  it('invalid input gives 422 with fieldErrors', async () => {
    const { ctx, annas } = await setup('change');
    const { response, json } = await call(ctx, 'PATCH', `/maps/${annas.mapId}/activities/${annas.activityId}`, {
      body: { expectedUpdatedAt: '2026-11-01T10:00:00.000Z', status: 'finished', companyId: BEN_CO },
    });
    expect(response.status).toBe(422);
    expect(json).toMatchObject({ code: 'invalid', title: COPY.FIX_FIELDS, status: 422 });
    expect(json.fieldErrors).toMatchObject({ status: expect.any(String), companyId: COPY.AGENT_UNKNOWN_FIELD });
  });

  it('a query field the tool doesn’t take, a companyId too, is 422', async () => {
    const { ctx } = await setup('read');
    const { response, json } = await call(ctx, 'GET', `/partners?companyId=${BEN_CO}`);
    expect(response.status).toBe(422);
    expect(json.fieldErrors).toEqual({ companyId: COPY.AGENT_UNKNOWN_FIELD });
    const limit = await call(ctx, 'GET', '/maps?limit=500');
    expect(limit.response.status).toBe(422);
    expect(limit.json.fieldErrors).toHaveProperty('limit');
  });

  it('a command that throws is a 503 with try again, logged by tool name and ids only', async () => {
    const { ctx, annas, deps } = await setup('read');
    vi.spyOn(deps.maps, 'read').mockRejectedValue(new Error('SECRET SELECT * FROM maps'));
    const { response, json, log } = await call(ctx, 'GET', `/maps/${annas.mapId}`);
    expect(response.status).toBe(503);
    expect(json).toMatchObject({ code: 'unavailable', title: COPY.AGENT_TRY_AGAIN, status: 503 });
    expect(log).toHaveBeenCalledWith('agent_tool_failed', { tool: 'get_map', userId: 'u_anna', companyId: ANNA_CO });
    expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET');
  });

  it('an unknown route is a 404 problem', async () => {
    const { ctx } = await setup('read');
    for (const [method, path] of [['GET', '/nothing'], ['DELETE', '/partners'], ['GET', '/maps/map_1/activities']] as const) {
      const { response, json } = await call(ctx, method, path);
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toBe('application/problem+json');
      expect(json).toMatchObject({ code: 'not_found_route', title: COPY.AGENT_NO_ROUTE, status: 404 });
    }
  });

  it('a body over 256 KB is refused with 413, by its length and by what arrives', async () => {
    const { ctx, annas } = await setup('change');
    const big = JSON.stringify({ title: 'x'.repeat(BODY_LIMIT_BYTES) });
    const { response, json } = await call(ctx, 'POST', `/maps/${annas.mapId}/activities`, { raw: big });
    expect(response.status).toBe(413);
    expect(json).toMatchObject({ code: 'too_large', title: COPY.AGENT_TOO_LARGE, status: 413 });
    const lying = await call(ctx, 'POST', `/maps/${annas.mapId}/activities`, { raw: big, headers: { 'content-length': '10' } });
    expect(lying.response.status).toBe(413);
  });

  it('a body that isn’t one JSON object is 400', async () => {
    const { ctx, annas } = await setup('change');
    for (const raw of ['{"title":', '[1, 2]', '"text"']) {
      const { response, json } = await call(ctx, 'POST', `/maps/${annas.mapId}/activities`, { raw });
      expect(response.status).toBe(400);
      expect(json).toMatchObject({ code: 'invalid', title: COPY.AGENT_BAD_BODY, status: 400 });
    }
  });

  it('POST with no body is the tool’s input without one: 422 for what it needs', async () => {
    const { ctx, annas } = await setup('change');
    const { response, json } = await call(ctx, 'POST', `/maps/${annas.mapId}/activities`);
    expect(response.status).toBe(422);
    expect(json.fieldErrors).toHaveProperty('title');
  });

  it('a change key adds, lists and deletes a webhook; the secret comes once; Ben’s webhook is 404 like a missing one', async () => {
    const { ctx, deps } = await setup('change');
    const added = await call(ctx, 'POST', '/webhooks', { body: { url: 'https://hooks.example.com/in', events: ['partner.signed'] } });
    expect(added.response.status).toBe(200);
    const { webhook, secret } = added.json as { webhook: { id: string }; secret: string };
    expect(secret).toMatch(/^whsec_/);
    const listed = await call(ctx, 'GET', '/webhooks');
    expect(JSON.stringify(listed.json)).not.toContain(secret);
    expect(JSON.stringify(listed.json)).toContain(webhook.id);
    const bens = await deps.webhooks.create({ userId: 'u_ben', url: 'https://ben.example.com/in', events: ['partner.signed'] });
    const theirs = await call(ctx, 'POST', `/webhooks/${bens.webhook.id}/delete`);
    const missing = await call(ctx, 'POST', '/webhooks/wh_zzzzzzzzzz/delete');
    expect(theirs.response.status).toBe(404);
    expect(theirs.json).toEqual(missing.json);
    expect(deps.webhooks.rows.map((w) => w.id)).toContain(bens.webhook.id);
    const deleted = await call(ctx, 'POST', `/webhooks/${webhook.id}/delete`);
    expect(deleted.response.status).toBe(200);
  });

  it('an http webhook address is 422 on url; a read key may list webhooks but not add one', async () => {
    const { ctx } = await setup('change');
    const http = await call(ctx, 'POST', '/webhooks', { body: { url: 'http://hooks.example.com/in', events: ['partner.signed'] } });
    expect(http.response.status).toBe(422);
    expect(http.json).toMatchObject({ fieldErrors: { url: COPY.WEBHOOK_URL_HTTPS } });
    const reader = await agentContext(makeTestDeps(), { userId: 'u_anna', displayName: 'Anna', agentName: 'n8n', level: 'read', via: { kind: 'key', keyId: 'k_n8n' } });
    expect((await call(reader, 'GET', '/webhooks')).response.status).toBe(200);
    expect((await call(reader, 'POST', '/webhooks', { body: { url: 'https://hooks.example.com/in', events: ['partner.signed'] } })).response.status).toBe(403);
  });

  it('a calculation runs from the body', async () => {
    const { ctx } = await setup('read');
    const { response } = await call(ctx, 'POST', '/calc/recommend-4c', { body: { desk: { customerBase: 2, credibility: 0 } } });
    expect(response.status).toBe(200);
  });
});

describe('proposals through REST', () => {
  /** Anna's Acme as her key reads it (GET /partners/{accountId}), and a market with one hypothesis. */
  async function withTargets(s: Awaited<ReturnType<typeof setup>>) {
    const book = value(await readPartners(s.deps, anna, { companyId: ANNA_CO })).value;
    const accountId = book.accounts[0]!.id;
    const read = await call(s.ctx, 'GET', `/partners/${accountId}`);
    const partner = (read.json.partners as Array<{ id: string; updatedAt: string | null }>)[0]!;
    const { marketId } = value(await createMarket(s.deps, anna, {
      companyId: ANNA_CO, info: { marketName: 'Austria', partnerType: 'reseller', ourProduct: 'Tool', ourTargetCustomers: 'Banks' },
    }));
    const hypothesisId = value(await changeMarket(s.deps, anna, { marketId, change: { kind: 'add', entity: 'hypothesis', values: { name: 'Banks' } } })).entityId!;
    s.deps.events.events.length = 0;
    return { accountId, partnerId: partner.id, partnerUpdatedAt: partner.updatedAt, marketId, hypothesisId };
  }
  const fourC = (t: Awaited<ReturnType<typeof withTargets>>) =>
    ({ partnerId: t.partnerId, expectedUpdatedAt: t.partnerUpdatedAt, letters: { credibility: { score: 2, evidence: 'Known brand.' } } });

  it('a propose key proposes 4C scores, reads the proposal back by id, sees the person’s note after a reject, and the scores don’t change', async () => {
    const s = await setup('propose');
    const t = await withTargets(s);
    const before = value(await readPartners(s.deps, anna, { companyId: ANNA_CO })).value.partners;
    const made = await call(s.ctx, 'POST', '/proposals/4c-scores', { body: fourC(t) });
    expect(made.response.status).toBe(200);
    expect(made.json).toEqual({ proposalId: expect.stringMatching(/^prp_/), status: 'waiting', message: 'Proposed. It waits for Anna in PartnerStandard Desk.' });
    expect(value(await readPartners(s.deps, anna, { companyId: ANNA_CO })).value.partners).toEqual(before);

    const proposalId = made.json.proposalId as string;
    const one = await call(s.ctx, 'GET', `/proposals?proposalId=${proposalId}`);
    expect(one.response.status).toBe(200);
    expect(one.json).toMatchObject({ items: [{ proposalId, kind: 'fourC', status: 'waiting', partnerId: t.partnerId, answerNote: null }], nextCursor: null });
    value(await rejectProposal(s.deps, anna, { companyId: ANNA_CO, proposalId, note: 'Ask me after the call.' }));
    const answered = await call(s.ctx, 'GET', `/proposals?status=rejected&limit=10`);
    expect(answered.json).toMatchObject({ items: [{ proposalId, status: 'rejected', answerNote: 'Ask me after the call.' }] });
  });

  it('withdraw_proposal is POST /proposals/{proposalId}/withdraw; another person’s or a missing id is 404', async () => {
    const s = await setup('propose');
    const t = await withTargets(s);
    const proposalId = (await call(s.ctx, 'POST', '/proposals/4c-scores', { body: fourC(t) })).json.proposalId as string;
    const withdrawn = await call(s.ctx, 'POST', `/proposals/${proposalId}/withdraw`);
    expect(withdrawn.response.status).toBe(200);
    expect(withdrawn.json).toEqual({ proposalId, status: 'withdrawn' });
    expect((await call(s.ctx, 'POST', '/proposals/prp_zzzzzzzzzz/withdraw')).response.status).toBe(404);
  });

  it('propose_stage to exit answers 422 with "Only a person moves a partner into Exit."', async () => {
    const s = await setup('propose');
    const t = await withTargets(s);
    const { response, json } = await call(s.ctx, 'POST', '/proposals/stage', {
      body: { partnerId: t.partnerId, expectedUpdatedAt: t.partnerUpdatedAt, to: 'exit', reason: 'They stopped selling.' },
    });
    expect(response.status).toBe(422);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(json).toMatchObject({ code: 'invalid', title: COPY.PROPOSAL_NO_EXIT, status: 422 });
    expect(s.deps.proposals.rows).toEqual([]);
  });

  it('an old expectedUpdatedAt is 409, and a 4C proposal with no letter is 422 on letters', async () => {
    const s = await setup('propose');
    const t = await withTargets(s);
    const stale = await call(s.ctx, 'POST', '/proposals/close', {
      body: { partnerId: t.partnerId, expectedUpdatedAt: '2026-01-01T00:00:00.000Z', as: 'no', reason: 'x' },
    });
    expect(stale.response.status).toBe(409);
    expect(stale.json).toMatchObject({ code: 'conflict', title: COPY.AGENT_CONFLICT });
    const none = await call(s.ctx, 'POST', '/proposals/4c-scores', { body: { ...fourC(t), letters: {} } });
    expect(none.response.status).toBe(422);
    expect(none.json).toMatchObject({ fieldErrors: { letters: COPY.PROPOSAL_NO_LETTER } });
  });

  it('Google access gone while proposing is 424 with the reconnect words, and no index row', async () => {
    const s = await setup('propose');
    const t = await withTargets(s);
    vi.spyOn(s.deps.partnerBooks, 'read').mockResolvedValue({ ok: false, error: 'auth', message: 'Reconnect Google in Settings.' });
    const { response, json } = await call(s.ctx, 'POST', '/proposals/4c-scores', { body: fourC(t) });
    expect(response.status).toBe(424);
    expect(json).toMatchObject({ code: 'auth', title: COPY.AGENT_RECONNECT_GOOGLE });
    expect(s.deps.proposals.rows).toEqual([]);
  });

  it('a change-level agent’s propose call is forbidden through REST, and nothing is written', async () => {
    const s = await setup('change');
    const t = await withTargets(s);
    const routes: Array<[string, unknown]> = [
      ['/proposals/4c-scores', fourC(t)],
      ['/proposals/stage', { partnerId: t.partnerId, expectedUpdatedAt: t.partnerUpdatedAt, to: 'discovery_call', reason: 'x' }],
      ['/proposals/close', { partnerId: t.partnerId, expectedUpdatedAt: t.partnerUpdatedAt, as: 'no', reason: 'x' }],
      ['/proposals/signed', { partnerId: t.partnerId, expectedUpdatedAt: t.partnerUpdatedAt, signedDate: '2026-10-27', reason: 'x' }],
      ['/proposals/partners', { marketId: t.marketId, companies: [{ company: 'Globex' }], reason: 'x' }],
      ['/proposals/hypothesis-status', { marketId: t.marketId, hypothesisId: t.hypothesisId, expectedUpdatedAt: null, to: 'holds', reason: 'x' }],
      ['/proposals/market-status', { marketId: t.marketId, expectedUpdatedAt: null, to: 'validated', note: '', reason: 'x' }],
      ['/proposals/prp_aaaaaaaaaa/withdraw', undefined],
    ];
    for (const [path, body] of routes) {
      const { response, json } = await call(s.ctx, 'POST', path, body === undefined ? {} : { body });
      expect({ path, status: response.status, code: json.code }).toEqual({ path, status: 403, code: 'forbidden' });
    }
    expect(s.deps.proposals.rows).toEqual([]);
    expect(s.deps.events.events).toEqual([]);
    // Its list is empty: it can't have made any.
    expect((await call(s.ctx, 'GET', '/proposals')).json).toEqual({ items: [], nextCursor: null });
  });

  it('every decision kind is refused to a change-level agent through REST', async () => {
    const s = await setup('change');
    const t = await withTargets(s);
    const book = async () => value(await readPartners(s.deps, anna, { companyId: ANNA_CO })).value;
    const before = await book();
    const market = value(await readMarket(s.deps, anna, { marketId: t.marketId })).value;
    // Desk score, confirmed score, step, stage, close and signed: PATCH /partners/{accountId} has no such field.
    const decisions: Record<string, unknown> = {
      desk: { credibility: 2 }, confirmed: { credibility: 2 }, step: 'qualification', stage: 'onboarding', closed: 'no', signedDate: '2026-10-27',
    };
    for (const [field, set] of Object.entries(decisions)) {
      const { response, json } = await call(s.ctx, 'PATCH', `/partners/${t.accountId}`, {
        body: { partnerTypes: [{ partnerType: 'reseller', expectedUpdatedAt: t.partnerUpdatedAt, whyItFits: 'x', [field]: set }] },
      });
      expect({ field, status: response.status, fieldErrors: json.fieldErrors })
        .toEqual({ field, status: 422, fieldErrors: { [`partnerTypes.0.${field}`]: COPY.AGENT_UNKNOWN_FIELD } });
    }
    // A hypothesis's and a market's status: PATCH /markets/{marketId} has none.
    const hypothesis = await call(s.ctx, 'PATCH', `/markets/${t.marketId}`, {
      body: { hypothesis: { id: t.hypothesisId, expectedUpdatedAt: market.hypotheses[0]!.updatedAt, name: 'Banks in Austria', status: 'holds' } },
    });
    expect({ status: hypothesis.response.status, fieldErrors: hypothesis.json.fieldErrors })
      .toEqual({ status: 422, fieldErrors: { 'hypothesis.status': COPY.AGENT_UNKNOWN_FIELD } });
    const status = await call(s.ctx, 'PATCH', `/markets/${t.marketId}`, {
      body: { market: { expectedUpdatedAt: market.info.updatedAt, marketName: 'Austria and Germany', status: 'validated' } },
    });
    expect({ status: status.response.status, fieldErrors: status.json.fieldErrors })
      .toEqual({ status: 422, fieldErrors: { 'market.status': COPY.AGENT_UNKNOWN_FIELD } });
    // An import: no route reaches it.
    for (const path of ['/partners/import', '/partners', '/markets/' + t.marketId + '/import', '/import']) {
      const { response } = await call(s.ctx, 'POST', path, { body: { marketId: t.marketId, companies: [{ company: 'Globex' }] } });
      expect({ path, status: response.status }).toEqual({ path, status: 404 });
    }
    expect(AGENT_TOOLS.some((tool) => /import/i.test(tool.name) || /import/i.test(tool.rest.path))).toBe(false);
    expect(await book()).toEqual(before);
    expect(value(await readMarket(s.deps, anna, { marketId: t.marketId })).value).toEqual(market);
    expect(s.deps.events.events.filter((e) => e.actorKind === 'agent')).toEqual([]);
  });
});

describe('no problem text has an em dash', () => {
  it('the API’s own texts', () => {
    expect(`${COPY.AGENT_NO_ROUTE} ${COPY.AGENT_TOO_LARGE} ${COPY.AGENT_BAD_BODY} ${COPY.AGENT_UNAUTHORIZED} ${COPY.AGENT_RATE_LIMITED}`).not.toMatch(/—/);
  });
});
