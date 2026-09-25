import { getDb, summarizeVps } from '@/lib/db';

export async function GET() {
  const sql = await getDb();
  return Response.json({ items: await summarizeVps(sql) });
}
