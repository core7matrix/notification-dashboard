import { applyRemovalSchedule, getDb, summarizeVps } from '@/lib/db';

export async function GET() {
  const sql = await getDb();
  await applyRemovalSchedule(sql);
  return Response.json({ items: await summarizeVps(sql) });
}
