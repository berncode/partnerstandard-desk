import { AGENT_TOOLS } from '@partner-desk/commands';
import { describe, expect, it } from 'vitest';
import { buildOpenApi } from './openapi';

const APP = 'https://desk.example.com';

type Json = Record<string, unknown>;
interface Operation {
  operationId: string; summary: string; description: string; security?: unknown[];
  parameters?: Array<{ name: string; in: string; required?: boolean; schema: Json }>;
  requestBody?: { required?: boolean; content: Record<string, { schema: Json }> };
  responses: Record<string, Json>;
}
interface Doc {
  openapi: string; info: { title: string; version: string }; servers: Array<{ url: string }>;
  paths: Record<string, Record<string, Operation>>; components: { schemas: Record<string, Json>; responses: Record<string, Json>; securitySchemes: Record<string, Json> };
  security: Array<Record<string, string[]>>;
}

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const operations = (doc: Doc) => Object.entries(doc.paths).flatMap(([path, item]) =>
  Object.entries(item).filter(([method]) => METHODS.includes(method)).map(([method, op]) => ({ path, method, op })));

/** Every `$ref` in a value, with where it sits. */
function refsIn(value: unknown, at = '#'): Array<{ ref: string; at: string }> {
  if (Array.isArray(value)) return value.flatMap((v, i) => refsIn(v, `${at}/${i}`));
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([k, v]) => (k === '$ref' && typeof v === 'string' ? [{ ref: v, at }] : refsIn(v, `${at}/${k}`)));
}

/** A local JSON pointer (`#/components/schemas/Problem`) followed through the document. */
function resolve(doc: unknown, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined;
  return ref.slice(2).split('/').map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce<unknown>((node, key) => (typeof node === 'object' && node !== null ? (node as Json)[key] : undefined), doc);
}

describe('buildOpenApi', () => {
  const doc = buildOpenApi(APP) as unknown as Doc;

  it('buildOpenApi lists one operation per tool and validates as OpenAPI 3.1', () => {
    // The required keys of an OpenAPI 3.1 document, its operations and its responses.
    expect(doc.openapi).toMatch(/^3\.1\.\d+$/);
    expect(typeof doc.info.title).toBe('string');
    expect(typeof doc.info.version).toBe('string');
    expect(doc.servers).toEqual([{ url: `${APP}/api/v1` }]);
    const ops = operations(doc);
    expect(ops.map((o) => o.op.operationId).sort()).toEqual(AGENT_TOOLS.map((t) => t.name).sort());
    for (const { path, method, op } of ops) {
      expect(path.startsWith('/')).toBe(true);
      expect(Object.keys(op.responses).length).toBeGreaterThan(0);
      for (const response of Object.values(op.responses)) {
        expect(typeof (response.description ?? resolve(doc, String(response.$ref)))).not.toBe('undefined');
      }
      // Each {name} in the path is a required path parameter, and no other path parameter is declared.
      const inPath = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      const declared = (op.parameters ?? []).filter((p) => p.in === 'path');
      expect(declared.map((p) => p.name)).toEqual(inPath);
      for (const p of declared) expect(p.required).toBe(true);
      for (const p of op.parameters ?? []) {
        expect(['path', 'query']).toContain(p.in);
        expect(p.schema).toBeTypeOf('object');
      }
      // GET has no body; POST and PATCH a JSON one.
      if (method === 'get') expect(op.requestBody).toBeUndefined();
      else expect(op.requestBody?.content['application/json']?.schema).toBeTypeOf('object');
    }
    // Operation ids are unique.
    expect(new Set(ops.map((o) => o.op.operationId)).size).toBe(ops.length);
    // Every $ref resolves inside the document.
    const refs = refsIn(doc);
    expect(refs.length).toBeGreaterThan(0);
    for (const { ref, at } of refs) expect(resolve(doc, ref), `${ref} at ${at}`).toBeDefined();
    // The document is plain JSON.
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
  });

  it('each operation is its tool: method, path, title, description, and the input’s fields as parameters or body', () => {
    for (const tool of AGENT_TOOLS) {
      const op = doc.paths[tool.rest.path]?.[tool.rest.method.toLowerCase()];
      expect(op?.operationId, tool.name).toBe(tool.name);
      expect(op?.summary).toBe(tool.title);
      expect(op?.description).toBe(tool.description);
    }
    const reviews = doc.paths['/reviews/{mapId}']!.get!;
    expect(reviews.parameters).toEqual([
      expect.objectContaining({ name: 'mapId', in: 'path', required: true }),
      expect.objectContaining({ name: 'reviewId', in: 'query', required: false }),
    ]);
    const list = doc.paths['/maps']!.get!;
    expect(list.parameters?.find((p) => p.name === 'limit')).toMatchObject({ in: 'query', required: false, schema: { type: 'integer', maximum: 100 } });
    const update = doc.paths['/maps/{mapId}/activities/{activityId}']!.patch!;
    const body = update.requestBody!.content['application/json']!.schema as { properties: Json; required: string[] };
    expect(Object.keys(body.properties)).not.toContain('mapId');
    expect(Object.keys(body.properties)).not.toContain('activityId');
    expect(body.required).toEqual(['expectedUpdatedAt']);
    expect(update.requestBody!.required).toBe(true);
  });

  it('get_partner takes include as a query array', () => {
    const op = doc.paths['/partners/{accountId}']!.get!;
    const include = op.parameters?.find((p) => p.name === 'include') as { in: string; required: boolean; description?: string; schema: Json } | undefined;
    expect(include).toMatchObject({ in: 'query', required: false, schema: { type: 'array', items: { enum: ['map', 'cases', 'reviews'] } } });
    expect(include?.description).toContain('include=map,cases');
    expect(op.description).toContain('include');
  });

  it('every operation needs a bearer key, and refusals are problems', () => {
    expect(doc.components.securitySchemes.bearer).toMatchObject({ type: 'http', scheme: 'bearer' });
    expect(doc.security).toEqual([{ bearer: [] }]);
    expect(doc.components.schemas.Problem).toMatchObject({ type: 'object', required: expect.arrayContaining(['type', 'title', 'status', 'code']) });
    for (const { op } of operations(doc)) {
      for (const status of ['401', '403', '404', '422', '424', '429', '503']) {
        expect(op.responses[status], `${op.operationId} ${status}`).toEqual({ $ref: `#/components/responses/Problem${status}` });
      }
      expect(op.responses['200']).toBeDefined();
    }
    const problem = doc.components.responses.Problem404 as { content: Json };
    expect(problem.content).toEqual({ 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } });
  });

  it('no operation takes a companyId: the company is always the person’s own', () => {
    expect(JSON.stringify(doc)).not.toContain('companyId');
  });

  it('no text in it has an em dash', () => {
    expect(JSON.stringify(doc)).not.toMatch(/—/);
  });

  it('the first release’s operations and paths stay: a removal or rename needs /api/v2', () => {
    // Adding is fine (update the snapshot); a line that goes away or changes is a breaking change (spec 6.2).
    expect(operations(doc).map(({ method, path, op }) => `${op.operationId} ${method.toUpperCase()} ${path}`).sort()).toMatchInlineSnapshot(`
      [
        "add_activity POST /maps/{mapId}/activities",
        "add_webhook POST /webhooks",
        "calculate_case POST /calc/calculate-case",
        "check_program_cost POST /calc/check-program-cost",
        "delete_webhook POST /webhooks/{webhookId}/delete",
        "get_case GET /cases/{caseId}",
        "get_company_facts GET /company-facts",
        "get_map GET /maps/{mapId}",
        "get_market GET /markets/{marketId}",
        "get_partner GET /partners/{accountId}",
        "get_program GET /programs/{programId}",
        "get_review GET /reviews/{mapId}",
        "list_cases GET /cases",
        "list_maps GET /maps",
        "list_markets GET /markets",
        "list_partners GET /partners",
        "list_programs GET /programs",
        "list_proposals GET /proposals",
        "list_reviews GET /reviews",
        "list_webhooks GET /webhooks",
        "log_call POST /partners/{accountId}/calls",
        "map_health POST /calc/map-health",
        "prepare_review POST /reviews/{mapId}/prep",
        "propose_4c_scores POST /proposals/4c-scores",
        "propose_close POST /proposals/close",
        "propose_hypothesis_status POST /proposals/hypothesis-status",
        "propose_market_status POST /proposals/market-status",
        "propose_partners POST /proposals/partners",
        "propose_signed POST /proposals/signed",
        "propose_stage POST /proposals/stage",
        "recommend_4c POST /calc/recommend-4c",
        "save_company_facts PATCH /company-facts",
        "this_week GET /this-week",
        "update_activity PATCH /maps/{mapId}/activities/{activityId}",
        "update_case PATCH /cases/{caseId}",
        "update_market PATCH /markets/{marketId}",
        "update_milestone PATCH /maps/{mapId}/milestones/{milestoneId}",
        "update_partner PATCH /partners/{accountId}",
        "withdraw_proposal POST /proposals/{proposalId}/withdraw",
      ]
    `);
  });
});
