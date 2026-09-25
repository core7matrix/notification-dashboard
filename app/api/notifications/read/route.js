import { getDb, summarizeVps } from '@/lib/db';
import { broadcast } from '@/lib/pusher';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req) {
  const body = (await req.json().catch(() => null)) || {};
  const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === 'string' && UUID.test(id)) : null;
  const vps = typeof body.vps === 'string' && body.vps ? body.vps : null;

  const sql = await getDb();
  let changed;
  if (ids) {
    changed = ids.length
      ? await sql`UPDATE notifications SET read = true WHERE NOT read AND id = ANY(${ids}::uuid[]) RETURNING id`
      : [];
  } else {
    changed = await sql`
      UPDATE notifications SET read = true
      WHERE NOT read AND (${vps}::text IS NULL OR vps = ${vps})
      RETURNING id`;
  }

  if (changed.length) {
    await broadcast(
      { type: 'read', ids: ids ? changed.map((r) => r.id) : null, vps: ids ? null : vps },
      { type: 'vps', items: await summarizeVps(sql) }
    );
  }
  return Response.json({ ok: true, changed: changed.length });
}
