import { randomUUID } from 'node:crypto';
import { isIngestRequest, maxNotifications, unauthorized } from '@/lib/auth';
import { getDb, summarizeVps, toNotification } from '@/lib/db';
import { broadcast } from '@/lib/pusher';

// The extension calls this from its service worker, so allow cross-origin requests.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
};

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const optUrl = (v) => (typeof v === 'string' && /^https?:\/\//i.test(v) ? v.slice(0, 2000) : null);

function normalize(input, ord) {
  const capturedAt = Math.round(input.capturedAt);
  return {
    ord,
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
    captured_at: Number.isSafeInteger(capturedAt) ? capturedAt : Date.now(),
    received_at: Date.now(),
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

  const sql = await getDb();
  const inserted = await sql`
    INSERT INTO notifications (id, client_id, vps, app, title, body, icon, url, tag, source, captured_at, received_at)
    SELECT id, client_id, vps, app, title, body, icon, url, tag, source, captured_at, received_at
    FROM json_to_recordset(${JSON.stringify(rows)}::json) AS x(
      ord int, id uuid, client_id text, vps text, app text, title text, body text,
      icon text, url text, tag text, source text, captured_at bigint, received_at bigint
    )
    ORDER BY ord
    ON CONFLICT DO NOTHING
    RETURNING *`;

  const added = inserted.sort((a, b) => Number(a.seq) - Number(b.seq)).map(toNotification);

  if (added.length) {
    await sql`
      DELETE FROM notifications
      WHERE seq < (SELECT seq FROM notifications ORDER BY seq DESC OFFSET ${maxNotifications() - 1} LIMIT 1)`;
    await broadcast({ type: 'notifications', items: added }, { type: 'vps', items: await summarizeVps(sql) });
    for (const n of added) console.log(`[${n.vps}] ${n.app}: ${n.title} - ${n.body.slice(0, 80)}`);
  }

  return Response.json({ ok: true, added: added.length }, { headers: CORS });
}
