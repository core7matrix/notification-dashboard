import { applyRemovalSchedule, getDb, summarizeVps } from '@/lib/db';

export async function GET() {
  const db = await getDb();
  await applyRemovalSchedule(db);
  return Response.json({ items: await summarizeVps(db) });
}
