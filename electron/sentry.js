const { app } = require('electron');
const Sentry = require('@sentry/electron/main');

let dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || '';
if (!dsn) {
  try {
    dsn = require('./sentry-dsn');
  } catch {
    dsn = '';
  }
}

Sentry.init({
  dsn: dsn || undefined,
  enabled: Boolean(dsn),
  environment: process.env.SENTRY_ENVIRONMENT || (app.isPackaged ? 'production' : 'development'),
  release: `notification-dashboard@${app.getVersion()}`,
  sendDefaultPii: false,
  tracesSampleRate: 0,
});

module.exports = Sentry;
