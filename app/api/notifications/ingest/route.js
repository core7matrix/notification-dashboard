import { randomUUID } from 'node:crypto';
import { isIngestRequest, maxNotifications, unauthorized } from '@/lib/auth';
import { applyRemovalSchedule, getDb, nextSeq, summarizeVps, toNotification } from '@/lib/db';
import { broadcast } from '@/lib/pusher';

// The extension calls this from its service worker, so allow cross-origin requests.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
};

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const optUrl = (v) => (typeof v === 'string' && /^https?:\/\//i.test(v) ? v.slice(0, 2000) : null);

function normalize(input) {
  const capturedAt = Math.round(input.capturedAt);
  return {
    id: randomUUID(),
    client_id: input.id != null ? String(input.id).slice(0, 100) || null : null,
    vps: str(input.vps, 100) || 'unnamed-vps',
    app: str(input.app, 100) || 'unknown',
    title: str(input.title, 500),
    body: str(input.body, 5000),
    icon: optUrl(input.icon),
    url: optUrl(input.url),
    tag: str(input.tag, 200) || null,
    source: str(input.source, 50) || null,
    page_title: str(input.pageTitle, 300) || null,
    captured_at: Number.isSafeInteger(capturedAt) ? capturedAt : Date.now(),
    received_at: Date.now(),
    read: false,
  };
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(req) {
  if (!isIngestRequest(req)) return unauthorized('Invalid API key', CORS);

  const body = (await req.json().catch(() => null)) || {};
  const incoming = Array.isArray(body.notifications) ? body.notifications : [body];
  const rows = incoming
    .filter((n) => n && typeof n === 'object')
    .slice(0, 100)
    .map(normalize)
    .filter((n) => n.title || n.body);

  if (!rows.length) return Response.json({ ok: true, added: 0 }, { headers: CORS });

  const db = await getDb();
  const notifications = db.collection('notifications');
  const first = await nextSeq(db, rows.length);
  rows.forEach((row, i) => (row.seq = first + i));
  try {
    await notifications.insertMany(rows, { ordered: false });
  } catch (err) {
    // Duplicate client ids are skipped; anything else is a real failure.
    const errors = err.writeErrors ? [].concat(err.writeErrors) : [err];
    if (!errors.every((e) => e.code === 11000)) throw err;
  }

  const inserted = await notifications
    .find({ id: { $in: rows.map((r) => r.id) } })
    .sort({ seq: 1 })
    .toArray();
  const added = inserted.map(toNotification);

  if (added.length) {
    await applyRemovalSchedule(db);
    const [oldestKept] = await notifications
      .find({}, { projection: { seq: 1 } })
      .sort({ seq: -1 })
      .skip(maxNotifications() - 1)
      .limit(1)
      .toArray();
    if (oldestKept) await notifications.deleteMany({ seq: { $lt: oldestKept.seq } });
    await broadcast({ type: 'notifications', items: added }, { type: 'vps', items: await summarizeVps(db) });
    for (const n of added) console.log(`[${n.vps}] ${n.app}: ${n.title} - ${n.body.slice(0, 80)}`);
  }

  return Response.json({ ok: true, added: added.length }, { headers: CORS });
}
