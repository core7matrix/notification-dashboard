import {
  applyRemovalSchedule,
  deleteOlderThan,
  getDb,
  getDbSettings,
  removalPreview,
  saveDbSettings,
  summarizeVps,
} from '@/lib/db';
import { databaseHost, getNeonPlan } from '@/lib/neon-plan';
import { broadcast } from '@/lib/pusher';
import { afterOption, everyOption } from '@/lib/schedule';

export const dynamic = 'force-dynamic';

async function snapshot(sql, settings) {
  const [plan, preview] = await Promise.all([getNeonPlan(), removalPreview(sql, settings.removeAfter)]);
  return {
    status: plan.status,
    plan: plan.plan,
    note: plan.note,
    host: databaseHost(),
    settings,
    total: preview.total,
    due: preview.due,
  };
}

export async function GET() {
  const sql = await getDb();
  const { settings } = await applyRemovalSchedule(sql);
  return Response.json(await snapshot(sql, settings));
}

export async function PUT(req) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.enabled !== 'boolean' || !afterOption(body.removeAfter) || !everyOption(body.removeEvery)) {
    return Response.json({ error: 'Choose a valid removal schedule.' }, { status: 400 });
  }

  const sql = await getDb();
  const settings = await saveDbSettings(sql, {
    enabled: body.enabled,
    removeAfter: body.removeAfter,
    removeEvery: body.removeEvery,
  });
  return Response.json(await snapshot(sql, settings));
}

export async function POST(req) {
  const body = await req.json().catch(() => null);
  if (!body || !afterOption(body.removeAfter)) {
    return Response.json({ error: 'Choose how old a notification must be before it is removed.' }, { status: 400 });
  }

  const sql = await getDb();
  const removed = await deleteOlderThan(sql, body.removeAfter);
  if (removed) await broadcast({ type: 'sync' }, { type: 'vps', items: await summarizeVps(sql) });
  const settings = await getDbSettings(sql);
  return Response.json({ ...(await snapshot(sql, settings)), removed });
}
