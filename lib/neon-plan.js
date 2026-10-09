import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const API = 'https://console.neon.tech/api/v2/users/me';
const CACHE_MS = 5 * 60 * 1000;

let cache = { at: 0, value: null };

function describe(plan, note) {
  const name = String(plan || '').toLowerCase();
  if (!name) return { status: 'unknown', plan: null, note: note || 'Neon did not report a plan.' };
  return {
    status: name === 'free' ? 'free' : 'paid',
    plan: name,
    note: note || null,
  };
}

async function planFromToken(token) {
  const res = await fetch(API, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Neon API ${res.status}`);
  const body = await res.json();
  return body.plan;
}

async function storedAccessToken() {
  if (process.env.NEON_API_KEY) return process.env.NEON_API_KEY;
  try {
    const file = path.join(homedir(), '.config', 'neon', 'credentials.json');
    const credentials = JSON.parse(await readFile(file, 'utf8'));
    if (credentials.type && credentials.type !== 'oauth') return null;
    if (!credentials.access_token) return null;
    if (credentials.expires_at && Number(credentials.expires_at) < Date.now() + 30_000) return null;
    return credentials.access_token;
  } catch {
    return null;
  }
}

function planFromCli() {
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return new Promise((resolve, reject) => {
    execFile(
      command,
      ['--yes', 'neonctl', 'me', '--output', 'json'],
      { timeout: 40_000, windowsHide: true },
      (err, stdout) => {
        if (err) {
          reject(err);
          return;
        }
        try {
          resolve(JSON.parse(stdout).plan);
        } catch (parseErr) {
          reject(parseErr);
        }
      }
    );
  });
}

export async function getNeonPlan() {
  if (cache.value && Date.now() - cache.at < CACHE_MS) return cache.value;

  try {
    const token = await storedAccessToken();
    const plan = token ? await planFromToken(token) : await planFromCli();
    const value = describe(plan);
    cache = { at: Date.now(), value };
    return value;
  } catch {
    return describe(null, 'Could not reach Neon. Sign in with the Neon CLI on this machine, or set NEON_API_KEY.');
  }
}

export function databaseHost() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) return null;
  try {
    return new URL(url).hostname.replace('-pooler', '');
  } catch {
    return null;
  }
}
