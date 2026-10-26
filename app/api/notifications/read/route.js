import { getDb, summarizeVps } from '@/lib/db';
import { broadcast } from '@/lib/pusher';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req) {
  const body = (await req.json().catch(() => null)) || {};
  const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === 'string' && UUID.test(id)) : null;
  const vps = typeof body.vps === 'string' && body.vps ? body.vps : null;

  const db = await getDb();
  const notifications = db.collection('notifications');
  let changed = [];
  if (!ids || ids.length) {
    const filter = { read: false, ...(ids ? { id: { $in: ids } } : vps ? { vps } : {}) };
    changed = await notifications.find(filter, { projection: { _id: 0, id: 1 } }).toArray();
    if (changed.length) await notifications.updateMany({ id: { $in: changed.map((r) => r.id) } }, { $set: { read: true } });
  }

  if (changed.length) {
    await broadcast(
      { type: 'read', ids: ids ? changed.map((r) => r.id) : null, vps: ids ? null : vps },
      { type: 'vps', items: await summarizeVps(db) }
    );
  }
  return Response.json({ ok: true, changed: changed.length });
}
