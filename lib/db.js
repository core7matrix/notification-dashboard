import { neon } from '@neondatabase/serverless';

let sql;
let schemaReady;

async function createSchema(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS notifications (
      seq bigserial PRIMARY KEY,
      id uuid NOT NULL UNIQUE,
      client_id text,
      vps text NOT NULL,
      app text NOT NULL,
      title text NOT NULL DEFAULT '',
      body text NOT NULL DEFAULT '',
      icon text,
      url text,
      tag text,
      source text,
      captured_at bigint NOT NULL,
      received_at bigint NOT NULL,
      read boolean NOT NULL DEFAULT false
    )`;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS notifications_client_id_idx
    ON notifications (client_id) WHERE client_id IS NOT NULL`;
  await sql`CREATE INDEX IF NOT EXISTS notifications_vps_idx ON notifications (vps)`;
}

export async function getDb() {
  if (!sql) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error('DATABASE_URL must be set (see .env.example).');
    sql = neon(url);
  }
  schemaReady ??= createSchema(sql).catch((err) => {
    schemaReady = undefined;
    throw err;
  });
  await schemaReady;
  return sql;
}

export function toNotification(row) {
  return {
    id: row.id,
    clientId: row.client_id ?? undefined,
    vps: row.vps,
    app: row.app,
    title: row.title,
    body: row.body,
    icon: row.icon ?? undefined,
    url: row.url ?? undefined,
    tag: row.tag ?? undefined,
    source: row.source ?? undefined,
    capturedAt: Number(row.captured_at),
    receivedAt: Number(row.received_at),
    read: row.read,
  };
}

export async function summarizeVps(sql) {
  const rows = await sql`
    SELECT vps,
           count(*)::int AS total,
           (count(*) FILTER (WHERE NOT read))::int AS unread,
           max(received_at) AS last_at,
           array_agg(DISTINCT app ORDER BY app) AS apps
    FROM notifications
    GROUP BY vps
    ORDER BY vps`;
  return rows.map((r) => ({
    vps: r.vps,
    total: r.total,
    unread: r.unread,
    lastAt: Number(r.last_at),
    apps: r.apps,
  }));
}
