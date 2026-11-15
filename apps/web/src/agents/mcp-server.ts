// The MCP server one agent request gets (agents spec 5): the tools its level may see, the method's prompts and
// resources, and the instructions. One fresh server per request (stateless, `app/mcp/route.ts`).
import { McpServer } from '@modelcontextprotocol/server';
import { toolsFor, type AgentContext } from '@partner-desk/commands';
import { AGENT_INSTRUCTIONS, AGENT_PROMPTS, AGENT_RESOURCES } from '@partner-desk/method';
import { z } from 'zod';
import packageJson from '../../package.json';
import { callTool } from './results';

export const MCP_SERVER_NAME = 'partner-desk';

/** A prompt's arguments: all optional text (`AgentPrompt.args`). */
const argsSchema = (args: readonly string[]) => z.object(Object.fromEntries(args.map((a) => [a, z.string().max(200).optional()])));

export function buildMcpServer(ctx: AgentContext): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: packageJson.version }, { instructions: AGENT_INSTRUCTIONS });

  for (const tool of toolsFor(ctx.actor.level)) {
    const reads = tool.level === 'read' || tool.level === 'calc';
    server.registerTool(tool.name, {
      title: tool.title,
      description: tool.description,
      // Listed for the agent's app; the input is checked by `runTool`, which answers in the tools' own words.
      inputSchema: tool.input as z.ZodType<Record<string, unknown>>,
      // A propose tool changes nothing the person sees until they accept; sending the same proposal again replaces the first.
      annotations: {
        title: tool.title, readOnlyHint: reads, destructiveHint: false, openWorldHint: false,
        ...(tool.level === 'propose' ? { idempotentHint: true } : {}),
      },
    }, (args) => callTool(ctx, tool.name, args));
  }
  // Every call goes to `runTool`, not only the listed ones, and with the arguments as sent: so an unknown name is
  // `not_found` with our message, a tool above the agent's level `forbidden`, and refused input `invalid` with its
  // fields, the same answers the REST API gives. (The SDK's own handler would answer these with its own words, and a
  // thrown error with its text.)
  server.server.setRequestHandler('tools/call', (request) => callTool(ctx, request.params.name, request.params.arguments ?? {}));

  for (const prompt of AGENT_PROMPTS) {
    const read = (args: Record<string, string | undefined>) => ({
      messages: [{
        role: 'user' as const,
        content: { type: 'text' as const, text: prompt.text(Object.fromEntries(Object.entries(args).filter((e): e is [string, string] => e[1] !== undefined))) },
      }],
    });
    if (prompt.args.length === 0) {
      server.registerPrompt(prompt.name, { title: prompt.title, description: prompt.description }, () => read({}));
    } else {
      server.registerPrompt(prompt.name, { title: prompt.title, description: prompt.description, argsSchema: argsSchema(prompt.args) }, (args) => read(args));
    }
  }

  for (const resource of AGENT_RESOURCES) {
    server.registerResource(resource.name, resource.uri, { title: resource.title, description: resource.description, mimeType: resource.mimeType },
      async (uri) => ({ contents: [{ uri: uri.href, mimeType: resource.mimeType, text: resource.text }] }));
  }
  return server;
}
