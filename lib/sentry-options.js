export function sentryInitOptions() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || '';
  return {
    dsn,
    enabled: Boolean(dsn),
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
    tracesSampleRate: process.env.NODE_ENV === 'development' ? 1 : 0.1,
    sendDefaultPii: false,
  };
}
