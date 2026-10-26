import {
  applyRemovalSchedule,
  deleteOlderThan,
  getDb,
  getDbSettings,
  removalPreview,
  saveDbSettings,
  summarizeVps,
} from '@/lib/db';
import { databaseHost, getDatabasePlan } from '@/lib/mongo-plan';
import { broadcast } from '@/lib/pusher';
import { afterOption, everyOption } from '@/lib/schedule';

export const dynamic = 'force-dynamic';

async function snapshot(db, settings) {
  const [plan, preview] = await Promise.all([getDatabasePlan(db), removalPreview(db, settings.removeAfter)]);
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
  const db = await getDb();
  const { settings } = await applyRemovalSchedule(db);
  return Response.json(await snapshot(db, settings));
}

export async function PUT(req) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.enabled !== 'boolean' || !afterOption(body.removeAfter) || !everyOption(body.removeEvery)) {
    return Response.json({ error: 'Choose a valid removal schedule.' }, { status: 400 });
  }

  const db = await getDb();
  const settings = await saveDbSettings(db, {
    enabled: body.enabled,
    removeAfter: body.removeAfter,
    removeEvery: body.removeEvery,
  });
  return Response.json(await snapshot(db, settings));
}

export async function POST(req) {
  const body = await req.json().catch(() => null);
  if (!body || !afterOption(body.removeAfter)) {
    return Response.json({ error: 'Choose how old a notification must be before it is removed.' }, { status: 400 });
  }

  const db = await getDb();
  const removed = await deleteOlderThan(db, body.removeAfter);
  if (removed) await broadcast({ type: 'sync' }, { type: 'vps', items: await summarizeVps(db) });
  const settings = await getDbSettings(db);
  return Response.json({ ...(await snapshot(db, settings)), removed });
}
