import { databaseUrl, getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const env = {
    MONGODB_URI: Boolean(databaseUrl()),
    INGEST_API_KEY: Boolean(process.env.INGEST_API_KEY),
    PUSHER: Boolean(
      process.env.PUSHER_APP_ID &&
        process.env.PUSHER_SECRET &&
        process.env.NEXT_PUBLIC_PUSHER_KEY &&
        process.env.NEXT_PUBLIC_PUSHER_CLUSTER
    ),
  };

  let database = 'not configured';
  if (env.MONGODB_URI) {
    try {
      const db = await getDb();
      await db.command({ ping: 1 });
      database = 'ok';
    } catch (err) {
      console.error('Health check database error:', err);
      database = 'connection failed (see Vercel logs)';
    }
  }

  const ok = env.MONGODB_URI && env.INGEST_API_KEY && database === 'ok';
  return Response.json({ ok, env, database }, { status: ok ? 200 : 503 });
}
