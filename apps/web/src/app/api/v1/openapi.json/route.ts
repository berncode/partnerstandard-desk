// The REST API's description (agents spec 6.1), open to anyone: it describes the routes, never anyone's data.
import { serverEnv } from '@partner-desk/platform';
import { connection } from 'next/server';
import { buildOpenApi } from '@/agents/openapi';

export async function GET(): Promise<Response> {
  await connection(); // request time only: the servers' address is this deployment's APP_URL
  return Response.json(buildOpenApi(serverEnv().APP_URL));
}
