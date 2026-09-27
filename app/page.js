'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import Pusher from 'pusher-js';
import { CHANNEL, EVENT } from '@/lib/channel';

const PUSHER_KEY = process.env.NEXT_PUBLIC_PUSHER_KEY;
const PUSHER_CLUSTER = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;
const POLL_INTERVAL = 5000;
const GROUP_WINDOW = 5 * 60 * 1000;
const AVATAR_COLORS = ['#4a154b', '#1264a3', '#2bac76', '#e01e5a', '#b7791f', '#0b7a75', '#6d28d9', '#c2410c'];

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

function clockTime(ts, withPeriod = true) {
  const s = new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return withPeriod ? s : s.replace(/\s?[AP]M$/i, '');
}

const dayKey = (ts) => new Date(ts).toDateString();

function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(d) === dayKey(today)) return 'Today';
  if (dayKey(d) === dayKey(yesterday)) return 'Yesterday';
  return d.toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

function initials(name) {
  const letters = String(name).trim().split(/\s+/).slice(0, 2).map((w) => w[0]);
  return letters.join('').toUpperCase() || '?';
}

function avatarColor(name) {
  let hash = 0;
  for (const c of String(name)) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
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
          <span className="brand-logo">N</span>
          <div className="brand-text">
            <span className="brand-name">Notifications</span>
            <span className="brand-status">
              <span className={`dot ${connected ? 'online' : 'offline'}`} />
              {connected ? 'Live' : 'Reconnecting…'}
            </span>
          </div>
        </div>
        <nav className="vps-list">
          <div className="section-label">Machines</div>
          {vpsEntries.map((v) => (
            <div
              key={v.label ? 'all' : `vps:${v.vps}`}
              className={`vps-item ${selectedVps === v.vps ? 'active' : ''} ${v.unread ? 'has-unread' : ''}`}
              onClick={() => setSelectedVps(v.vps)}
            >
              <span className="vps-icon">{v.label ? '◎' : '#'}</span>
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
          {filtered.map((n, i) => {
            const prev = filtered[i - 1];
            const newDay = !prev || dayKey(prev.receivedAt) !== dayKey(n.receivedAt);
            const grouped =
              !newDay &&
              prev.vps === n.vps &&
              prev.app === n.app &&
              prev.title === n.title &&
              prev.pageTitle === n.pageTitle &&
              prev.source === n.source &&
              prev.receivedAt - n.receivedAt < GROUP_WINDOW;
            return (
              <Fragment key={n.id}>
                {newDay && (
                  <li className="day-divider">
                    <span>{dayLabel(n.receivedAt)}</span>
                  </li>
                )}
                <Item
                  n={n}
                  grouped={grouped}
                  flash={flashIds.has(n.id)}
                  onClick={() => !n.read && markRead({ ids: [n.id] })}
                />
              </Fragment>
            );
          })}
        </ul>
        {filtered.length === 0 && <div className="empty">No notifications yet.</div>}
      </main>
    </section>
  );
}

function Avatar({ n }) {
  const [broken, setBroken] = useState(false);
  const name = n.title || n.app;
  if (n.icon && !broken) {
    return <img className="avatar" src={n.icon} referrerPolicy="no-referrer" alt="" onError={() => setBroken(true)} />;
  }
  return (
    <div className="avatar" style={{ background: avatarColor(name) }}>
      {initials(name)}
    </div>
  );
}

function Item({ n, grouped, flash, onClick }) {
  const fullDate = new Date(n.receivedAt).toLocaleString();
  return (
    <li className={`msg ${grouped ? 'grouped' : ''} ${n.read ? '' : 'unread'} ${flash ? 'flash' : ''}`} onClick={onClick}>
      <div className="gutter">
        {grouped ? (
          <time className="hover-time" title={fullDate}>
            {clockTime(n.receivedAt, false)}
          </time>
        ) : (
          <Avatar n={n} />
        )}
      </div>
      <div className="content">
        {!grouped && (
          <div className="head">
            <span className="name">{n.title || n.app}</span>
            <time className="time" title={fullDate}>
              {clockTime(n.receivedAt)}
            </time>
            <span className="chips">
              <span className="chip" title="VPS">{n.vps}</span>
              <span className="chip" title="App">{n.app}</span>
            </span>
          </div>
        )}
        {!grouped && n.pageTitle && (
          <div className="meta-line">
            <span className="meta-item" title="Page title">
              <PageIcon />
              {n.url ? (
                <a href={n.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                  {n.pageTitle}
                </a>
              ) : (
                <span className="meta-text">{n.pageTitle}</span>
              )}
            </span>
          </div>
        )}
        {n.body && (
          <div>
            <span className="body-badge">{n.body}</span>
          </div>
        )}
        {n.source && <div className="bubble">{n.source}</div>}
      </div>
    </li>
  );
}

function PageIcon() {
  return (
    <svg className="meta-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 1.5h5.5L13 5v9.5H4z" />
      <path d="M9.5 1.5V5H13" />
    </svg>
  );
}
