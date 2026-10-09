import { neon } from '@neondatabase/serverless';
import { afterOption, DEFAULT_SCHEDULE, everyOption } from './schedule';

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
  await sql`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS page_title text`;
  await sql`
    CREATE TABLE IF NOT EXISTS db_settings (
      id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      remove_enabled boolean NOT NULL DEFAULT false,
      remove_after text NOT NULL DEFAULT '7d',
      remove_every text NOT NULL DEFAULT '1d',
      last_run_at bigint
    )`;
  await sql`INSERT INTO db_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`;
  await sql`UPDATE db_settings SET remove_after = '7d' WHERE remove_after = '30d'`;
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
    pageTitle: row.page_title ?? undefined,
    capturedAt: Number(row.captured_at),
    receivedAt: Number(row.received_at),
    read: row.read,
  };
}

function toSettings(row) {
  const removeAfter = afterOption(row?.remove_after) ? row.remove_after : DEFAULT_SCHEDULE.removeAfter;
  const removeEvery = everyOption(row?.remove_every) ? row.remove_every : DEFAULT_SCHEDULE.removeEvery;
  return {
    enabled: Boolean(row?.remove_enabled),
    removeAfter,
    removeEvery,
    lastRunAt: row?.last_run_at == null ? null : Number(row.last_run_at),
  };
}

export async function getDbSettings(sql) {
  const [row] = await sql`
    SELECT remove_enabled, remove_after, remove_every, last_run_at
    FROM db_settings WHERE id = 1`;
  return toSettings(row);
}

export async function saveDbSettings(sql, input) {
  const after = afterOption(input.removeAfter);
  const every = everyOption(input.removeEvery);
  if (!after || !every || typeof input.enabled !== 'boolean') {
    throw new Error('Invalid removal schedule.');
  }
  const [existing] = await sql`SELECT last_run_at FROM db_settings WHERE id = 1`;
  const lastRunAt = input.enabled && existing?.last_run_at == null ? Date.now() : existing?.last_run_at ?? null;
  const [row] = await sql`
    UPDATE db_settings
    SET remove_enabled = ${input.enabled},
        remove_after = ${after.id},
        remove_every = ${every.id},
        last_run_at = ${lastRunAt}
    WHERE id = 1
    RETURNING remove_enabled, remove_after, remove_every, last_run_at`;
  return toSettings(row);
}

export async function removalPreview(sql, removeAfter) {
  const after = afterOption(removeAfter) || afterOption(DEFAULT_SCHEDULE.removeAfter);
  const cutoff = Date.now() - after.ms;
  const [row] = await sql`
    SELECT count(*)::int AS total,
           (count(*) FILTER (WHERE received_at < ${cutoff}))::int AS due
    FROM notifications`;
  return { total: row.total, due: row.due, cutoff };
}

export async function applyRemovalSchedule(sql) {
  const settings = await getDbSettings(sql);
  if (!settings.enabled) return { removed: 0, ran: false, settings };
  const every = everyOption(settings.removeEvery);
  const now = Date.now();
  if (settings.lastRunAt && every && now - settings.lastRunAt < every.ms) {
    return { removed: 0, ran: false, settings };
  }
  const removed = await deleteOlderThan(sql, settings.removeAfter);
  return { removed, ran: true, settings: { ...settings, lastRunAt: now } };
}

export async function deleteOlderThan(sql, removeAfter) {
  const after = afterOption(removeAfter);
  if (!after) throw new Error('Invalid removal age.');
  const cutoff = Date.now() - after.ms;
  const now = Date.now();
  const [row] = await sql`
    WITH deleted AS (
      DELETE FROM notifications WHERE received_at < ${cutoff} RETURNING 1
    )
    SELECT count(*)::int AS removed FROM deleted`;
  await sql`UPDATE db_settings SET last_run_at = ${now} WHERE id = 1`;
  return row.removed;
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
