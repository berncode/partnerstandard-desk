// The REST API's description (agents spec 6.1): OpenAPI 3.1 made from the tool registry, so the API and its
// description never drift. One operation per tool; its input's JSON Schema (zod 4) gives the parameters and the body.
import { AGENT_TOOLS, type AgentTool } from '@partner-desk/commands';
import { COPY } from '@partner-desk/copy';
import { z } from 'zod';
import packageJson from '../../package.json';
import { inputSchemaOf, REST_BASE } from './rest';

type Json = Record<string, unknown>;

/** A schema to embed: JSON Schema's dialect line belongs to a document of its own. */
const withoutDialect = (schema: Json): Json => {
  const copy = { ...schema };
  delete copy.$schema;
  return copy;
};

/** A refusal (RFC 9457), as `problemOf` in rest.ts writes it. */
const problemSchema = z.object({
  type: z.string().describe('An address per code.'),
  title: z.string().describe('What went wrong, in plain words.'),
  status: z.number().int(),
  code: z.string().describe('invalid, forbidden, not_found, file_not_found, conflict, structure, auth, quota, unavailable, '
    + 'unauthorized, rate_limited, too_large or not_found_route.'),
  fieldErrors: z.record(z.string(), z.string()).optional().describe('With invalid: each field and what is wrong with it.'),
});

/** One page of a list tool's answer. */
const pageSchema = z.object({
  items: z.array(z.record(z.string(), z.unknown())),
  nextCursor: z.string().nullable().describe('Send it as cursor for the next page; null on the last page.'),
});

type Status = keyof typeof COPY.AGENT_API_RESPONSES;
/** What every operation can answer, and what only one with a body can. */
const ALWAYS: Status[] = [401, 403, 404, 409, 422, 424, 429, 503, 507];
const WITH_BODY: Status[] = [400, 413];

function problemResponse(status: Status): Json {
  const headers: Json = status === 401
    ? { 'WWW-Authenticate': { description: 'Where an app signs in.', schema: { type: 'string' } } }
    : status === 429 ? { 'Retry-After': { description: 'Seconds to wait.', schema: { type: 'integer' } } } : {};
  return {
    description: COPY.AGENT_API_RESPONSES[status],
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } },
  };
}

const isList = (tool: AgentTool) => 'cursor' in (inputSchemaOf(tool).properties ?? {});

function operation(tool: AgentTool): Json {
  const schema = inputSchemaOf(tool);
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const inPath = [...tool.rest.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
  const parameters: Json[] = inPath.map((name) => ({ name, in: 'path', required: true, schema: properties[name] ?? { type: 'string' } }));
  let requestBody: Json | undefined;
  const rest = Object.entries(properties).filter(([name]) => !inPath.includes(name));
  if (tool.rest.method === 'GET') {
    for (const [name, field] of rest) {
      const description = typeof field.description === 'string' ? { description: field.description } : {};
      parameters.push({ name, in: 'query', required: required.has(name), ...description, schema: field });
    }
  } else {
    const bodyRequired = [...required].filter((name) => !inPath.includes(name));
    const body: Json = { ...schema, properties: Object.fromEntries(rest), ...(bodyRequired.length > 0 ? { required: bodyRequired } : {}) };
    if (bodyRequired.length === 0) delete body.required;
    requestBody = { required: bodyRequired.length > 0, content: { 'application/json': { schema: body } } };
  }
  const statuses = tool.rest.method === 'GET' ? ALWAYS : [...WITH_BODY, ...ALWAYS];
  return {
    operationId: tool.name,
    summary: tool.title,
    description: tool.description,
    tags: [tool.rest.path.split('/')[1]!],
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(requestBody ? { requestBody } : {}),
    responses: {
      200: {
        description: COPY.AGENT_API_RESPONSES[200],
        content: { 'application/json': { schema: isList(tool) ? { $ref: '#/components/schemas/Page' } : { type: 'object' } } },
      },
      ...Object.fromEntries([...statuses].sort((a, b) => a - b).map((s) => [s, { $ref: `#/components/responses/Problem${s}` }])),
    },
  };
}

/**
 * The OpenAPI 3.1 document for `/api/v1` at `appUrl`: one operation per agent tool (`operationId` = the tool's name),
 * bearer keys, and the problem answers. Webhook routes come in as tools (plan 10, task 8). A tool's answer has no
 * schema of its own yet: an object, or a page for a list [builder's call].
 */
export function buildOpenApi(appUrl: string): Json {
  const paths: Record<string, Record<string, Json>> = {};
  for (const tool of AGENT_TOOLS) {
    (paths[tool.rest.path] ??= {})[tool.rest.method.toLowerCase()] = operation(tool);
  }
  return {
    openapi: '3.1.0',
    info: { title: COPY.AGENT_API_TITLE, version: packageJson.version, description: COPY.AGENT_API_DESCRIPTION },
    servers: [{ url: `${appUrl.replace(/\/+$/, '')}${REST_BASE}` }],
    security: [{ bearer: [] }],
    paths,
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: COPY.AGENT_API_KEY_HELP } },
      schemas: {
        Problem: withoutDialect(z.toJSONSchema(problemSchema) as Json),
        Page: withoutDialect(z.toJSONSchema(pageSchema) as Json),
      },
      responses: Object.fromEntries([...WITH_BODY, ...ALWAYS].sort((a, b) => a - b).map((s) => [`Problem${s}`, problemResponse(s)])),
    },
  };
}
