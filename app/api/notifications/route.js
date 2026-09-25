import { maxNotifications } from '@/lib/auth';
import { getDb, summarizeVps, toNotification } from '@/lib/db';
import { broadcast } from '@/lib/pusher';

export async function GET(req) {
  const params = req.nextUrl.searchParams;
  const vps = params.get('vps') || null;
  const app = params.get('app') || null;
  const limit = Math.min(Number(params.get('limit')) || 500, maxNotifications());

  const sql = await getDb();
  const rows = await sql`
    SELECT * FROM notifications
    WHERE (${vps}::text IS NULL OR vps = ${vps})
      AND (${app}::text IS NULL OR app = ${app})
    ORDER BY seq DESC
    LIMIT ${limit}`;
  return Response.json({ items: rows.map(toNotification) });
}

export async function DELETE(req) {
  const vps = req.nextUrl.searchParams.get('vps') || null;

  const sql = await getDb();
  const [{ removed }] = await sql`
    WITH deleted AS (
      DELETE FROM notifications WHERE ${vps}::text IS NULL OR vps = ${vps} RETURNING 1
    )
    SELECT count(*)::int AS removed FROM deleted`;
  await broadcast({ type: 'cleared', vps }, { type: 'vps', items: await summarizeVps(sql) });
  return Response.json({ ok: true, removed });
}
