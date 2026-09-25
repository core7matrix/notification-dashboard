import Pusher from 'pusher';
import { CHANNEL, EVENT } from './channel';

// Pusher rejects event payloads over 10KB.
const MAX_EVENT_BYTES = 9000;

let client;

function getPusher() {
  if (client !== undefined) return client;
  const { PUSHER_APP_ID, PUSHER_SECRET, NEXT_PUBLIC_PUSHER_KEY, NEXT_PUBLIC_PUSHER_CLUSTER } = process.env;
  client =
    PUSHER_APP_ID && PUSHER_SECRET && NEXT_PUBLIC_PUSHER_KEY && NEXT_PUBLIC_PUSHER_CLUSTER
      ? new Pusher({
          appId: PUSHER_APP_ID,
          key: NEXT_PUBLIC_PUSHER_KEY,
          secret: PUSHER_SECRET,
          cluster: NEXT_PUBLIC_PUSHER_CLUSTER,
          useTLS: true,
        })
      : null;
  return client;
}

export async function broadcast(...messages) {
  const pusher = getPusher();
  if (!pusher) return;
  const tooBig = messages.some((m) => Buffer.byteLength(JSON.stringify(m)) > MAX_EVENT_BYTES);
  const batch = (tooBig ? [{ type: 'sync' }] : messages).map((data) => ({ channel: CHANNEL, name: EVENT, data }));
  try {
    await pusher.triggerBatch(batch);
  } catch (err) {
    console.error('Pusher broadcast failed:', err.message);
  }
}
