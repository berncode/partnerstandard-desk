import { agentContext, type CommandResult } from '@partner-desk/commands';
import { makeTestDeps } from '@partner-desk/commands/testing';
import { COPY } from '@partner-desk/copy';
import { ReconnectRequired } from '@partner-desk/storage';
import { describe, expect, it, vi } from 'vitest';
import { callTool, toMcpResult } from './results';

const textOf = (result: { content?: unknown[] }): string =>
  (result.content ?? []).map((c) => (c as { type: string; text?: string }).text ?? '').join('\n');

const anna = { userId: 'u_anna', displayName: 'Anna', agentName: 'n8n', level: 'read' as const, via: { kind: 'key' as const, keyId: 'k_n8n' } };
const context = async () => agentContext(makeTestDeps({ companies: { u_anna: 'co_aaaaaaaaaa' } }), anna);

describe('toMcpResult', () => {
  it.each([
    ['forbidden', COPY.FORBIDDEN],
    ['invalid', COPY.FIX_FIELDS],
    ['conflict', COPY.AGENT_CONFLICT],
    ['not_found', COPY.AGENT_NO_TOOL],
  ] as const)('%s becomes isError with the command’s message and its code', (error, message) => {
    const result = toMcpResult({ ok: false, error, message });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(message);
    expect(textOf(result)).toContain(`code: ${error}`);
    expect(result.structuredContent).toEqual({ error, message });
  });

  it('invalid names each field with its error', () => {
    const result = toMcpResult({ ok: false, error: 'invalid', message: COPY.FIX_FIELDS, fieldErrors: { date: 'Invalid date', extra: COPY.AGENT_UNKNOWN_FIELD } });
    expect(textOf(result)).toContain(`date: Invalid date`);
    expect(textOf(result)).toContain(`extra: ${COPY.AGENT_UNKNOWN_FIELD}`);
    expect(result.structuredContent).toMatchObject({ fieldErrors: { date: 'Invalid date', extra: COPY.AGENT_UNKNOWN_FIELD } });
  });

  it('auth becomes isError with the reconnect message, never the store’s own words', () => {
    const result = toMcpResult({ ok: false, error: 'auth', message: 'Reconnect Google in Settings.' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(COPY.AGENT_RECONNECT_GOOGLE);
    expect(textOf(result)).toContain('code: auth');
    expect(textOf(result)).not.toContain('Reconnect Google in Settings.');
  });

  it('success carries structuredContent and one text block with a summary line and the JSON', () => {
    const value = { account: { id: 'acc_1', company: 'Northwind' }, calls: [] };
    const result = toMcpResult({ ok: true, value });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(value);
    expect(result.content).toHaveLength(1);
    const [summary, json] = textOf(result).split('\n');
    expect(summary).toBe(COPY.AGENT_RESULT_DONE);
    expect(JSON.parse(json!)).toEqual(value);
  });

  it('a page says how many items it holds and whether more follow', () => {
    expect(textOf(toMcpResult({ ok: true, value: { items: [1, 2], nextCursor: '2' } })).split('\n')[0]).toBe(COPY.AGENT_RESULT_ITEMS(2, true));
    expect(textOf(toMcpResult({ ok: true, value: { items: [1], nextCursor: null } })).split('\n')[0]).toBe(COPY.AGENT_RESULT_ITEMS(1, false));
  });

  it('a value that isn’t an object is carried as { result }, as MCP asks of structured content', () => {
    const result = toMcpResult({ ok: true, value: [1, 2] } as CommandResult<unknown>);
    expect(result.structuredContent).toEqual({ result: [1, 2] });
  });

  it('no message has an em dash', () => {
    expect(`${COPY.AGENT_TRY_AGAIN} ${COPY.AGENT_RECONNECT_GOOGLE} ${COPY.AGENT_RESULT_DONE} ${COPY.AGENT_RESULT_ITEMS(2, true)}`).not.toMatch(/—/);
  });
});

describe('callTool', () => {
  it('runs the tool through runTool: an unknown name is not_found', async () => {
    const result = await callTool(await context(), 'move_stage', {}, vi.fn());
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(COPY.AGENT_NO_TOOL);
    expect(textOf(result)).toContain('code: not_found');
  });

  it('a command that throws becomes isError with the try-again message and logs the tool and ids, no error text', async () => {
    const ctx = await context();
    const secret = 'companies_read_failed: SELECT * FROM companies WHERE owner = Anna';
    vi.spyOn(ctx.deps.directory, 'partnerBook').mockRejectedValue(new Error(secret));
    const log = vi.fn();
    const result = await callTool(ctx, 'list_partners', {}, log);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(COPY.AGENT_TRY_AGAIN);
    expect(textOf(result)).toContain('code: unavailable');
    expect(textOf(result)).not.toContain('companies');
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('agent_tool_failed', { tool: 'list_partners', userId: 'u_anna', companyId: 'co_aaaaaaaaaa' });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/SELECT|companies_read_failed|at .*\.ts/);
  });

  it('Google access that is gone, thrown, becomes the reconnect message', async () => {
    const ctx = await context();
    vi.spyOn(ctx.deps.directory, 'partnerBook').mockRejectedValue(new ReconnectRequired());
    const result = await callTool(ctx, 'list_partners', {}, vi.fn());
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(COPY.AGENT_RECONNECT_GOOGLE);
    expect(textOf(result)).toContain('code: auth');
  });
});
