import { timingSafeEqual } from 'node:crypto';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set (see .env.example).`);
  return value;
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function isIngestRequest(req) {
  return safeEqual(req.headers.get('x-api-key') || '', requireEnv('INGEST_API_KEY'));
}

export function unauthorized(error = 'Unauthorized', headers) {
  return Response.json({ error }, { status: 401, headers });
}

export function maxNotifications() {
  return Number(process.env.MAX_NOTIFICATIONS) || 2000;
}
