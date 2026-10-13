# Notification Dashboard

Live dashboard for notifications captured by browser extensions on VPS machines. Extensions post messages to this app; the dashboard stores them in Neon and shows them as they arrive.

## How it works

1. An extension on a VPS sends one or more notifications to `POST /api/notifications/ingest` with an `X-API-Key` header.
2. The app stores them in Postgres (Neon). Duplicate `id` values from the client are ignored.
3. New, updated, and deleted messages are pushed to open dashboards over Pusher. If Pusher is not configured, the page falls back to polling every 5 seconds.
4. The optional Electron shell opens the deployed dashboard, shows Windows toasts, and puts an unread count on the tray icon.

## Dashboard

- Machines are listed in the sidebar, with unread counts and a search field.
- Messages are grouped by day and can be filtered by machine, app, or unread.
- Mark messages read, delete one message, or clear a machine or the whole list.
- Light and dark themes follow the system until you switch them.
- Optional sound and desktop notifications for new messages (the Electron shell shows the Windows toast itself).
- Database settings show the Neon plan and a schedule that deletes messages older than 1 hour, 6 hours, 1 day, or 7 days.

## Setup

Requires Node.js 20.9 or newer.

```bash
npm install
```

Create a `.env.local` with:

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Neon (or other Postgres) connection string. `POSTGRES_URL` is also accepted. |
| `INGEST_API_KEY` | yes | Shared secret the extension sends as `X-API-Key`. |
| `NEXT_PUBLIC_PUSHER_KEY` | for live updates | Pusher key, exposed to the browser. |
| `NEXT_PUBLIC_PUSHER_CLUSTER` | for live updates | Pusher cluster. |
| `PUSHER_APP_ID` | for live updates | Pusher app id, server only. |
| `PUSHER_SECRET` | for live updates | Pusher secret, server only. |
| `MAX_NOTIFICATIONS` | no | Cap on stored rows. Defaults to `2000`. Older rows are dropped after each ingest. |
| `NEON_API_KEY` | no | Neon API token so Database settings can show the plan. Without it, the app tries `~/.config/neon/credentials.json`. |

Tables are created on first use.

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). `GET /healthz` reports whether the database and ingest key are configured.

## Ingest API

`POST /api/notifications/ingest`

```
X-API-Key: <INGEST_API_KEY>
Content-Type: application/json
```

Send one notification, or a batch:

```json
{
  "notifications": [
    {
      "id": "extension-message-id",
      "vps": "vps-1",
      "app": "Slack",
      "title": "New message",
      "body": "Hello",
      "icon": "https://example.com/icon.png",
      "url": "https://example.com/thread",
      "tag": "channel",
      "source": "extension",
      "pageTitle": "Slack",
      "capturedAt": 1710000000000
    }
  ]
}
```

`title` or `body` is required. `vps` defaults to `unnamed-vps` and `app` to `unknown`. `icon` and `url` must be `http` or `https`. Up to 100 notifications are accepted per request. The response is `{ "ok": true, "added": 1 }`.

## Desktop app

The Electron app is a window around the hosted dashboard, plus a tray icon and native toasts. It loads `DASHBOARD_URL`, which defaults to the deployed site.

```bash
npm run electron
```

Point it at a local server:

```bash
DASHBOARD_URL=http://localhost:3000 npm run electron
```

Closing the window hides it. Quit from the tray menu. A Windows installer is built with:

```bash
npm run dist
```

Output goes to `release/`.
