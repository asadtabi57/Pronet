// ===== Session management =====
// - The JWT lives in a secure, httpOnly cookie set by the backend (not readable
//   by JS). We keep a non-sensitive `authed` marker + activity timestamp client
//   side for route gating.
// - INSTALLED APP (standalone PWA): the session is PERSISTENT — stored in
//   localStorage with NO inactivity timeout, so the user stays logged in across
//   app restarts until they sign out (or we bump AUTH_EPOCH for a breaking
//   update). The cookie is long-lived (1y) + sliding-refreshed server-side.
// - BROWSER TAB: previous behavior — sessionStorage + a 5-minute idle timeout.

// Bump this string to force every client to re-authenticate after a breaking
// update (e.g. an auth change). Leave it stable for normal feature deploys so
// people are NOT logged out on every release.
const AUTH_EPOCH = '1';

// "App mode" = launched as an installed PWA (standalone display mode).
function isAppMode() {
  try {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
  } catch (e) { return false; }
}

const Session = (() => {
  const IDLE_MS = 5 * 60 * 1000; // 5 minutes (browser tabs only)
  const APP = isAppMode();
  const store = APP ? window.localStorage : window.sessionStorage;
  const AUTH_KEY = 'authed';
  const USER_KEY = 'user';
  const LAST_KEY = 'last_activity';
  const AUTHED_AT_KEY = 'authed_at';
  const EPOCH_KEY = 'auth_epoch';

  function now() { return Date.now(); }

  function setAuthed() {
    store.setItem(AUTH_KEY, '1');
    store.setItem(LAST_KEY, String(now()));
    store.setItem(AUTHED_AT_KEY, String(now()));
    store.setItem(EPOCH_KEY, AUTH_EPOCH);
    clearRedirectGuard();
  }
  // Back-compat: older call sites passed a token string. We no longer store the
  // token (it's in the httpOnly cookie); just record that we're authenticated.
  function setToken(_t) { setAuthed(); }
  function isAuthed() {
    if (store.getItem(AUTH_KEY) !== '1') return false;
    // Forced logout on a breaking update: stored epoch no longer matches.
    if ((store.getItem(EPOCH_KEY) || '') !== AUTH_EPOCH) return false;
    return true;
  }
  function justAuthed() {
    const v = Number(store.getItem(AUTHED_AT_KEY) || 0);
    return v > 0 && (now() - v) < 12000;
  }
  function clear() {
    // Clear from BOTH stores so switching browser <-> app never leaves a stale marker.
    [AUTH_KEY, USER_KEY, LAST_KEY, AUTHED_AT_KEY, EPOCH_KEY].forEach(k => {
      try { localStorage.removeItem(k); } catch (e) {}
      try { sessionStorage.removeItem(k); } catch (e) {}
    });
  }
  function touch() {
    if (isAuthed()) store.setItem(LAST_KEY, String(now()));
  }
  function lastActivity() {
    const v = store.getItem(LAST_KEY);
    return v ? Number(v) : 0;
  }
  function isExpired() {
    if (APP) return false; // installed app never idles out
    const last = lastActivity();
    return last > 0 && (now() - last) > IDLE_MS;
  }
  function isValid() {
    return isAuthed() && !isExpired();
  }
  function msRemaining() {
    if (APP) return Infinity;
    const last = lastActivity();
    if (!last) return IDLE_MS;
    return Math.max(0, IDLE_MS - (now() - last));
  }
  function getUser() { try { return JSON.parse(store.getItem(USER_KEY) || 'null'); } catch (e) { return null; } }
  function setUser(u) { try { store.setItem(USER_KEY, JSON.stringify(u)); } catch (e) {} touch(); }
  return { setAuthed, setToken, isAuthed, justAuthed, clear, touch, isExpired, isValid, msRemaining, IDLE_MS, app: APP, getUser, setUser };
})();

// Circuit breaker for the auth redirect. If the app bounces to the landing page
// too many times in a short window (e.g. a flaky mobile network momentarily
// dropping the session cookie), we STOP redirecting so the user isn't trapped
// in an infinite reload loop. Cleared on any successful authenticated request.
const REDIRECT_GUARD_KEY = 'pn_redirect_guard';
function clearRedirectGuard() { try { localStorage.removeItem(REDIRECT_GUARD_KEY); } catch (e) {} }
function redirectLoopTripped() {
  try {
    const nowT = Date.now();
    const arr = (JSON.parse(localStorage.getItem(REDIRECT_GUARD_KEY) || '[]'))
      .filter(t => nowT - t < 8000);
    arr.push(nowT);
    localStorage.setItem(REDIRECT_GUARD_KEY, JSON.stringify(arr));
    return arr.length > 4; // >4 bounces in 8s -> break the loop
  } catch (e) { return false; }
}

// ===== Shared API + helpers =====
async function api(path, { method = 'GET', body, _retried = false } = {}) {
  // Enforce idle timeout before every request
  if (Session.isExpired()) { await signOut('Session expired due to inactivity.'); throw new Error('Session expired'); }

  // FormData (binary uploads) must NOT be JSON-stringified, and we must let the
  // browser set the multipart Content-Type (with its boundary) itself.
  const isForm = (typeof FormData !== 'undefined') && body instanceof FormData;

  // Auth travels in the httpOnly cookie — `credentials: 'include'` sends it.
  const res = await fetch(path, {
    method,
    headers: isForm ? undefined : { 'Content-Type': 'application/json' },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    credentials: 'include',
  });
  let data = {};
  try { data = await res.json(); } catch (e) {}
  if (res.status === 401) {
    // Just-logged-in grace window: the httpOnly cookie can lag a beat on mobile,
    // so a 401 here is likely a race, not a dead session. Retry once before
    // tearing down the session (which would otherwise cause a redirect loop).
    if (!_retried && Session.isAuthed() && Session.justAuthed()) {
      await new Promise(r => setTimeout(r, 700));
      return api(path, { method, body, _retried: true });
    }
    await signOut(); throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const err = new Error(data.error || ('Request failed: ' + res.status));
    err.status = res.status;
    throw err;
  }
  Session.touch();
  clearRedirectGuard(); // a successful request proves the session is healthy
  return data;
}

// Exchange a Supabase/OAuth access token for our own httpOnly cookie session.
// Called once right after a Google/legacy Supabase login.
async function exchangeSupabaseSession(accessToken) {
  const res = await fetch('/api/auth/session', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Authorization': 'Bearer ' + accessToken },
  });
  if (!res.ok) throw new Error('Session exchange failed');
  const data = await res.json();
  if (data && data.user) setMe(data.user);
  Session.setAuthed();
  return data;
}
window.exchangeSupabaseSession = exchangeSupabaseSession;

// ===== Theme (light / dark) =====
// The initial theme is applied by an inline head script (server-injected) before
// paint to avoid a flash. This just flips it at runtime and persists the choice.
function setTheme(theme) {
  const t = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('pn_theme', t); } catch (e) {}
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'dark' ? '#14181f' : '#4f46e5');
}
function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}
window.setTheme = setTheme;

let _signingOut = false;
async function signOut(reason) {
  if (_signingOut) return; // collapse the parallel-401 storm into one teardown
  _signingOut = true;
  try { if (window.RT && RT.stop) RT.stop(); } catch (e) {}
  try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); } catch (e) {}
  try { if (window.sb) await window.sb.auth.signOut(); } catch (e) {}
  Session.clear();
  // Some legacy code may have written to localStorage — wipe those keys too.
  try { localStorage.removeItem('token'); localStorage.removeItem('user'); } catch (e) {}
  if (reason) {
    try { sessionStorage.setItem('signout_reason', reason); } catch (e) {}
  }
  if (location.pathname !== '/' && location.pathname !== '/index.html') {
    // Circuit breaker: bail out of redirecting if we're caught in a bounce loop.
    if (redirectLoopTripped()) {
      try { sessionStorage.setItem('signout_reason', 'Could not keep you signed in. Please log in again.'); } catch (e) {}
      clearRedirectGuard();
    }
    location.href = '/';
    return;
  }
  _signingOut = false; // already on landing page; allow future sign-outs
}

function initials(name) {
  return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('');
}

// ===== Realtime event bus (SSE) =====
// Single EventSource per tab, authenticated via the httpOnly session cookie.
// Components subscribe with RT.on('message'|'notification'|'call'|'presence', cb).
// Reconnects with capped exponential backoff. It NEVER reloads the page — a
// dropped or unauthorized stream must not be able to trigger window.reload().
const RT = (() => {
  let es = null;
  let started = false;
  let retry = 0;
  let reconnectTimer = null;
  let stopped = false;
  const handlers = { message: new Set(), notification: new Set(), call: new Set(), presence: new Set(), ready: new Set() };

  function emit(type, data) {
    const set = handlers[type];
    if (!set) return;
    set.forEach(cb => { try { cb(data); } catch (e) { console.error('RT handler', e); } });
  }

  function scheduleReconnect() {
    if (reconnectTimer || stopped) return;
    if (!Session.isAuthed()) return; // logged out -> stop trying
    const delay = Math.min(30000, 1000 * Math.pow(2, retry)); // 1s,2s,4s… cap 30s
    retry++;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, delay);
  }

  function connect() {
    if (stopped || !Session.isAuthed()) return;
    try { if (es) es.close(); } catch (e) {}
    es = null;
    try {
      // The httpOnly auth cookie is sent automatically on this same-origin request.
      es = new EventSource('/api/events');
    } catch (e) { scheduleReconnect(); return; }

    es.onopen = () => { retry = 0; }; // healthy stream -> reset backoff
    es.addEventListener('ready', (e) => { retry = 0; emit('ready', safeParse(e.data)); });
    es.addEventListener('message', (e) => emit('message', safeParse(e.data)));
    es.addEventListener('notification', (e) => emit('notification', safeParse(e.data)));
    es.addEventListener('presence', (e) => emit('presence', safeParse(e.data)));
    // All call signaling events funnel through a single 'call' handler.
    ['call_invite','call_accept','call_reject','call_end','call_signal','call_cancel'].forEach(ev => {
      es.addEventListener(ev, (e) => emit('call', { event: ev, data: safeParse(e.data) }));
    });
    es.onerror = () => {
      // EventSource can't read the HTTP status, so treat every error as a
      // transient drop: close, then silently reconnect with backoff. Crucially,
      // we do NOT reload the page or sign the user out from here.
      try { es && es.close(); } catch (e) {}
      es = null;
      scheduleReconnect();
    };
  }

  function safeParse(s) { try { return JSON.parse(s); } catch (e) { return {}; } }

  function start() {
    if (started) return;
    started = true;
    stopped = false;
    connect();
    // Reconnect cleanly if the tab returns to foreground after sleeping.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && (!es || es.readyState === 2)) {
        retry = 0; connect();
      }
    });
    window.addEventListener('beforeunload', () => { try { es && es.close(); } catch (e) {} });
  }

  function stop() {
    stopped = true;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    try { if (es) es.close(); } catch (e) {}
    es = null;
  }

  function on(type, cb) {
    if (!handlers[type]) handlers[type] = new Set();
    handlers[type].add(cb);
    return () => handlers[type].delete(cb);
  }

  return { start, stop, on };
})();
window.RT = RT;

// ===== Online presence =====
// Live set of online user ids, seeded from /api/presence and kept current via
// the SSE 'presence' event. Drives the green dot on avatars app-wide.
const Presence = (() => {
  const online = new Set();
  let seeded = false;
  const seedCbs = [];
  function onSeed(fn) { if (typeof fn === 'function') seedCbs.push(fn); }

  function refreshDom(id) {
    const sel = id != null ? `.avatar[data-uid="${id}"]` : '.avatar[data-uid]';
    document.querySelectorAll(sel).forEach(el => {
      const uid = Number(el.getAttribute('data-uid'));
      el.classList.toggle('is-online', online.has(uid));
    });
  }

  async function seed() {
    try {
      const r = await api('/api/presence');
      online.clear();
      (r.online || []).forEach(id => online.add(Number(id)));
      seeded = true;
      refreshDom();
      seedCbs.forEach(fn => { try { fn(); } catch (e) {} });
    } catch (e) { /* not fatal; transitions still update the set */ }
  }

  function isOnline(id) { return id != null && online.has(Number(id)); }

  function start() {
    if (!Session.isAuthed()) return;
    RT.on('presence', (d) => {
      if (!d || d.user_id == null) return;
      const id = Number(d.user_id);
      if (d.online) online.add(id); else online.delete(id);
      refreshDom(id);
    });
    // Re-seed on (re)connect so a dropped stream can't leave us stale.
    RT.on('ready', () => seed());
    seed();
  }

  return { start, seed, isOnline, refreshDom, onSeed, _set: online, get seeded() { return seeded; } };
})();
window.Presence = Presence;

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  if (s < 7 * 86400) return Math.floor(s / 86400) + 'd';
  return new Date(ts).toLocaleDateString();
}

function escapeHTML(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function avatar(u, size = 'sm') {
  if (!u) return '';
  const id = u.id != null ? Number(u.id) : null;
  const uidAttr = id != null ? ` data-uid="${id}"` : '';
  const onlineCls = (id != null && window.Presence && Presence.isOnline(id)) ? ' is-online' : '';
  const dot = id != null ? '<span class="presence-dot" aria-hidden="true"></span>' : '';
  if (u.avatar_url) {
    // data-init/-color let the global error handler below fall back to the
    // initials variant when a remote avatar URL is dead (e.g. Google blocks
    // hot-linked OAuth photos with ORB/403 after a while).
    return `<span class="avatar img ${size}${onlineCls}"${uidAttr} data-init="${escapeHTML(initials(u.name))}" data-color="${escapeHTML(u.avatar_color || '#0a66c2')}"><img src="${escapeHTML(u.avatar_url)}" alt=""/>${dot}</span>`;
  }
  return `<div class="avatar ${size}${onlineCls}"${uidAttr} style="background:${u.avatar_color || '#0a66c2'}">${initials(u.name)}${dot}</div>`;
}

// Broken remote avatars (blocked/expired URLs) degrade to colored initials.
// One capture-phase listener covers every avatar ever injected via innerHTML.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!img || img.tagName !== 'IMG') return;
  const wrap = img.closest && img.closest('.avatar.img');
  if (!wrap) return;
  img.remove();
  wrap.classList.remove('img');
  wrap.style.background = wrap.dataset.color || '#0a66c2';
  wrap.insertAdjacentText('afterbegin', wrap.dataset.init || '?');
}, true);

function getMe() { return Session.getUser(); }
function setMe(u) { Session.setUser(u); }
function requireAuth() {
  if (!Session.isValid()) {
    signOut(Session.isAuthed() ? 'Session expired due to inactivity.' : null);
    return false;
  }
  return true;
}

// ===== Inactivity tracker (browser tabs only — disabled in the installed app) =====
(function installIdleTracker() {
  if (Session.app) return; // installed PWA: persistent login, no idle timeout
  // If user lands here already idle (e.g. switched tabs > 5 min), sign out right away.
  if (Session.isExpired()) {
    signOut('Session expired due to inactivity.');
    return;
  }

  // Throttled activity refresher (handles flood of mousemove events).
  let lastTouch = 0;
  function onActivity() {
    const now = Date.now();
    if (now - lastTouch > 5000) { // throttle to once every 5s
      lastTouch = now;
      Session.touch();
    }
  }
  ['mousedown', 'keydown', 'touchstart', 'scroll', 'click'].forEach(ev =>
    document.addEventListener(ev, onActivity, { passive: true })
  );

  // Periodic check (every 15s) so an idle tab still gets signed out.
  setInterval(() => {
    if (Session.isAuthed() && Session.isExpired()) {
      signOut('Session expired due to inactivity.');
    }
  }, 15_000);

  // Show a one-time toast on landing page if we were kicked out.
  window.addEventListener('DOMContentLoaded', () => {
    const reason = sessionStorage.getItem('signout_reason');
    if (reason) {
      sessionStorage.removeItem('signout_reason');
      // Defer to ensure toast() is defined.
      setTimeout(() => { try { toast(reason); } catch (e) { console.log(reason); } }, 100);
    }
  });
})();

// ===== Top nav =====
async function renderNav(activeTab) {
  const me = getMe();
  if (!me) return;
  let unreadNotif = 0, unreadMsgs = 0;
  try {
    const [n, t] = await Promise.all([api('/api/notifications'), api('/api/messages/threads')]);
    unreadNotif = n.unread || 0;
    unreadMsgs = (t.threads || []).reduce((sum, x) => sum + (x.unread || 0), 0);
  } catch (e) {}
  // Seed the realtime badge counters from the values we just fetched so the
  // initial bootstrap doesn't need a second (duplicate) round-trip.
  window.__unreadNotif = unreadNotif;
  window.__unreadMsgs  = unreadMsgs;

  const tabs = [
    { id: 'home', label: 'Home', icon: '🏠', href: '/feed.html' },
    { id: 'network', label: 'My Network', icon: '👥', href: '/network.html' },
    { id: 'lounge', label: 'Lounge', icon: '🎧', href: '/lounge.html' },
    { id: 'messaging', label: 'Messaging', icon: '💬', href: '/messages.html', badge: unreadMsgs },
    { id: 'notifications', label: 'Notifications', icon: '🔔', href: '/notifications.html', badge: unreadNotif },
    { id: 'me', label: 'Me', icon: '👤', href: `/profile.html?id=${me.id}` },
    { id: 'premium', label: 'Premium', icon: '⭐', href: '/premium.html' },
  ];

  document.body.classList.add('app');
  const navEl = document.getElementById('top-nav');
  navEl.innerHTML = `
    <div class="app-nav-inner">
      <a class="brand brand-logo" href="/feed.html" aria-label="Connectik"><svg viewBox="0 0 512 512" aria-hidden="true"><defs><linearGradient id="navMintGlow" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#34d399"/><stop offset="100%" stop-color="#059669"/></linearGradient></defs><rect x="32" y="32" width="448" height="448" rx="128" fill="#4f46e5"/><rect x="136" y="196" width="140" height="120" rx="60" fill="none" stroke="#ffffff" stroke-width="32"/><rect x="236" y="196" width="140" height="120" rx="60" fill="none" stroke="url(#navMintGlow)" stroke-width="32"/><circle cx="256" cy="256" r="14" fill="#ffffff"/></svg></a>
      <div class="search" id="search-wrap">
        <input id="global-search" placeholder="Search people, posts…" autocomplete="off" spellcheck="false" />
        <div id="search-dropdown" class="search-dropdown" hidden></div>
      </div>
      <div class="spacer"></div>
      <div class="nav-tabs">
        ${tabs.map(t => `
          <a class="nav-tab ${t.id === activeTab ? 'active' : ''}" href="${t.href}">
            <span class="icon">${t.icon}</span>
            <span class="label">${t.label}</span>
            ${t.badge ? `<span class="badge">${t.badge > 99 ? '99+' : t.badge}</span>` : ''}
          </a>
        `).join('')}
        <button type="button" class="nav-tab nav-settings-btn" id="nav-settings-btn" data-no-viewer="true" aria-haspopup="true" aria-label="Settings & Privacy">
          <span class="nav-avatar">${avatar(me, 'sm')}</span>
          <span class="label">Me ▾</span>
        </button>
      </div>
    </div>`;

  installSearchTypeahead();

  const settingsBtn = document.getElementById('nav-settings-btn');
  if (settingsBtn) settingsBtn.addEventListener('click', (e) => {
    e.preventDefault();
    openSettingsMenu(settingsBtn);
  });

  // Shared badge setter (also used by realtime listeners).
  window.setNavBadge = function (id, count) {
    const link = document.querySelector(`.nav-tab[href*="${id}"]`);
    if (!link) return;
    let badge = link.querySelector('.badge');
    if (count > 0) {
      const text = count > 99 ? '99+' : String(count);
      if (badge) badge.textContent = text;
      else link.insertAdjacentHTML('beforeend', `<span class="badge">${text}</span>`);
    } else if (badge) badge.remove();
  };

  async function refreshBadges() {
    try {
      const [n, t] = await Promise.all([api('/api/notifications'), api('/api/messages/threads')]);
      window.__unreadNotif = n.unread || 0;
      window.__unreadMsgs  = (t.threads || []).reduce((sum, x) => sum + (x.unread || 0), 0);
      window.setNavBadge('notifications.html', window.__unreadNotif);
      window.setNavBadge('messages.html', window.__unreadMsgs);
    } catch (e) {}
  }
  window.refreshNavBadges = refreshBadges;

  if (!window.__navPollStarted) {
    window.__navPollStarted = true;

    // Start the realtime stream once per tab.
    RT.start();
    // Seed + subscribe online presence (green dots) on the same stream.
    Presence.start();

    // Live badge bumps from realtime events (instant, no refresh).
    RT.on('notification', () => {
      // Don't bump while sitting on the notifications page (it marks them read).
      if (location.pathname.includes('notifications')) return;
      window.__unreadNotif = (window.__unreadNotif || 0) + 1;
      window.setNavBadge('notifications.html', window.__unreadNotif);
    });
    RT.on('message', (d) => {
      const me = getMe();
      // Only count messages addressed TO me, and not while I'm on the messaging page.
      if (!d || !d.message || !me) return;
      if (d.message.to_id !== me.id) return;
      if (location.pathname.includes('messages')) return;
      window.__unreadMsgs = (window.__unreadMsgs || 0) + 1;
      window.setNavBadge('messages.html', window.__unreadMsgs);
    });

    // Badges were already rendered from the initial fetch above and the realtime
    // counters seeded, so no immediate refresh is needed here. Just keep a slow
    // fallback poll to catch any missed SSE events / multi-instance drift.
    setInterval(refreshBadges, 60000);
  }
  // NOTE: The previous scroll-direction sidebar-collapse behaviour was removed.
  // Collapsing the sidebars on scroll changed the page height, which re-triggered
  // the scroll event and caused the desktop layout to shake/oscillate. The layout
  // now stays stable with sidebars always visible on desktop.
  document.body.classList.remove('scroll-down');
}

// ===== Live search typeahead =====
function installSearchTypeahead() {
  const input = document.getElementById('global-search');
  const dd = document.getElementById('search-dropdown');
  const wrap = document.getElementById('search-wrap');
  if (!input || !dd) return;

  let timer = null;
  let lastReqId = 0;
  let cache = new Map(); // q -> { people, posts }
  let activeIdx = -1;
  let items = []; // flat list of selectable {type,id,label,href}

  function close() { dd.hidden = true; activeIdx = -1; }
  function show() { dd.hidden = false; }

  function renderResults(q, data) {
    const people = (data.people || []).slice(0, 5);
    const posts = (data.posts || []).slice(0, 4);
    items = [];

    if (!people.length && !posts.length) {
      dd.innerHTML = `<div class="sd-empty">No results for "<b>${escapeHTML(q)}</b>"</div>`;
      show(); return;
    }

    let html = '';
    if (people.length) {
      html += `<div class="sd-section-title">People</div>`;
      people.forEach(u => {
        items.push({ type: 'person', id: u.id, href: `/profile.html?id=${u.id}` });
        const av = u.avatar_url
          ? `<span class="sd-avatar"><img src="${escapeHTML(u.avatar_url)}" alt=""/></span>`
          : `<span class="sd-avatar" style="background:${u.avatar_color || '#0a66c2'}">${initials(u.name)}</span>`;
        html += `
          <a class="sd-row sd-person" data-idx="${items.length-1}" href="/profile.html?id=${u.id}">
            ${av}
            <div class="sd-meta">
              <div class="sd-name">${highlight(u.name, q)}</div>
              <div class="sd-sub">${highlight(u.headline || u.location || '', q)}</div>
            </div>
          </a>`;
      });
    }
    if (posts.length) {
      html += `<div class="sd-section-title">Posts</div>`;
      posts.forEach(p => {
        items.push({ type: 'post', id: p.id, href: `/search.html?q=${encodeURIComponent(q)}#post-${p.id}` });
        const snippet = (p.content || '').slice(0, 110);
        html += `
          <a class="sd-row sd-post" data-idx="${items.length-1}" href="/search.html?q=${encodeURIComponent(q)}">
            <span class="sd-avatar sd-post-icon">📝</span>
            <div class="sd-meta">
              <div class="sd-name">${escapeHTML(p.name)}</div>
              <div class="sd-sub">${highlight(snippet + (p.content && p.content.length > 110 ? '…' : ''), q)}</div>
            </div>
          </a>`;
      });
    }
    html += `<a class="sd-row sd-all" href="/search.html?q=${encodeURIComponent(q)}">
      <span class="sd-avatar sd-post-icon">🔍</span>
      <div class="sd-meta"><div class="sd-name">See all results for "${escapeHTML(q)}"</div></div>
    </a>`;
    items.push({ type: 'all', href: `/search.html?q=${encodeURIComponent(q)}` });

    dd.innerHTML = html;
    show();
    setActive(-1);

    dd.querySelectorAll('.sd-row').forEach(a => {
      a.addEventListener('mousedown', (e) => {
        // mousedown fires before blur, so navigation isn't cancelled
        e.preventDefault();
        location.href = a.getAttribute('href');
      });
    });
  }

  function setActive(i) {
    activeIdx = i;
    dd.querySelectorAll('.sd-row').forEach((el, idx) => {
      el.classList.toggle('active', idx === i);
    });
  }

  async function doSearch(q) {
    if (cache.has(q)) { renderResults(q, cache.get(q)); return; }
    const myId = ++lastReqId;
    try {
      const data = await api('/api/search?q=' + encodeURIComponent(q));
      if (myId !== lastReqId) return; // stale
      cache.set(q, data);
      if (cache.size > 30) cache.delete(cache.keys().next().value);
      renderResults(q, data);
    } catch (e) {
      if (myId !== lastReqId) return;
      dd.innerHTML = `<div class="sd-empty">Search failed: ${escapeHTML(e.message)}</div>`;
      show();
    }
  }

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(timer);
    if (!q) { close(); return; }
    if (q.length < 1) { close(); return; }
    dd.innerHTML = `<div class="sd-loading">Searching…</div>`;
    show();
    timer = setTimeout(() => doSearch(q), 150);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = input.value.trim();
      if (activeIdx >= 0 && items[activeIdx]) {
        e.preventDefault(); location.href = items[activeIdx].href;
      } else if (q) {
        location.href = '/search.html?q=' + encodeURIComponent(q);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (dd.hidden) return;
      setActive(Math.min(items.length - 1, activeIdx + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(-1, activeIdx - 1));
    } else if (e.key === 'Escape') {
      close(); input.blur();
    }
  });

  input.addEventListener('focus', () => {
    const q = input.value.trim();
    if (q && cache.has(q)) { renderResults(q, cache.get(q)); }
    if (window.innerWidth <= 600) {
      document.body.classList.add('search-open');
      // Insert a Cancel button if not already there
      if (!document.getElementById('search-cancel')) {
        const cancel = document.createElement('button');
        cancel.id = 'search-cancel';
        cancel.type = 'button';
        cancel.textContent = 'Cancel';
        cancel.className = 'search-cancel';
        cancel.onclick = () => {
          input.value = ''; close();
          document.body.classList.remove('search-open');
          cancel.remove(); input.blur();
        };
        wrap.appendChild(cancel);
      }
    }
  });

  function exitMobileSearch() {
    document.body.classList.remove('search-open');
    const c = document.getElementById('search-cancel');
    if (c) c.remove();
  }

  input.addEventListener('blur', () => {
    // Delay so taps on results register first; if dropdown is gone, exit overlay
    setTimeout(() => {
      if (dd.hidden && !document.activeElement?.classList?.contains('sd-row')) {
        exitMobileSearch();
      }
    }, 200);
  });

  document.addEventListener('mousedown', (e) => {
    if (!wrap.contains(e.target)) { close(); exitMobileSearch(); }
  });
}

function highlight(text, q) {
  const t = String(text == null ? '' : text);
  if (!q) return escapeHTML(t);
  const idx = t.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return escapeHTML(t);
  return escapeHTML(t.slice(0, idx))
       + '<mark>' + escapeHTML(t.slice(idx, idx + q.length)) + '</mark>'
       + escapeHTML(t.slice(idx + q.length));
}

// ===== Modal =====
function openModal({ title, body, footer }) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head"><h3>${escapeHTML(title)}</h3><button aria-label="Close">×</button></div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
    </div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector('.modal-head button').onclick = close;
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  return { el: wrap, close };
}

// ===== Confirm dialog (replaces native confirm() with an on-theme popup) =====
// Returns a Promise<boolean>. White card, centered, blue action button to match
// the messaging theme.
function confirmDialog(opts = {}) {
  const {
    title = 'Are you sure?',
    message = '',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
  } = (typeof opts === 'string' ? { title: opts } : opts);
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop confirm-backdrop';
    wrap.innerHTML = `
      <div class="confirm-dialog" role="dialog" aria-modal="true">
        <div class="confirm-body">
          <h3 class="confirm-title">${escapeHTML(title)}</h3>
          ${message ? `<p class="confirm-msg">${escapeHTML(message)}</p>` : ''}
        </div>
        <div class="confirm-foot">
          <button type="button" class="confirm-cancel">${escapeHTML(cancelText)}</button>
          <button type="button" class="confirm-ok">${escapeHTML(confirmText)}</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const done = (val) => { document.removeEventListener('keydown', onKey); wrap.remove(); resolve(val); };
    const onKey = (e) => {
      if (e.key === 'Escape') done(false);
      else if (e.key === 'Enter') done(true);
    };
    document.addEventListener('keydown', onKey);
    wrap.querySelector('.confirm-cancel').onclick = () => done(false);
    wrap.querySelector('.confirm-ok').onclick = () => done(true);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) done(false); });
    wrap.querySelector('.confirm-ok').focus();
  });
}

function toast(msg) {
  const el = document.createElement('div');
  el.textContent = msg;
  // On the phone shell, float above the bottom tab bar (+ home indicator)
  // instead of underneath it.
  const mobileBar = document.body.classList.contains('mobile-shell')
    && window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
  Object.assign(el.style, {
    position: 'fixed',
    bottom: mobileBar ? 'calc(86px + env(safe-area-inset-bottom))' : '24px',
    left: '50%', transform: 'translateX(-50%)',
    background: '#0f172a', color: '#fff', padding: '10px 18px', borderRadius: '999px',
    fontSize: '14px', zIndex: 10050, boxShadow: '0 4px 16px rgba(0,0,0,.18)',
  });
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

// ===== Settings & Privacy menu =====
// Desktop: a dropdown popover anchored under the navbar avatar.
// Mobile: a slide-up bottom sheet (handled by CSS .as-sheet). One implementation
// drives both; only positioning differs so the mobile layout stays intact.
function toggleSwitchHTML(id, on) {
  return `<button type="button" class="pn-toggle${on ? ' on' : ''}" id="${id}" role="switch" aria-checked="${on ? 'true' : 'false'}"><span class="pn-knob"></span></button>`;
}

async function openSettingsMenu(anchor) {
  if (document.querySelector('.settings-backdrop')) return; // already open
  const me = getMe() || {};
  // Pull the freshest privacy values (a long-lived session may predate them).
  let u = me;
  try { const r = await api('/api/me'); if (r && r.user) { u = r.user; setMe(u); } } catch (e) {}

  const vis = u.profile_visibility === 'private' ? 'private' : 'public';
  const onlineOn = u.is_online_visible !== false;
  const lastSeenOn = u.is_last_seen_visible !== false;
  const isMobile = window.innerWidth <= 768;

  const back = document.createElement('div');
  back.className = 'settings-backdrop';
  back.innerHTML = `
    <div class="settings-menu${isMobile ? ' as-sheet' : ''}" role="menu" aria-label="Settings & Privacy">
      <div class="settings-head">
        <span class="settings-title">Settings &amp; Privacy</span>
        <button type="button" class="settings-close" aria-label="Close">×</button>
      </div>
      <a class="settings-item" href="/profile.html?id=${u.id}">
        <span class="si-ic">${avatar(u, 'sm')}</span>
        <span class="si-text"><b>${escapeHTML(u.name || 'You')}</b><small>View profile</small></span>
      </a>
      <div class="settings-section">
        <div class="settings-row">
          <div class="sr-label"><span class="sr-title">Dark mode</span><span class="sr-sub">Switch between light and dark theme</span></div>
          ${toggleSwitchHTML('set-darkmode', currentTheme() === 'dark')}
        </div>
        <div class="settings-row">
          <div class="sr-label"><span class="sr-title">Profile visibility</span><span class="sr-sub">Who can see your profile &amp; activity</span></div>
          <select class="sr-select" id="set-visibility">
            <option value="public"${vis === 'public' ? ' selected' : ''}>Public</option>
            <option value="private"${vis === 'private' ? ' selected' : ''}>Private</option>
          </select>
        </div>
        <div class="settings-row">
          <div class="sr-label"><span class="sr-title">Active status</span><span class="sr-sub">Show others when you're online</span></div>
          ${toggleSwitchHTML('set-online', onlineOn)}
        </div>
        <div class="settings-row">
          <div class="sr-label"><span class="sr-title">Last seen</span><span class="sr-sub">Show your last-seen time in chats</span></div>
          ${toggleSwitchHTML('set-lastseen', lastSeenOn)}
        </div>
      </div>
      <div class="settings-section">
        <button type="button" class="settings-item" id="set-change-pw"><span class="si-ic ic-emoji">🔒</span><span class="si-text">Change password</span></button>
        <button type="button" class="settings-item danger" id="set-delete"><span class="si-ic ic-emoji">🗑️</span><span class="si-text">Delete account</span></button>
        <button type="button" class="settings-item" id="set-signout"><span class="si-ic ic-emoji">↪</span><span class="si-text">Sign out</span></button>
      </div>
    </div>`;
  document.body.appendChild(back);
  const menu = back.querySelector('.settings-menu');

  // Desktop: position under the avatar, right-aligned to it. Mobile uses the
  // CSS bottom-sheet, so we leave positioning to the stylesheet there.
  if (!isMobile && anchor) {
    const r = anchor.getBoundingClientRect();
    menu.style.top = (r.bottom + 8) + 'px';
    menu.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
  }

  const close = () => { document.removeEventListener('keydown', onKey); back.remove(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  back.querySelector('.settings-close').onclick = close;

  // Persist a single setting and keep the cached user in sync.
  async function saveSetting(patch) {
    try {
      const r = await api('/api/me/settings', { method: 'PUT', body: patch });
      if (r && r.user) setMe(r.user);
      return true;
    } catch (ex) {
      toast(ex.message || 'Could not update setting.');
      return false;
    }
  }

  // Profile visibility select
  const sel = back.querySelector('#set-visibility');
  sel.addEventListener('change', async () => {
    const prev = vis;
    const ok = await saveSetting({ profile_visibility: sel.value });
    if (ok) toast(sel.value === 'private' ? 'Profile set to private.' : 'Profile set to public.');
    else sel.value = prev;
  });

  // Toggles
  function wireToggle(id, field) {
    const btn = back.querySelector('#' + id);
    btn.addEventListener('click', async () => {
      const next = !btn.classList.contains('on');
      btn.classList.toggle('on', next);
      btn.setAttribute('aria-checked', next ? 'true' : 'false');
      const ok = await saveSetting({ [field]: next });
      if (!ok) { // revert on failure
        btn.classList.toggle('on', !next);
        btn.setAttribute('aria-checked', !next ? 'true' : 'false');
      }
    });
  }
  wireToggle('set-online', 'is_online_visible');
  wireToggle('set-lastseen', 'is_last_seen_visible');

  // Dark mode toggle (client-only preference — no server call).
  const dm = back.querySelector('#set-darkmode');
  if (dm) dm.addEventListener('click', () => {
    const next = !dm.classList.contains('on');
    dm.classList.toggle('on', next);
    dm.setAttribute('aria-checked', next ? 'true' : 'false');
    setTheme(next ? 'dark' : 'light');
  });

  // Change password
  back.querySelector('#set-change-pw').onclick = () => { close(); openChangePasswordModal(); };

  // Delete account
  back.querySelector('#set-delete').onclick = async () => {
    close();
    const ok = await confirmDialog({
      title: 'Delete account?',
      message: 'This permanently deletes your profile, posts, messages and connections. This cannot be undone.',
      confirmText: 'Delete my account',
      cancelText: 'Keep my account',
    });
    if (!ok) return;
    try {
      await api('/api/users/me', { method: 'DELETE' });
      try { sessionStorage.clear(); } catch (e) {}
      try { if (window.sb) await window.sb.auth.signOut(); } catch (e) {}
      location.href = '/';
    } catch (ex) {
      toast(ex.message || 'Could not delete account.');
    }
  };

  // Sign out (moved here from the old nav tab)
  back.querySelector('#set-signout').onclick = () => { close(); signOut(); };
}

// Change-password modal — mirrors the forgot-password flow's look & feel.
function openChangePasswordModal() {
  const body = `
    <form id="cpw-form" class="cpw-form" novalidate>
      <label class="cpw-field"><span>Current password</span>
        <input type="password" id="cpw-old" autocomplete="current-password" required /></label>
      <label class="cpw-field"><span>New password</span>
        <input type="password" id="cpw-new" autocomplete="new-password" required /></label>
      <label class="cpw-field"><span>Confirm new password</span>
        <input type="password" id="cpw-confirm" autocomplete="new-password" required /></label>
      <p class="cpw-hint">Use 8+ characters with upper &amp; lower case, a number and a special character.</p>
      <div class="cpw-error" id="cpw-error" hidden></div>
    </form>`;
  const footer = `
    <button type="button" class="btn-tiny ghost" id="cpw-cancel">Cancel</button>
    <button type="button" class="btn-fill" id="cpw-save">Update password</button>`;
  const { el, close } = openModal({ title: 'Change password', body, footer });
  const err = el.querySelector('#cpw-error');
  const showErr = (m) => { err.textContent = m; err.hidden = false; };
  el.querySelector('#cpw-cancel').onclick = close;
  const save = el.querySelector('#cpw-save');
  save.onclick = async () => {
    err.hidden = true;
    const oldPassword = el.querySelector('#cpw-old').value;
    const newPassword = el.querySelector('#cpw-new').value;
    const confirm = el.querySelector('#cpw-confirm').value;
    if (!oldPassword || !newPassword) return showErr('Please fill in all fields.');
    if (newPassword !== confirm) return showErr('New passwords do not match.');
    save.disabled = true;
    try {
      await api('/api/auth/change-password', { method: 'POST', body: { oldPassword, newPassword } });
      close();
      toast('Password updated.');
    } catch (ex) {
      showErr(ex.message || 'Could not change password.');
      save.disabled = false;
    }
  };
}

// ===== Global profile picture viewer (WhatsApp/Instagram-style) =====
function openImageViewer(src) {
  if (!src) return;
  const back = document.createElement('div');
  back.className = 'img-viewer';
  back.innerHTML = `
    <button class="img-viewer-close" aria-label="Close">
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
    <img src="${src}" alt="" />`;
  document.body.appendChild(back);
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => back.classList.add('open'));

  function close() {
    back.classList.remove('open');
    document.body.style.overflow = '';
    setTimeout(() => back.remove(), 220);
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  back.addEventListener('click', (e) => {
    if (e.target === back || e.target.closest('.img-viewer-close')) close();
  });
  document.addEventListener('keydown', onKey);
}

// Delegate: clicking any avatar image opens the viewer (skip with data-no-viewer)
document.addEventListener('click', (e) => {
  const wrap = e.target.closest('.avatar.img');
  if (!wrap) return;
  if (wrap.dataset.noViewer === 'true' || wrap.closest('[data-no-viewer="true"]')) return;
  const img = wrap.querySelector('img');
  if (!img || !img.src) return;
  e.preventDefault();
  e.stopPropagation();
  openImageViewer(img.src);
}, true); // capture phase: beats <a> navigation
