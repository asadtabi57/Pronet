// ===== Session management =====
// - The JWT now lives in a secure, httpOnly cookie set by the backend, so it is
//   NOT readable by JS (mitigates token theft via XSS). We only keep a
//   non-sensitive `authed` marker + idle timestamp in sessionStorage for the
//   client-side 5-minute inactivity timeout and route gating.
// - Any mouse / keyboard / touch / scroll activity refreshes the idle timer.

const Session = (() => {
  const IDLE_MS = 5 * 60 * 1000; // 5 minutes
  const AUTH_KEY = 'authed';
  const USER_KEY = 'user';
  const LAST_KEY = 'last_activity';

  function now() { return Date.now(); }

  function setAuthed() {
    sessionStorage.setItem(AUTH_KEY, '1');
    sessionStorage.setItem(LAST_KEY, String(now()));
  }
  // Back-compat: older call sites passed a token string. We no longer store the
  // token (it's in the httpOnly cookie); just record that we're authenticated.
  function setToken(_t) { setAuthed(); }
  function isAuthed() { return sessionStorage.getItem(AUTH_KEY) === '1'; }
  function clear() {
    sessionStorage.removeItem(AUTH_KEY);
    sessionStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(LAST_KEY);
  }
  function touch() {
    if (isAuthed()) {
      sessionStorage.setItem(LAST_KEY, String(now()));
    }
  }
  function lastActivity() {
    const v = sessionStorage.getItem(LAST_KEY);
    return v ? Number(v) : 0;
  }
  function isExpired() {
    const last = lastActivity();
    return last > 0 && (now() - last) > IDLE_MS;
  }
  function isValid() {
    return isAuthed() && !isExpired();
  }
  function msRemaining() {
    const last = lastActivity();
    if (!last) return IDLE_MS;
    return Math.max(0, IDLE_MS - (now() - last));
  }
  return { setAuthed, setToken, isAuthed, clear, touch, isExpired, isValid, msRemaining, IDLE_MS };
})();

// ===== Shared API + helpers =====
async function api(path, { method = 'GET', body } = {}) {
  // Enforce idle timeout before every request
  if (Session.isExpired()) { await signOut('Session expired due to inactivity.'); throw new Error('Session expired'); }

  // Auth travels in the httpOnly cookie — `credentials: 'include'` sends it.
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include',
  });
  let data = {};
  try { data = await res.json(); } catch (e) {}
  if (res.status === 401) { await signOut(); throw new Error('Unauthorized'); }
  if (!res.ok) throw new Error(data.error || ('Request failed: ' + res.status));
  Session.touch();
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

async function signOut(reason) {
  try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); } catch (e) {}
  try { if (window.sb) await window.sb.auth.signOut(); } catch (e) {}
  Session.clear();
  // Some legacy code may have written to localStorage — wipe those keys too.
  try { localStorage.removeItem('token'); localStorage.removeItem('user'); } catch (e) {}
  if (reason) {
    try { sessionStorage.setItem('signout_reason', reason); } catch (e) {}
  }
  if (location.pathname !== '/' && location.pathname !== '/index.html') {
    location.href = '/';
  }
}

function initials(name) {
  return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('');
}

// ===== Realtime event bus (SSE) =====
// Single EventSource per tab, authenticated via the session token. Components
// subscribe with RT.on('message'|'notification'|'call', cb). Auto-reconnects.
const RT = (() => {
  let es = null;
  let started = false;
  const handlers = { message: new Set(), notification: new Set(), call: new Set(), presence: new Set(), ready: new Set() };

  function emit(type, data) {
    const set = handlers[type];
    if (!set) return;
    set.forEach(cb => { try { cb(data); } catch (e) { console.error('RT handler', e); } });
  }

  function connect() {
    if (!Session.isAuthed()) return;
    try { if (es) es.close(); } catch (e) {}
    // The httpOnly auth cookie is sent automatically on this same-origin request.
    es = new EventSource('/api/events');

    es.addEventListener('ready', (e) => emit('ready', safeParse(e.data)));
    es.addEventListener('message', (e) => emit('message', safeParse(e.data)));
    es.addEventListener('notification', (e) => emit('notification', safeParse(e.data)));
    es.addEventListener('presence', (e) => emit('presence', safeParse(e.data)));
    // All call signaling events funnel through a single 'call' handler.
    ['call_invite','call_accept','call_reject','call_end','call_signal','call_cancel'].forEach(ev => {
      es.addEventListener(ev, (e) => emit('call', { event: ev, data: safeParse(e.data) }));
    });
    es.onerror = () => {
      // EventSource auto-reconnects, but if the token rotated we rebuild it.
      // Browser handles backoff; nothing required here.
    };
  }

  function safeParse(s) { try { return JSON.parse(s); } catch (e) { return {}; } }

  function start() {
    if (started) return;
    started = true;
    connect();
    // Reconnect cleanly if the tab returns to foreground after sleeping.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && es && es.readyState === 2) connect();
    });
    window.addEventListener('beforeunload', () => { try { es && es.close(); } catch (e) {} });
  }

  function on(type, cb) {
    if (!handlers[type]) handlers[type] = new Set();
    handlers[type].add(cb);
    return () => handlers[type].delete(cb);
  }

  return { start, on };
})();
window.RT = RT;

// ===== Online presence =====
// Live set of online user ids, seeded from /api/presence and kept current via
// the SSE 'presence' event. Drives the green dot on avatars app-wide.
const Presence = (() => {
  const online = new Set();
  let seeded = false;

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

  return { start, seed, isOnline, refreshDom, _set: online, get seeded() { return seeded; } };
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
    return `<span class="avatar img ${size}${onlineCls}"${uidAttr}><img src="${escapeHTML(u.avatar_url)}" alt=""/>${dot}</span>`;
  }
  return `<div class="avatar ${size}${onlineCls}"${uidAttr} style="background:${u.avatar_color || '#0a66c2'}">${initials(u.name)}${dot}</div>`;
}

function getMe() { try { return JSON.parse(sessionStorage.getItem('user') || 'null'); } catch { return null; } }
function setMe(u) { sessionStorage.setItem('user', JSON.stringify(u)); Session.touch(); }
function requireAuth() {
  if (!Session.isValid()) {
    signOut(Session.isAuthed() ? 'Session expired due to inactivity.' : null);
    return false;
  }
  return true;
}

// ===== Inactivity tracker =====
(function installIdleTracker() {
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

  const tabs = [
    { id: 'home', label: 'Home', icon: '🏠', href: '/feed.html' },
    { id: 'network', label: 'My Network', icon: '👥', href: '/network.html' },
    { id: 'messaging', label: 'Messaging', icon: '💬', href: '/messages.html', badge: unreadMsgs },
    { id: 'notifications', label: 'Notifications', icon: '🔔', href: '/notifications.html', badge: unreadNotif },
    { id: 'me', label: 'Me', icon: '👤', href: `/profile.html?id=${me.id}` },
    { id: 'premium', label: 'Premium', icon: '⭐', href: '/premium.html' },
  ];

  document.body.classList.add('app');
  const navEl = document.getElementById('top-nav');
  navEl.innerHTML = `
    <div class="app-nav-inner">
      <a class="brand" href="/feed.html">in</a>
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
        <a class="nav-tab" href="#" onclick="event.preventDefault();signOut();">
          <span class="icon">↪</span><span class="label">Sign out</span>
        </a>
      </div>
    </div>`;

  installSearchTypeahead();

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

    refreshBadges();
    // Fallback poll (covers missed SSE events / multi-instance). 60s is plenty now.
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
  Object.assign(el.style, {
    position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
    background: '#0f172a', color: '#fff', padding: '10px 18px', borderRadius: '999px',
    fontSize: '14px', zIndex: 200, boxShadow: '0 4px 16px rgba(0,0,0,.18)',
  });
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
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
