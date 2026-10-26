import dns from 'node:dns';
import { MongoClient } from 'mongodb';
import { afterOption, DEFAULT_SCHEDULE, everyOption } from './schedule';

// Vercel's DNS prefers IPv6, and Atlas does not accept those connections.
dns.setDefaultResultOrder('ipv4first');

// Reuse one client across hot reloads and warm serverless invocations.
const cached = (globalThis._mongo ??= { client: null, db: null, schemaReady: null });

export function databaseUrl() {
  return process.env.MONGODB_URI || null;
}

export function safeDbError(err) {
  const message = String(err?.message || err)
    .replace(/mongodb(?:\+srv)?:\/\/\S+/gi, 'mongodb://…')
    .replace(/\/\/[^@\s/]+@/g, '//…@')
    .slice(0, 300);
  return { name: err?.name || 'Error', message };
}

async function createSchema(db) {
  const notifications = db.collection('notifications');
  await notifications.createIndexes([
    { key: { id: 1 }, name: 'id_unique', unique: true },
    {
      key: { client_id: 1 },
      name: 'client_id_unique',
      unique: true,
      partialFilterExpression: { client_id: { $type: 'string' } },
    },
    { key: { seq: -1 }, name: 'seq_desc', unique: true },
    { key: { vps: 1, seq: -1 }, name: 'vps_seq' },
    { key: { received_at: 1 }, name: 'received_at' },
  ]);
  await db.collection('db_settings').updateOne(
    { _id: 1 },
    {
      $setOnInsert: {
        remove_enabled: false,
        remove_after: DEFAULT_SCHEDULE.removeAfter,
        remove_every: DEFAULT_SCHEDULE.removeEvery,
        last_run_at: null,
      },
    },
    { upsert: true }
  );
}

export async function getDb() {
  if (!cached.db) {
    const url = databaseUrl();
    if (!url) throw new Error('MONGODB_URI must be set (see .env.example).');
    cached.client = new MongoClient(url, {
      appName: 'notification-dashboard',
      family: 4,
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 8000,
    });
    cached.db = cached.client.db(process.env.MONGODB_DB || 'notifications');
  }
  cached.schemaReady ??= createSchema(cached.db).catch((err) => {
    cached.schemaReady = null;
    cached.db = null;
    cached.client?.close().catch(() => {});
    cached.client = null;
    throw err;
  });
  await cached.schemaReady;
  return cached.db;
}

// Reserves `count` consecutive sequence numbers so notifications keep their arrival order.
export async function nextSeq(db, count) {
  const counter = await db
    .collection('counters')
    .findOneAndUpdate({ _id: 'notifications' }, { $inc: { seq: count } }, { upsert: true, returnDocument: 'after' });
  return counter.seq - count + 1;
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

export async function getDbSettings(db) {
  return toSettings(await db.collection('db_settings').findOne({ _id: 1 }));
}

export async function saveDbSettings(db, input) {
  const after = afterOption(input.removeAfter);
  const every = everyOption(input.removeEvery);
  if (!after || !every || typeof input.enabled !== 'boolean') {
    throw new Error('Invalid removal schedule.');
  }
  const settings = db.collection('db_settings');
  const existing = await settings.findOne({ _id: 1 });
  const lastRunAt = input.enabled && existing?.last_run_at == null ? Date.now() : existing?.last_run_at ?? null;
  const row = await settings.findOneAndUpdate(
    { _id: 1 },
    {
      $set: {
        remove_enabled: input.enabled,
        remove_after: after.id,
        remove_every: every.id,
        last_run_at: lastRunAt,
      },
    },
    { upsert: true, returnDocument: 'after' }
  );
  return toSettings(row);
}

export async function removalPreview(db, removeAfter) {
  const after = afterOption(removeAfter) || afterOption(DEFAULT_SCHEDULE.removeAfter);
  const cutoff = Date.now() - after.ms;
  const notifications = db.collection('notifications');
  const [total, due] = await Promise.all([
    notifications.countDocuments(),
    notifications.countDocuments({ received_at: { $lt: cutoff } }),
  ]);
  return { total, due, cutoff };
}

export async function applyRemovalSchedule(db) {
  const settings = await getDbSettings(db);
  if (!settings.enabled) return { removed: 0, ran: false, settings };
  const every = everyOption(settings.removeEvery);
  const now = Date.now();
  if (settings.lastRunAt && every && now - settings.lastRunAt < every.ms) {
    return { removed: 0, ran: false, settings };
  }
  const removed = await deleteOlderThan(db, settings.removeAfter);
  return { removed, ran: true, settings: { ...settings, lastRunAt: now } };
}

export async function deleteOlderThan(db, removeAfter) {
  const after = afterOption(removeAfter);
  if (!after) throw new Error('Invalid removal age.');
  const cutoff = Date.now() - after.ms;
  const now = Date.now();
  const { deletedCount } = await db.collection('notifications').deleteMany({ received_at: { $lt: cutoff } });
  await db.collection('db_settings').updateOne({ _id: 1 }, { $set: { last_run_at: now } });
  return deletedCount;
}

export async function summarizeVps(db) {
  const rows = await db
    .collection('notifications')
    .aggregate([
      {
        $group: {
          _id: '$vps',
          total: { $sum: 1 },
          unread: { $sum: { $cond: ['$read', 0, 1] } },
          last_at: { $max: '$received_at' },
          apps: { $addToSet: '$app' },
        },
      },
      { $sort: { _id: 1 } },
    ])
    .toArray();
  return rows.map((r) => ({
    vps: r._id,
    total: r.total,
    unread: r.unread,
    lastAt: Number(r.last_at),
    apps: r.apps.sort(),
  }));
}
