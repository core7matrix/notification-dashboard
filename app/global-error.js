'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({ error }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#0f1115',
          color: '#f5f6f8',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <main style={{ maxWidth: 420, padding: 24 }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 8px' }}>Something went wrong</h1>
          <p style={{ margin: 0, color: '#c7cad1' }}>This error was reported. Reload the page to try again.</p>
        </main>
      </body>
    </html>
  );
}
