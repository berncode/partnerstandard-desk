// The REST API under /api/v1 (agents spec 6): each agent tool's `rest` route, run through `runToolSafely` with the
// same answers the MCP server gives, as JSON, and every refusal as `application/problem+json`. No access rule here:
// the tools and the commands decide.
import { AGENT_TOOLS, type AgentContext, type AgentTool, type Failure } from '@partner-desk/commands';
import { COPY } from '@partner-desk/copy';
import { z } from 'zod';
import { log as serverLog, type Log } from '@/server/log';
import { failureMessage, runToolSafely } from './results';

/** Where every route sits (spec 6.2): a removal or a change of meaning needs `/api/v2`. */
export const REST_BASE = '/api/v1';
/** The largest body a request may send [builder's call]: the biggest tool input (a call's notes, a case) is far smaller. */
export const BODY_LIMIT_BYTES = 256 * 1024;
/** Where a problem's `type` points: one address per code. */
export const PROBLEM_BASE = 'https://desk.partnerstandard.com/problems/';

/** A code only the REST API answers, besides the commands' own. */
export type RestCode = Failure['error'] | 'rate_limited' | 'not_found_route';

/**
 * The HTTP status of a refusal (spec 6.1). `structure` (a file whose sheets were changed by hand so it can't be read)
 * is 409 like a conflict [builder's call]; anything else, as `unavailable` (Google or our database failed), is 503.
 */
export function statusFor(error: RestCode): number {
  switch (error) {
    case 'invalid': return 422;
    case 'forbidden': return 403;
    case 'not_found': case 'file_not_found': case 'not_found_route': return 404;
    case 'conflict': case 'structure': case 'old_version': return 409;
    case 'auth': return 424;
    case 'quota': return 507;
    case 'rate_limited': return 429;
    default: return 503;
  }
}

/** A problem answer (RFC 9457): `type`, `title`, `status`, `code`, and the field errors when there are any. */
export function problemOf(
  status: number, code: string, title: string, extra: { fieldErrors?: Record<string, string>; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify({
    type: `${PROBLEM_BASE}${code}`, title, status, code, ...(extra.fieldErrors ? { fieldErrors: extra.fieldErrors } : {}),
  }), { status, headers: { 'content-type': 'application/problem+json', 'cache-control': 'no-store', ...extra.headers } });
}

/** A tool's refusal as a problem: its message (the reconnect one for `auth`), its code and its status. */
export function problem(failure: Failure): Response {
  return problemOf(statusFor(failure.error), failure.error, failureMessage(failure), failure.fieldErrors ? { fieldErrors: failure.fieldErrors } : {});
}

/** A route's segments, `{name}` for a path parameter. */
const ROUTES = AGENT_TOOLS.map((tool) => ({ tool, method: tool.rest.method, segments: tool.rest.path.split('/').filter(Boolean) }));
const PARAM = /^\{(\w+)\}$/;

/** The tool whose `rest` route is this method and path, with the path's parameters; null for any other request. */
export function matchRoute(method: string, segments: string[]): { tool: AgentTool; params: Record<string, string> } | null {
  const verb = method.toUpperCase();
  for (const route of ROUTES) {
    if (route.method !== verb || route.segments.length !== segments.length) continue;
    const params: Record<string, string> = {};
    const matches = route.segments.every((part, i) => {
      const name = PARAM.exec(part)?.[1];
      if (name) params[name] = segments[i]!;
      return name !== undefined ? segments[i]!.length > 0 : part === segments[i];
    });
    if (matches) return { tool: route.tool, params };
  }
  return null;
}

type JsonSchema = Record<string, unknown> & { properties?: Record<string, JsonSchema>; required?: string[]; type?: unknown; anyOf?: JsonSchema[] };
const schemas = new Map<string, JsonSchema>();

/** A tool's input as JSON Schema (zod 4, the input side), without `$schema`: what the OpenAPI shows and the query coerces to. */
export function inputSchemaOf(tool: AgentTool): JsonSchema {
  let schema = schemas.get(tool.name);
  if (!schema) {
    schema = { ...(z.toJSONSchema(tool.input, { io: 'input' }) as JsonSchema) };
    delete schema.$schema;
    schemas.set(tool.name, schema);
  }
  return schema;
}

const typesOf = (schema: JsonSchema | undefined): unknown[] =>
  !schema ? [] : [...(Array.isArray(schema.type) ? schema.type : [schema.type]), ...(schema.anyOf ?? []).flatMap(typesOf)];
const NUMBER = /^-?\d+(\.\d+)?$/;

/** A query string's value as the field's schema wants it: a number for a number field, else the text as sent. */
function fromQuery(schema: JsonSchema | undefined, text: string): unknown {
  const types = typesOf(schema);
  if ((types.includes('integer') || types.includes('number')) && NUMBER.test(text)) return Number(text);
  if (types.includes('boolean') && (text === 'true' || text === 'false')) return text === 'true';
  return text;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A list field's values from the query, as browsers and n8n write them: repeated (`include=map&include=cases`) or
 * separated with commas (`include=map,cases`), spaces trimmed, empty ones dropped [builder's call]. None left is an
 * empty list, for the schema to refuse.
 */
const listFromQuery = (query: URLSearchParams, key: string): string[] =>
  query.getAll(key).flatMap((v) => v.split(',')).map((v) => v.trim()).filter((v) => v !== '');

/**
 * A tool's input from a request: the query (GET) or the JSON body (POST, PATCH), then the path's parameters over
 * them, so the path names the record even when the body names another [builder's call]. A query field the tool
 * doesn't take is passed on for its schema to refuse (a `companyId` too).
 */
export function toolInput(tool: AgentTool, params: Record<string, string>, query: URLSearchParams, body: unknown): unknown {
  if (tool.rest.method === 'GET') {
    const properties = inputSchemaOf(tool).properties ?? {};
    const fields: Record<string, unknown> = {};
    for (const key of new Set(query.keys())) {
      fields[key] = typesOf(properties[key]).includes('array') ? listFromQuery(query, key) : fromQuery(properties[key], query.get(key)!);
    }
    return { ...fields, ...params };
  }
  return { ...(isRecord(body) ? body : {}), ...params };
}

type BodyRead = { ok: true; body: unknown } | { ok: false; response: Response };
const tooLarge = (): BodyRead => ({ ok: false, response: problemOf(413, 'too_large', COPY.AGENT_TOO_LARGE) });
const badBody = (): BodyRead => ({ ok: false, response: problemOf(400, 'invalid', COPY.AGENT_BAD_BODY) });

/** The request's JSON body: none when empty; refused over 256 KB (by its length, and by what arrives) or when it isn't one object. */
async function readBody(request: Request): Promise<BodyRead> {
  const length = Number(request.headers.get('content-length'));
  if (Number.isFinite(length) && length > BODY_LIMIT_BYTES) return tooLarge();
  if (!request.body) return { ok: true, body: undefined };
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > BODY_LIMIT_BYTES) {
      await reader.cancel();
      return tooLarge();
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  if (text.trim() === '') return { ok: true, body: undefined };
  try {
    const body: unknown = JSON.parse(text);
    return isRecord(body) ? { ok: true, body } : badBody();
  } catch {
    return badBody();
  }
}

/**
 * One request for a checked agent: the route's tool (else a 404 problem), its input, the tool through
 * `runToolSafely` (a throw is a 503 "try again", logged by tool name and ids), and the answer: the tool's value as
 * JSON, or its refusal as a problem.
 */
export async function handleRest(request: Request, segments: string[], ctx: AgentContext, log: Log = serverLog): Promise<Response> {
  const match = matchRoute(request.method, segments);
  if (!match) return problemOf(statusFor('not_found_route'), 'not_found_route', COPY.AGENT_NO_ROUTE);
  let body: unknown;
  if (match.tool.rest.method !== 'GET') {
    const read = await readBody(request);
    if (!read.ok) return read.response;
    body = read.body;
  }
  const input = toolInput(match.tool, match.params, new URL(request.url).searchParams, body);
  const result = await runToolSafely(ctx, match.tool.name, input, log);
  if (!result.ok) return problem(result);
  return Response.json(result.value ?? null, { headers: { 'cache-control': 'no-store' } });
}
