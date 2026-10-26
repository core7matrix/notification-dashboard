import { databaseUrl } from './db';

const FREE_TIER_BYTES = 512 * 1024 * 1024;

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function getDatabasePlan(db) {
  const host = databaseHost();
  const plan = host?.endsWith('.mongodb.net') ? 'Atlas' : 'MongoDB';
  try {
    const stats = await db.command({ dbStats: 1 });
    const used = Number(stats.storageSize || 0) + Number(stats.indexSize || 0);
    const share = Math.round((used / FREE_TIER_BYTES) * 100);
    return {
      status: 'unknown',
      plan,
      note: `Using ${formatBytes(used)} of storage (${share}% of the 512 MB free-tier limit).`,
    };
  } catch {
    return { status: 'unknown', plan, note: 'Could not read storage size from MongoDB.' };
  }
}

export function databaseHost() {
  const url = databaseUrl();
  if (!url) return null;
  try {
    return new URL(url.replace(/^mongodb(\+srv)?:/, 'http:')).hostname;
  } catch {
    return null;
  }
}
