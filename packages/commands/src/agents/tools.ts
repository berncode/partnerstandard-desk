// The agent tools, defined once: the MCP server and the REST API serve this list and run each tool through `runTool`.
import { COPY } from '@partner-desk/copy';
import { z } from 'zod';
import { levelAtLeast, type AgentLevel } from '../actor';
import { FORBIDDEN, invalid, type CommandResult } from '../result';
import { CALC_TOOLS } from './calc-tools';
import { CHANGE_TOOLS } from './change-tools';
import type { AgentContext } from './context';
import { PROPOSE_TOOLS } from './propose-tools';
import { READ_TOOLS } from './read-tools';
import { WEBHOOK_TOOLS } from './webhook-tools';

/**
 * `read` runs at every level; `change` at "Read and change" and above; `propose` only at "Read, change and propose";
 * `calc` reads and stores nothing.
 */
export type ToolLevel = 'read' | 'change' | 'propose' | 'calc';

/** The tool's REST route under `/api/v1`. Path parameters are written `{name}` and are fields of the tool's input. */
export interface RestRoute { method: 'GET' | 'POST' | 'PATCH'; path: string }

export interface AgentTool<I = unknown, O = unknown> {
  /** snake_case, unique: the MCP tool name and the REST operation id. */
  name: string;
  title: string;
  /** Short plain English for an agent: what the tool returns and which ids to pass next. */
  description: string;
  level: ToolLevel;
  /** A strict zod schema. Never a `companyId`: the company is the person's own (`AgentContext`). */
  input: z.ZodType<I>;
  rest: RestRoute;
  run(ctx: AgentContext, input: I): Promise<CommandResult<O>>;
}

/** Every tool, in the order an agent's app lists them. */
export const AGENT_TOOLS: readonly AgentTool[] = Object.freeze([...READ_TOOLS, ...CHANGE_TOOLS, ...PROPOSE_TOOLS, ...CALC_TOOLS, ...WEBHOOK_TOOLS]);

/** Whether an agent at `level` may run a tool of `tool` level: read and calc always, change from change up, propose at propose. */
const mayRun = (tool: ToolLevel, level: AgentLevel): boolean =>
  tool === 'read' || tool === 'calc' || levelAtLeast(level, tool);

/** The tools an agent at this level may see: read and calc always, change at `change` or `propose`, propose at `propose` only. */
export function toolsFor(level: AgentLevel): readonly AgentTool[] {
  return AGENT_TOOLS.filter((t) => mayRun(t.level, level));
}

export function findTool(name: string): AgentTool | undefined {
  return AGENT_TOOLS.find((t) => t.name === name);
}

const NO_TOOL = { ok: false as const, error: 'not_found' as const, message: COPY.AGENT_NO_TOOL };

/**
 * Field errors for an agent, keyed by the input's field: zod's own words, which an agent reads, never a person on a
 * screen [builder's call]. A field the schema doesn't know is named with the key itself.
 */
function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (key: string, message: string) => { if (!(key in out)) out[key] = message; };
  for (const issue of error.issues) {
    const at = issue.path.map(String).join('.');
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) put(at ? `${at}.${key}` : key, COPY.AGENT_UNKNOWN_FIELD);
    } else {
      put(at || '_', issue.message);
    }
  }
  return out;
}

/** `runTool` on a given list: for tests of a tool kind the registry doesn't hold yet. */
export async function runToolIn(
  tools: readonly AgentTool[], ctx: AgentContext, name: string, raw: unknown,
): Promise<CommandResult<unknown>> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return NO_TOOL;
  // The level first: an agent that may not run a tool learns nothing from its input. The commands check again (`can`).
  if (!mayRun(tool.level, ctx.actor.level)) return FORBIDDEN;
  const parsed = tool.input.safeParse(raw ?? {});
  if (!parsed.success) return invalid(fieldErrors(parsed.error));
  return tool.run(ctx, parsed.data);
}

/**
 * Runs one tool for one agent request: an unknown name is `not_found`, a change tool for a read agent or a propose tool
 * below propose `forbidden`, an
 * input its schema refuses `invalid` with field errors; else the tool's commands answer.
 */
export async function runTool(ctx: AgentContext, name: string, raw: unknown): Promise<CommandResult<unknown>> {
  return runToolIn(AGENT_TOOLS, ctx, name, raw);
}
