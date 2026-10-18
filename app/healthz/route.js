import { checkHealth } from '@/lib/health';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { ok, env, database } = await checkHealth();
  return Response.json({ ok, env, database }, { status: ok ? 200 : 503 });
}
