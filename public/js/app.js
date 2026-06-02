// ===== Session management =====
// - Token & profile live in sessionStorage (cleared on tab close → true browser session)
// - 5-minute inactivity timeout: any mouse / keyboard / touch / scroll activity
//   refreshes the timer. After 5 min idle the user is signed out automatically.
// - A `last_activity` timestamp is shared via sessionStorage so navigating
//   between pages doesn't reset the idle clock.

const Session = (() => {
  const IDLE_MS = 5 * 60 * 1000; // 5 minutes
  const TOKEN_KEY = 'token';
  const USER_KEY = 'user';
  const LAST_KEY = 'last_activity';

  function now() { return Date.now(); }

  function setToken(t) {
    sessionStorage.setItem(TOKEN_KEY, t);
    sessionStorage.setItem(LAST_KEY, String(now()));
  }
  function getToken() { return sessionStorage.getItem(TOKEN_KEY); }
  function clear() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(LAST_KEY);
  }
  function touch() {
    if (sessionStorage.getItem(TOKEN_KEY)) {
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
    return !!getToken() && !isExpired();
  }
  function msRemaining() {
    const last = lastActivity();
    if (!last) return IDLE_MS;
    return Math.max(0, IDLE_MS - (now() - last));
  }
  return { setToken, getToken, clear, touch, isExpired, isValid, msRemaining, IDLE_MS };
})();

// ===== Shared API + helpers =====
async function api(path, { method = 'GET', body } = {}) {
  // Enforce idle timeout before every request
  if (Session.isExpired()) { await signOut('Session expired due to inactivity.'); throw new Error('Session expired'); }

  const headers = { 'Content-Type': 'application/json' };
  let token = Session.getToken();
  if (window.sb) {
    try {
      const { data } = await window.sb.auth.getSession();
      if (data && data.session && data.session.access_token) {
        token = data.session.access_token;
        Session.setToken(token);
      }
    } catch (e) {}
  }
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = {};
  try { data = await res.json(); } catch (e) {}
  if (res.status === 401) { await signOut(); throw new Error('Unauthorized'); }
  if (!res.ok) throw new Error(data.error || ('Request failed: ' + res.status));
  Session.touch();
  return data;
}

async function signOut(reason) {
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
  if (u.avatar_url) {
    return `<span class="avatar img ${size}"><img src="${escapeHTML(u.avatar_url)}" alt=""/></span>`;
  }
  return `<div class="avatar ${size}" style="background:${u.avatar_color || '#0a66c2'}">${initials(u.name)}</div>`;
}

function getMe() { try { return JSON.parse(sessionStorage.getItem('user') || 'null'); } catch { return null; } }
function setMe(u) { sessionStorage.setItem('user', JSON.stringify(u)); Session.touch(); }
function requireAuth() {
  if (!Session.isValid()) {
    signOut(Session.getToken() ? 'Session expired due to inactivity.' : null);
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
    if (Session.getToken() && Session.isExpired()) {
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
      <div class="search">
        <input id="global-search" placeholder="Search people, posts…" autocomplete="off" />
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

  const search = document.getElementById('global-search');
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = search.value.trim();
      if (q) location.href = '/search.html?q=' + encodeURIComponent(q);
    }
  });
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
