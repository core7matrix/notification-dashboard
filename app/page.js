'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Pusher from 'pusher-js';
import { CHANNEL, EVENT } from '@/lib/channel';

const PUSHER_KEY = process.env.NEXT_PUBLIC_PUSHER_KEY;
const PUSHER_CLUSTER = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;
const POLL_INTERVAL = 5000;

const prefs = {
  get desktop() {
    return localStorage.getItem('desktop') === '1';
  },
  set desktop(v) {
    localStorage.setItem('desktop', v ? '1' : '0');
  },
  get sound() {
    return localStorage.getItem('sound') !== '0';
  },
  set sound(v) {
    localStorage.setItem('sound', v ? '1' : '0');
  },
};

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleString();
}

let audioCtx;
function beep() {
  try {
    audioCtx = audioCtx || new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
  } catch {}
}

function alertNew(items, onClick) {
  if (prefs.sound) beep();
  if (!prefs.desktop || !('Notification' in window) || Notification.permission !== 'granted') return;
  for (const n of items.slice(0, 5)) {
    const note = new Notification(`[${n.vps}] ${n.title || n.app}`, { body: n.body, icon: n.icon, tag: n.id });
    note.onclick = () => {
      window.focus();
      onClick(n);
      note.close();
    };
  }
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

export default function Dashboard() {
  const [items, setItems] = useState([]);
  const [vps, setVps] = useState([]);
  const [selectedVps, setSelectedVps] = useState('');
  const [selectedApp, setSelectedApp] = useState('');
  const [flashIds, setFlashIds] = useState(() => new Set());
  const [connected, setConnected] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [sound, setSound] = useState(true);
  const [, setTick] = useState(0);
  const itemsRef = useRef([]);
  const loadedRef = useRef(false);

  const updateItems = useCallback((fn) => {
    itemsRef.current = fn(itemsRef.current);
    setItems(itemsRef.current);
  }, []);

  const showFresh = useCallback((fresh) => {
    setFlashIds(new Set(fresh.map((n) => n.id)));
    alertNew(fresh, (n) => setSelectedVps(n.vps));
  }, []);

  const loadData = useCallback(async () => {
    const [{ items: latest }, { items: vpsItems }] = await Promise.all([
      api('/api/notifications?limit=1000'),
      api('/api/vps'),
    ]);
    const known = new Set(itemsRef.current.map((n) => n.id));
    const fresh = loadedRef.current ? latest.filter((n) => !known.has(n.id)) : [];
    loadedRef.current = true;
    updateItems(() => latest);
    setVps(vpsItems);
    if (fresh.length) showFresh(fresh);
  }, [updateItems, showFresh]);

  const handleMessage = useCallback(
    (msg) => {
      switch (msg.type) {
        case 'notifications': {
          const known = new Set(itemsRef.current.map((n) => n.id));
          const fresh = msg.items.filter((n) => !known.has(n.id)).reverse();
          if (!fresh.length) return;
          updateItems((prev) => [...fresh, ...prev]);
          showFresh(fresh);
          break;
        }
        case 'vps':
          setVps(msg.items);
          break;
        case 'read': {
          const ids = msg.ids ? new Set(msg.ids) : null;
          updateItems((prev) =>
            prev.map((n) => (!n.read && (ids ? ids.has(n.id) : !msg.vps || n.vps === msg.vps) ? { ...n, read: true } : n))
          );
          break;
        }
        case 'cleared':
          updateItems((prev) => (msg.vps ? prev.filter((n) => n.vps !== msg.vps) : []));
          break;
        case 'sync':
          loadData().catch(console.error);
          break;
      }
    },
    [updateItems, showFresh, loadData]
  );

  useEffect(() => {
    if (!PUSHER_KEY) {
      const poll = () =>
        loadData().then(
          () => setConnected(true),
          () => setConnected(false)
        );
      poll();
      const timer = setInterval(poll, POLL_INTERVAL);
      return () => clearInterval(timer);
    }

    const pusher = new Pusher(PUSHER_KEY, { cluster: PUSHER_CLUSTER });
    pusher.connection.bind('state_change', ({ current }) => setConnected(current === 'connected'));
    const channel = pusher.subscribe(CHANNEL);
    channel.bind('pusher:subscription_succeeded', () => loadData().catch(console.error));
    channel.bind(EVENT, handleMessage);
    return () => pusher.disconnect();
  }, [loadData, handleMessage]);

  useEffect(() => {
    setDesktop(prefs.desktop && 'Notification' in window && Notification.permission === 'granted');
    setSound(prefs.sound);
    const timer = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(timer);
  }, []);

  const totalUnread = vps.reduce((sum, v) => sum + v.unread, 0);

  useEffect(() => {
    document.title = totalUnread ? `(${totalUnread}) Notification Dashboard` : 'Notification Dashboard';
  }, [totalUnread]);

  const apps = [...new Set(items.map((n) => n.app))].sort();
  const appFilter = apps.includes(selectedApp) ? selectedApp : '';
  const filtered = items.filter((n) => (!selectedVps || n.vps === selectedVps) && (!appFilter || n.app === appFilter));
  const vpsEntries = [{ vps: '', label: 'All VPS', unread: totalUnread, lastAt: 0 }, ...vps];

  function markRead(body) {
    api('/api/notifications/read', { method: 'POST', body: JSON.stringify(body) }).catch(console.error);
  }

  function clearAll() {
    const scope = selectedVps ? `all notifications from ${selectedVps}` : 'ALL notifications';
    if (!confirm(`Delete ${scope}?`)) return;
    const q = selectedVps ? `?vps=${encodeURIComponent(selectedVps)}` : '';
    api(`/api/notifications${q}`, { method: 'DELETE' }).catch(console.error);
  }

  async function toggleDesktop(e) {
    if (!e.target.checked) {
      prefs.desktop = false;
      setDesktop(false);
      return;
    }
    if (!('Notification' in window)) {
      alert('This browser does not support desktop notifications.');
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      alert('Notification permission was denied. Allow it in the browser site settings.');
      prefs.desktop = false;
      return;
    }
    prefs.desktop = true;
    setDesktop(true);
  }

  function toggleSound(e) {
    prefs.sound = e.target.checked;
    setSound(e.target.checked);
    if (e.target.checked) beep();
  }

  return (
    <section className="app">
      <aside className="sidebar">
        <div className="brand">
          <span>Notifications</span>
          <span
            className={`dot ${connected ? 'online' : 'offline'}`}
            title={connected ? 'Connected' : 'Disconnected - reconnecting'}
          />
        </div>
        <nav className="vps-list">
          {vpsEntries.map((v) => (
            <div
              key={v.label ? 'all' : `vps:${v.vps}`}
              className={`vps-item ${selectedVps === v.vps ? 'active' : ''}`}
              onClick={() => setSelectedVps(v.vps)}
            >
              <span className="name">{v.label || v.vps}</span>
              {v.lastAt ? <span className="meta">{timeAgo(v.lastAt)}</span> : null}
              {v.unread ? <span className="badge">{v.unread}</span> : null}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <label className="toggle">
            <input type="checkbox" checked={desktop} onChange={toggleDesktop} />
            Desktop notifications
          </label>
          <label className="toggle">
            <input type="checkbox" checked={sound} onChange={toggleSound} />
            Sound
          </label>
        </div>
      </aside>

      <main className="main">
        <header className="toolbar">
          <h2>{selectedVps || 'All VPS'}</h2>
          <select value={appFilter} onChange={(e) => setSelectedApp(e.target.value)}>
            <option value="">All apps</option>
            {apps.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <div className="spacer" />
          <button className="secondary" onClick={() => markRead(selectedVps ? { vps: selectedVps } : {})}>
            Mark all read
          </button>
          <button className="danger" onClick={clearAll}>
            Clear
          </button>
        </header>
        <ul className="list">
          {filtered.map((n) => (
            <Item
              key={n.id}
              n={n}
              flash={flashIds.has(n.id)}
              onClick={() => !n.read && markRead({ ids: [n.id] })}
            />
          ))}
        </ul>
        {filtered.length === 0 && <div className="empty">No notifications yet.</div>}
      </main>
    </section>
  );
}

function Item({ n, flash, onClick }) {
  const [iconBroken, setIconBroken] = useState(false);
  return (
    <li className={`item ${n.read ? '' : 'unread'} ${flash ? 'flash' : ''}`} onClick={onClick}>
      {n.icon && !iconBroken ? (
        <img src={n.icon} referrerPolicy="no-referrer" alt="" onError={() => setIconBroken(true)} />
      ) : (
        <div className="avatar" />
      )}
      <div className="content">
        <div className="head">
          <span className="title">{n.title}</span>
          <span className="tag">{n.vps}</span>
          <span className="tag app">{n.app}</span>
          <span className="time">{timeAgo(n.receivedAt)}</span>
        </div>
        <div className="body">{n.body}</div>
      </div>
    </li>
  );
}
