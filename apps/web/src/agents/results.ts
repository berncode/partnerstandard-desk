// A tool's answer for an agent, the same rule for the MCP server and (Task 7) the REST API: a command's result as is,
// and anything thrown as a plain "try again" with a log line of ids, never the error's text or a stack.
import type { CallToolResult } from '@modelcontextprotocol/server';
import { findTool, runTool, type AgentContext, type CommandResult } from '@partner-desk/commands';
import { COPY } from '@partner-desk/copy';
import { ReconnectRequired, StoreFailure } from '@partner-desk/storage';
import { log as serverLog, type Log } from '@/server/log';

type Failure = Extract<CommandResult<unknown>, { ok: false }>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** One line above the JSON: how many items a page holds and whether more follow, else that it is done. */
function summaryOf(value: unknown): string {
  if (isRecord(value) && Array.isArray(value.items)) return COPY.AGENT_RESULT_ITEMS(value.items.length, typeof value.nextCursor === 'string');
  return COPY.AGENT_RESULT_DONE;
}

/**
 * The message an agent reads for a refusal: the command's own, except Google access that is gone, which only the
 * person can mend (agents spec 5.6), so it says to ask them, not the store's words for a person on a screen.
 */
export const failureMessage = (failure: Failure): string => (failure.error === 'auth' ? COPY.AGENT_RECONNECT_GOOGLE : failure.message);

/**
 * A command's result as an MCP tool result. Success: `structuredContent` (an object; any other value as `{ result }`,
 * as MCP asks) and one text block, a summary line and the JSON. A refusal: `isError`, the message and `code: <error>`,
 * one line per field error, and the same as `structuredContent` for agents that read it.
 */
export function toMcpResult(result: CommandResult<unknown>): CallToolResult {
  if (result.ok) {
    const structured = isRecord(result.value) ? result.value : { result: result.value };
    return { content: [{ type: 'text', text: `${summaryOf(result.value)}\n${JSON.stringify(structured)}` }], structuredContent: structured };
  }
  const message = failureMessage(result);
  const fields = Object.entries(result.fieldErrors ?? {}).map(([field, error]) => `${field}: ${error}`);
  return {
    isError: true,
    content: [{ type: 'text', text: [message, `code: ${result.error}`, ...fields].join('\n') }],
    structuredContent: {
      error: result.error, message,
      ...(result.fieldErrors ? { fieldErrors: result.fieldErrors } : {}),
      ...(result.valid !== undefined ? { valid: result.valid } : {}),
    },
  };
}

/**
 * What a tool that threw answers. Google access gone is the reconnect answer; anything else (a failed database read,
 * a bug) is `unavailable` with "try again", and a log line with the tool's name and ids only: never the error's
 * message or stack, which can hold a query, a token or content.
 */
export function thrownResult(error: unknown, ctx: AgentContext, name: string, log: Log = serverLog): Failure {
  if (error instanceof ReconnectRequired || (error instanceof StoreFailure && error.code === 'auth')) {
    return { ok: false, error: 'auth', message: COPY.AGENT_RECONNECT_GOOGLE };
  }
  // Only a known tool's name: the name is the agent's text, and runTool answers an unknown one without throwing.
  log('agent_tool_failed', { tool: findTool(name)?.name ?? 'unknown', userId: ctx.actor.userId, companyId: ctx.companyId });
  return { ok: false, error: 'unavailable', message: COPY.AGENT_TRY_AGAIN };
}

/** Runs one tool for one agent request (`runTool`: the level, the input, then the commands) and never throws. */
export async function runToolSafely(ctx: AgentContext, name: string, raw: unknown, log: Log = serverLog): Promise<CommandResult<unknown>> {
  try {
    return await runTool(ctx, name, raw);
  } catch (error) {
    return thrownResult(error, ctx, name, log);
  }
}

/** `runToolSafely` as an MCP tool result. */
export async function callTool(ctx: AgentContext, name: string, raw: unknown, log: Log = serverLog): Promise<CallToolResult> {
  return toMcpResult(await runToolSafely(ctx, name, raw, log));
}
