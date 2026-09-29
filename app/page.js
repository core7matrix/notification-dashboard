'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Pusher from 'pusher-js';
import { CHANNEL, EVENT } from '@/lib/channel';

const PUSHER_KEY = process.env.NEXT_PUBLIC_PUSHER_KEY;
const PUSHER_CLUSTER = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;
const POLL_INTERVAL = 5000;
const GROUP_WINDOW = 5 * 60 * 1000;
const VPS_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16'];
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
  set theme(v) {
    localStorage.setItem('theme', v);
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

function timeZoneInfo(ts) {
  const d = new Date(ts);
  const zoneName = (style) =>
    new Intl.DateTimeFormat([], { timeZoneName: style }).formatToParts(d).find((p) => p.type === 'timeZoneName')?.value;
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const offset = `UTC${sign}${Math.floor(abs / 60)}${abs % 60 ? `:${String(abs % 60).padStart(2, '0')}` : ''}`;
  const iana = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return {
    short: zoneName('short') || offset,
    title: [zoneName('long'), iana, offset].filter(Boolean).join(' · '),
  };
}

function dayParts(ts) {
  const d = new Date(ts);
  const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const daysAgo = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const date = d.toLocaleDateString([], { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' });

  if (daysAgo === 0) return { label: 'Today', sub: date };
  if (daysAgo === 1) return { label: 'Yesterday', sub: date };
  if (daysAgo > 1 && daysAgo < 7) return { label: d.toLocaleDateString([], { weekday: 'long' }), sub: date };
  return { label: d.toLocaleDateString([], { weekday: 'short', month: 'long', day: 'numeric', year: sameYear ? undefined : 'numeric' }), sub: null };
}

function groupByDay(items) {
  const days = [];
  for (const n of items) {
    const key = dayKey(n.receivedAt);
    if (days.at(-1)?.key !== key) days.push({ key, items: [] });
    days.at(-1).items.push(n);
  }
  return days;
}

function initials(name) {
  const letters = String(name).trim().split(/\s+/).slice(0, 2).map((w) => w[0]);
  return letters.join('').toUpperCase() || '?';
}

function pickColor(name, palette) {
  let hash = 0;
  for (const c of String(name)) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

const avatarColor = (name) => pickColor(name, AVATAR_COLORS);
const vpsColor = (name) => pickColor(name, VPS_COLORS);

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

function withRead(items, { ids, vps }) {
  const idSet = ids ? new Set(ids) : null;
  return items.map((n) => (!n.read && (idSet ? idSet.has(n.id) : !vps || n.vps === vps) ? { ...n, read: true } : n));
}

function withReadCounts(vpsList, items, { ids, vps }) {
  if (!ids) return vpsList.map((v) => (!vps || v.vps === vps ? { ...v, unread: 0 } : v));
  const idSet = new Set(ids);
  const perVps = {};
  for (const n of items) {
    if (!n.read && idSet.has(n.id)) perVps[n.vps] = (perVps[n.vps] || 0) + 1;
  }
  return vpsList.map((v) => (perVps[v.vps] ? { ...v, unread: Math.max(0, v.unread - perVps[v.vps]) } : v));
}

function withoutIds(items, ids) {
  const idSet = new Set(ids);
  return items.filter((n) => !idSet.has(n.id));
}

function applyChange(items, vpsList, { kind, body }) {
  if (kind === 'delete') {
    const idSet = new Set(body.ids);
    const removed = items.filter((n) => idSet.has(n.id));
    const nextVps = withReadCounts(vpsList, removed, body).map((v) => {
      const count = removed.filter((n) => n.vps === v.vps).length;
      return count ? { ...v, total: Math.max(0, v.total - count) } : v;
    });
    return [withoutIds(items, body.ids), nextVps];
  }
  return [withRead(items, body), withReadCounts(vpsList, items, body)];
}

export default function Dashboard() {
  const [items, setItems] = useState([]);
  const [vps, setVps] = useState([]);
  const [selectedVps, setSelectedVps] = useState('');
  const [selectedApp, setSelectedApp] = useState('');
  const [vpsQuery, setVpsQuery] = useState('');
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [theme, setTheme] = useState('light');
  const [flashIds, setFlashIds] = useState(() => new Set());
  const [connected, setConnected] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [sound, setSound] = useState(true);
  const [confirmClear, setConfirmClear] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [confirmMarkRead, setConfirmMarkRead] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [, setTick] = useState(0);
  const itemsRef = useRef([]);
  const loadedRef = useRef(false);
  // Reads/deletes not yet confirmed by the server, re-applied to any fetch that may predate them.
  const pendingRef = useRef([]);

  const updateItems = useCallback((fn) => {
    itemsRef.current = fn(itemsRef.current);
    setItems(itemsRef.current);
  }, []);

  const applyRead = useCallback((body) => updateItems((prev) => withRead(prev, body)), [updateItems]);

  const showFresh = useCallback((fresh) => {
    setFlashIds(new Set(fresh.map((n) => n.id)));
    alertNew(fresh, (n) => setSelectedVps(n.vps));
  }, []);

  const loadData = useCallback(async () => {
    const startedAt = Date.now();
    const [{ items: fetchedItems }, { items: fetchedVps }] = await Promise.all([
      api('/api/notifications?limit=1000'),
      api('/api/vps'),
    ]);
    pendingRef.current = pendingRef.current.filter((p) => !p.doneAt || p.doneAt >= startedAt);
    let latest = fetchedItems;
    let vpsItems = fetchedVps;
    for (const change of pendingRef.current) [latest, vpsItems] = applyChange(latest, vpsItems, change);
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
        case 'read':
          applyRead(msg);
          break;
        case 'deleted':
          updateItems((prev) => withoutIds(prev, msg.ids));
          break;
        case 'cleared':
          updateItems((prev) => (msg.vps ? prev.filter((n) => n.vps !== msg.vps) : []));
          break;
        case 'sync':
          loadData().catch(console.error);
          break;
      }
    },
    [updateItems, applyRead, showFresh, loadData]
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
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
    const timer = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e) => e.key === 'Escape' && setNavOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  const totalUnread = vps.reduce((sum, v) => sum + v.unread, 0);

  useEffect(() => {
    document.title = totalUnread ? `(${totalUnread}) Notification Dashboard` : 'Notification Dashboard';
  }, [totalUnread]);

  const apps = [...new Set(items.map((n) => n.app))].sort();
  const appFilter = apps.includes(selectedApp) ? selectedApp : '';
  const scoped = items.filter((n) => (!selectedVps || n.vps === selectedVps) && (!appFilter || n.app === appFilter));
  const scopedUnread = scoped.filter((n) => !n.read).length;
  const markReadCount = selectedVps ? (vps.find((v) => v.vps === selectedVps)?.unread ?? 0) : totalUnread;
  const filtered = onlyUnread ? scoped.filter((n) => !n.read) : scoped;
  const allEntry = { vps: '', label: 'All machines', unread: totalUnread, lastAt: 0 };
  const vpsNeedle = vpsQuery.trim().toLowerCase();
  const visibleVps = vpsNeedle ? vps.filter((v) => v.vps.toLowerCase().includes(vpsNeedle)) : vps;

  function selectVps(name) {
    setSelectedVps(name);
    setNavOpen(false);
  }

  function runChange(change, request) {
    const before = itemsRef.current;
    setVps((prev) => applyChange(before, prev, change)[1]);
    updateItems((prev) => applyChange(prev, [], change)[0]);

    pendingRef.current.push(change);
    request.then(
      () => {
        change.doneAt = Date.now();
      },
      (err) => {
        console.error(err);
        pendingRef.current = pendingRef.current.filter((p) => p !== change);
        loadData().catch(console.error);
      }
    );
  }

  function markRead(body) {
    runChange({ kind: 'read', body }, api('/api/notifications/read', { method: 'POST', body: JSON.stringify(body) }));
  }

  function deleteOne(id) {
    runChange({ kind: 'delete', body: { ids: [id] } }, api(`/api/notifications/${id}`, { method: 'DELETE' }));
  }

  function clearAll() {
    setConfirmClear(false);
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

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    prefs.theme = next;
    setTheme(next);
  }

  function toggleSound(e) {
    prefs.sound = e.target.checked;
    setSound(e.target.checked);
    if (e.target.checked) beep();
  }

  return (
    <section className="app">
      {navOpen && <div className="sidebar-backdrop" onClick={() => setNavOpen(false)} />}
      <aside className={`sidebar ${navOpen ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-logo">
            <BellIcon />
          </span>
          <div className="brand-text">
            <span className="brand-name">Notifications</span>
            <span className="brand-sub">Monitoring console</span>
          </div>
          <span
            className={`status-pill ${connected ? 'online' : 'offline'}`}
            title={connected ? 'Connected' : 'Reconnecting…'}
          >
            <span className="dot" />
            {connected ? 'Live' : 'Offline'}
          </span>
        </div>

        <div className="sidebar-stats">
          <div className="stat">
            <span className="stat-value">{totalUnread}</span>
            <span className="stat-label">Unread</span>
          </div>
          <div className="stat">
            <span className="stat-value">{vps.length}</span>
            <span className="stat-label">Machines</span>
          </div>
        </div>

        <div className="sidebar-search">
          <SearchIcon />
          <input
            type="search"
            placeholder="Find machine…"
            value={vpsQuery}
            onChange={(e) => setVpsQuery(e.target.value)}
            aria-label="Find machine"
          />
        </div>

        <nav className="vps-list">
          <div className="section-label">Overview</div>
          <VpsItem v={allEntry} active={selectedVps === ''} onSelect={selectVps} />
          <div className="section-label">
            Machines
            <span className="section-count">{visibleVps.length}</span>
          </div>
          {visibleVps.map((v) => (
            <VpsItem key={v.vps} v={v} active={selectedVps === v.vps} onSelect={selectVps} />
          ))}
          {visibleVps.length === 0 && (
            <div className="vps-empty">{vpsQuery ? 'No matching machines' : 'No machines yet'}</div>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="section-label">Preferences</div>
          <label className="toggle">
            <MonitorIcon />
            <span className="toggle-label">Desktop alerts</span>
            <input type="checkbox" checked={desktop} onChange={toggleDesktop} />
          </label>
          <label className="toggle">
            <SoundIcon />
            <span className="toggle-label">Sound</span>
            <input type="checkbox" checked={sound} onChange={toggleSound} />
          </label>
        </div>
      </aside>

      <main className="main">
        <header className="toolbar">
          <div className="toolbar-title">
            <button className="btn menu-btn" onClick={() => setNavOpen(true)} aria-label="Open machine list">
              <MenuIcon />
              {totalUnread > 0 && <span className="menu-dot" />}
            </button>
            {selectedVps ? (
              <span className="vps-icon title-icon" style={{ '--c': vpsColor(selectedVps) }}>
                {selectedVps.charAt(0).toUpperCase()}
              </span>
            ) : (
              <span className="vps-icon all title-icon">
                <GridIcon />
              </span>
            )}
            <div className="title-text">
              <h2>{selectedVps || 'All machines'}</h2>
              <span className="subtitle">
                {scoped.length} notification{scoped.length === 1 ? '' : 's'}
                {scopedUnread ? (
                  <>
                    {' '}
                    · <strong>{scopedUnread} unread</strong>
                  </>
                ) : (
                  ' · All caught up'
                )}
              </span>
            </div>
          </div>
          <div className="spacer" />
          <div className="toolbar-actions">
            <div className="segmented" role="group" aria-label="Show">
              <button
                className={!onlyUnread ? 'on' : ''}
                aria-pressed={!onlyUnread}
                onClick={() => setOnlyUnread(false)}
              >
                All
              </button>
              <button className={onlyUnread ? 'on' : ''} aria-pressed={onlyUnread} onClick={() => setOnlyUnread(true)}>
                Unread
              </button>
            </div>
            <div className="select-wrap">
              <FilterIcon />
              <select value={appFilter} onChange={(e) => setSelectedApp(e.target.value)} aria-label="Filter by app">
                <option value="">All apps</option>
                {apps.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <span className="toolbar-sep" />
            <button
              className="btn"
              disabled={!scopedUnread}
              onClick={() => setConfirmMarkRead(true)}
              title="Mark all read"
            >
              <CheckIcon />
              <span className="btn-label">Mark all read</span>
            </button>
            <button className="btn danger" disabled={!scoped.length} onClick={() => setConfirmClear(true)} title="Delete notifications">
              <TrashIcon />
              <span className="btn-label">Clear</span>
            </button>
            <span className="toolbar-sep" />
            <button
              className="btn theme-btn"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
            </button>
          </div>
        </header>
        <div className="feed-scroll">
          {filtered.length > 0 && (
            <ul className="list">
              {groupByDay(filtered).map((day) => {
                const { label, sub } = dayParts(day.items[0].receivedAt);
                const tz = timeZoneInfo(day.items[0].receivedAt);
                const unread = day.items.filter((n) => !n.read).length;
                return (
                  <li key={day.key} className="day-group">
                    <div className="day-divider">
                      <span className="day-pill">
                        <span className="day-label">{label}</span>
                        {sub && <span className="day-sub">{sub}</span>}
                        <span className="day-tz" title={tz.title}>
                          <GlobeIcon />
                          {tz.short}
                        </span>
                        <span className="day-count" title={`${day.items.length} messages, ${unread} unread`}>
                          {unread ? (
                            <>
                              <span className="day-unread-dot" />
                              {unread} unread
                            </>
                          ) : (
                            day.items.length
                          )}
                        </span>
                      </span>
                    </div>
                    <ul className="day-items">
                      {day.items.map((n, i) => {
                        const prev = day.items[i - 1];
                        const grouped =
                          !!prev &&
                          prev.vps === n.vps &&
                          prev.app === n.app &&
                          prev.title === n.title &&
                          prev.pageTitle === n.pageTitle &&
                          prev.source === n.source &&
                          prev.receivedAt - n.receivedAt < GROUP_WINDOW;
                        return (
                          <Item
                            key={n.id}
                            n={n}
                            grouped={grouped}
                            flash={flashIds.has(n.id)}
                            onClick={() => !n.read && markRead({ ids: [n.id] })}
                            onDelete={() => setPendingDelete(n)}
                          />
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}
          {filtered.length === 0 && (
            <div className="empty">
              <span className="empty-icon">
                <InboxIcon />
              </span>
              <h3>{onlyUnread && scoped.length ? 'All caught up' : 'No notifications yet'}</h3>
              <p>
                {onlyUnread && scoped.length
                  ? 'There are no unread notifications here.'
                  : 'New notifications will show up here as they arrive.'}
              </p>
            </div>
          )}
        </div>
      </main>
      {confirmClear && (
        <ConfirmModal
          title="Delete notifications?"
          message={
            selectedVps ? (
              <>
                All notifications from <strong>{selectedVps}</strong> will be permanently deleted.
              </>
            ) : (
              'All notifications from every machine will be permanently deleted.'
            )
          }
          confirmLabel="Delete"
          onConfirm={clearAll}
          onCancel={() => setConfirmClear(false)}
        />
      )}
      {confirmMarkRead && (
        <ConfirmModal
          tone="primary"
          icon={<CheckIcon />}
          title="Mark all as read?"
          message={
            <>
              <strong>{markReadCount}</strong> unread {markReadCount === 1 ? 'notification' : 'notifications'} from{' '}
              {selectedVps ? <strong>{selectedVps}</strong> : 'every machine'} will be marked as read.
            </>
          }
          confirmLabel="Mark as read"
          onConfirm={() => {
            markRead(selectedVps ? { vps: selectedVps } : {});
            setConfirmMarkRead(false);
          }}
          onCancel={() => setConfirmMarkRead(false)}
        />
      )}
      {pendingDelete && (
        <ConfirmModal
          title="Delete message?"
          message={
            <>
              This message from <strong>{pendingDelete.title || pendingDelete.app}</strong> will be permanently
              deleted.
            </>
          }
          confirmLabel="Delete"
          onConfirm={() => {
            deleteOne(pendingDelete.id);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </section>
  );
}

const MODAL_EXIT_MS = 160;

function ConfirmModal({ title, message, confirmLabel, onConfirm, onCancel, tone = 'danger', icon = <TrashIcon /> }) {
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const timerRef = useRef(null);

  const close = useCallback((action) => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    timerRef.current = setTimeout(action, MODAL_EXIT_MS);
  }, []);

  const cancel = useCallback(() => close(onCancel), [close, onCancel]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && cancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancel]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return (
    <div className={`modal-backdrop ${closing ? 'closing' : ''}`} onClick={cancel}>
      <div
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`modal-icon ${tone}`}>{icon}</div>
        <h2 id="modal-title" className="modal-title">
          {title}
        </h2>
        <p className="modal-message">{message}</p>
        <div className="modal-actions">
          <button className="btn" onClick={cancel} autoFocus>
            Cancel
          </button>
          <button className={`btn ${tone}-solid`} onClick={() => close(onConfirm)}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function VpsItem({ v, active, onSelect }) {
  return (
    <div
      className={`vps-item ${active ? 'active' : ''} ${v.unread ? 'has-unread' : ''}`}
      role="button"
      tabIndex={0}
      aria-current={active ? 'page' : undefined}
      onClick={() => onSelect(v.vps)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(v.vps);
        }
      }}
    >
      {v.label ? (
        <span className="vps-icon all">
          <GridIcon />
        </span>
      ) : (
        <span className="vps-icon" style={{ '--c': vpsColor(v.vps) }}>
          {v.vps.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="name-wrap">
        <span className="name">{v.label || v.vps}</span>
        {v.lastAt ? <span className="meta">Last seen {timeAgo(v.lastAt)}</span> : null}
      </span>
      {v.unread ? <span className="badge">{v.unread > 99 ? '99+' : v.unread}</span> : null}
    </div>
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

function Item({ n, grouped, flash, onClick, onDelete }) {
  const fullDate = new Date(n.receivedAt).toLocaleString([], {
    dateStyle: 'full',
    timeStyle: 'long',
  });
  return (
    <li
      className={`msg ${grouped ? 'grouped' : ''} ${n.read ? '' : 'unread'} ${flash ? 'flash' : ''}`}
      onClick={onClick}
    >
      <div className="msg-actions" onClick={(e) => e.stopPropagation()}>
        <button className="msg-action danger" onClick={onDelete} title="Delete message" aria-label="Delete message">
          <TrashIcon />
        </button>
      </div>
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
            <span className="sender">{n.title || n.app}</span>
            <time className="time" title={fullDate}>
              {clockTime(n.receivedAt)}
            </time>
            <span className="chips">
              {n.source && (
                <span className="chip" title="Source">
                  {n.source}
                </span>
              )}
              <span className="chip" title="Machine">
                <span className="chip-dot" style={{ background: vpsColor(n.vps) }} />
                {n.vps}
              </span>
              {n.app?.toLowerCase() === 'slack' ? (
                <span className="chip subtle" title={n.app} aria-label={n.app}>
                  <SlackLogo />
                </span>
              ) : (
                <span className="chip subtle" title="App">
                  {n.app}
                </span>
              )}
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
        {grouped && n.source && (
          <div className="source-line">
            <span className="chip" title="Source">
              {n.source}
            </span>
          </div>
        )}
        {n.body && (
          <div>
            <span className="body-badge">{n.body}</span>
          </div>
        )}
      </div>
    </li>
  );
}

function GlobeIcon() {
  return (
    <svg className="meta-icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" />
      <path d="M1.75 8h12.5M8 1.75c1.7 1.8 2.5 3.9 2.5 6.25S9.7 12.45 8 14.25C6.3 12.45 5.5 10.35 5.5 8S6.3 3.55 8 1.75" />
    </svg>
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

const SlackLogo = () => (
  <svg className="app-logo" viewBox="0 0 122.8 122.8" aria-hidden="true">
    <path
      fill="#e01e5a"
      d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z"
    />
    <path
      fill="#36c5f0"
      d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z"
    />
    <path
      fill="#2eb67d"
      d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z"
    />
    <path
      fill="#ecb22e"
      d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z"
    />
  </svg>
);

function Icon({ children }) {
  return (
    <svg className="ui-icon" viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  );
}

const BellIcon = () => (
  <Icon>
    <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </Icon>
);

const MenuIcon = () => (
  <Icon>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </Icon>
);

const SearchIcon = () => (
  <Icon>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Icon>
);

const GridIcon = () => (
  <Icon>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </Icon>
);

const MonitorIcon = () => (
  <Icon>
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </Icon>
);

const SoundIcon = () => (
  <Icon>
    <path d="M11 5 6 9H2v6h4l5 4z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
  </Icon>
);

const FilterIcon = () => (
  <Icon>
    <path d="M3 5h18M6 12h12M10 19h4" />
  </Icon>
);

const CheckIcon = () => (
  <Icon>
    <path d="M20 6 9 17l-5-5" />
  </Icon>
);

const TrashIcon = () => (
  <Icon>
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
  </Icon>
);

const InboxIcon = () => (
  <Icon>
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </Icon>
);

const SunIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </Icon>
);

const MoonIcon = () => (
  <Icon>
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </Icon>
);
