// One-off copy of notifications and settings from the old Neon Postgres database into MongoDB.
// Usage: node --env-file=.env scripts/migrate-from-neon.mjs
// Needs DATABASE_URL (Neon) and MONGODB_URI. Safe to re-run: rows already copied are skipped.
import { neon } from '@neondatabase/serverless';
import { MongoClient } from 'mongodb';

const { DATABASE_URL, MONGODB_URI, MONGODB_DB = 'notifications' } = process.env;
if (!DATABASE_URL || !MONGODB_URI) {
  console.error('Set both DATABASE_URL (Neon) and MONGODB_URI.');
  process.exit(1);
}

const sql = neon(DATABASE_URL);
const client = new MongoClient(MONGODB_URI);
const db = client.db(MONGODB_DB);

try {
  const rows = await sql`SELECT * FROM notifications ORDER BY seq`;
  const docs = rows.map((r) => ({
    seq: Number(r.seq),
    id: r.id,
    client_id: r.client_id,
    vps: r.vps,
    app: r.app,
    title: r.title,
    body: r.body,
    icon: r.icon,
    url: r.url,
    tag: r.tag,
    source: r.source,
    page_title: r.page_title,
    captured_at: Number(r.captured_at),
    received_at: Number(r.received_at),
    read: r.read,
  }));

  let copied = 0;
  for (let i = 0; i < docs.length; i += 500) {
    const ops = docs.slice(i, i + 500).map((doc) => ({
      updateOne: { filter: { id: doc.id }, update: { $setOnInsert: doc }, upsert: true },
    }));
    const result = await db.collection('notifications').bulkWrite(ops, { ordered: false });
    copied += result.upsertedCount;
  }

  const maxSeq = docs.reduce((max, d) => Math.max(max, d.seq), 0);
  await db.collection('counters').updateOne({ _id: 'notifications' }, { $max: { seq: maxSeq } }, { upsert: true });

  const [settings] = await sql`SELECT remove_enabled, remove_after, remove_every, last_run_at FROM db_settings WHERE id = 1`;
  if (settings) {
    await db.collection('db_settings').updateOne(
      { _id: 1 },
      {
        $set: {
          remove_enabled: settings.remove_enabled,
          remove_after: settings.remove_after,
          remove_every: settings.remove_every,
          last_run_at: settings.last_run_at == null ? null : Number(settings.last_run_at),
        },
      },
      { upsert: true }
    );
  }

  console.log(`Copied ${copied} of ${docs.length} notifications${settings ? ' and the removal settings' : ''}.`);
} finally {
  await client.close();
}
