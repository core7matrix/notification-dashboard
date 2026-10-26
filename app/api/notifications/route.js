import { maxNotifications } from '@/lib/auth';
import { applyRemovalSchedule, getDb, summarizeVps, toNotification } from '@/lib/db';
import { broadcast } from '@/lib/pusher';

export async function GET(req) {
  const params = req.nextUrl.searchParams;
  const vps = params.get('vps') || null;
  const app = params.get('app') || null;
  const limit = Math.min(Number(params.get('limit')) || 500, maxNotifications());

  const db = await getDb();
  await applyRemovalSchedule(db);
  const rows = await db
    .collection('notifications')
    .find({ ...(vps && { vps }), ...(app && { app }) })
    .sort({ seq: -1 })
    .limit(limit)
    .toArray();
  return Response.json({ items: rows.map(toNotification) });
}

export async function DELETE(req) {
  const vps = req.nextUrl.searchParams.get('vps') || null;

  const db = await getDb();
  const { deletedCount: removed } = await db.collection('notifications').deleteMany(vps ? { vps } : {});
  await broadcast({ type: 'cleared', vps }, { type: 'vps', items: await summarizeVps(db) });
  return Response.json({ ok: true, removed });
}
