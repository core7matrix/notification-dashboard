const fs = require('fs');
const path = require('path');

function readEnvFile(file) {
  const values = {};
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return values;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

const root = path.join(__dirname, '..');
const fromFile = {
  ...readEnvFile(path.join(root, '.env')),
  ...readEnvFile(path.join(root, '.env.local')),
};
const dsn = process.env.SENTRY_DSN || fromFile.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || fromFile.NEXT_PUBLIC_SENTRY_DSN || '';

fs.writeFileSync(path.join(__dirname, 'sentry-dsn.js'), `module.exports = ${JSON.stringify(dsn)};\n`);
