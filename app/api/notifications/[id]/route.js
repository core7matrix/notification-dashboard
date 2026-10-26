import { getDb, summarizeVps } from '@/lib/db';
import { broadcast } from '@/lib/pusher';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(req, { params }) {
  const { id } = await params;
  if (!UUID.test(id)) return Response.json({ error: 'Invalid id' }, { status: 400 });

  const db = await getDb();
  const { deletedCount } = await db.collection('notifications').deleteOne({ id: id.toLowerCase() });
  if (deletedCount) {
    await broadcast({ type: 'deleted', ids: [id] }, { type: 'vps', items: await summarizeVps(db) });
  }
  return Response.json({ ok: true, removed: deletedCount });
}
