import { timingSafeEqual } from 'node:crypto';
import * as Sentry from '@sentry/nextjs';
import { checkHealth } from '@/lib/health';

export const dynamic = 'force-dynamic';

const MONITOR_SLUG = 'dashboard-health';

function cronAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== 'production';
  const header = req.headers.get('authorization') || '';
  const expected = `Bearer ${secret}`;
  const actualBuffer = Buffer.from(header);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

export async function GET(req) {
  if (!cronAuthorized(req)) {
    return Response.json({ ok: false }, { status: 401 });
  }

  let status = 200;
  let body = { ok: true };
  try {
    const health = await Sentry.withMonitor(
      MONITOR_SLUG,
      async () => {
        const result = await checkHealth();
        if (!result.ok) {
          const failure = new Error(`Dashboard health check failed: ${result.database}`, {
            cause: result.databaseError,
          });
          Sentry.captureException(failure, {
            tags: { source: 'health-check' },
            extra: { database: result.database, env: result.env },
          });
          throw failure;
        }
        return result;
      },
      {
        schedule: { type: 'crontab', value: '*/10 * * * *' },
        checkinMargin: 5,
        maxRuntime: 2,
        timezone: 'Etc/UTC',
      },
    );
    body = { ok: true, database: health.database };
  } catch {
    status = 503;
    body = { ok: false };
  } finally {
    await Sentry.flush(2000);
  }

  return Response.json(body, { status });
}
