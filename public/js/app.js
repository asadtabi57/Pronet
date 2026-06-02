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

  // Live-refresh badges every 30s so incoming requests/messages show up without page reload
  if (!window.__navPollStarted) {
    window.__navPollStarted = true;
    setInterval(async () => {
      try {
        const [n, t] = await Promise.all([api('/api/notifications'), api('/api/messages/threads')]);
        const newNotif = n.unread || 0;
        const newMsgs  = (t.threads || []).reduce((sum, x) => sum + (x.unread || 0), 0);
        const setBadge = (id, count) => {
          const link = document.querySelector(`.nav-tab[href*="${id}"]`);
          if (!link) return;
          let badge = link.querySelector('.badge');
          if (count > 0) {
            const text = count > 99 ? '99+' : String(count);
            if (badge) badge.textContent = text;
            else link.insertAdjacentHTML('beforeend', `<span class="badge">${text}</span>`);
          } else if (badge) badge.remove();
        };
        setBadge('notifications.html', newNotif);
        setBadge('messages.html', newMsgs);
      } catch (e) {}
    }, 30000);
  }

  // Scroll direction → toggle body.scroll-down so sidebars collapse for more feed room
  if (!window.__scrollDirStarted) {
    window.__scrollDirStarted = true;
    let lastY = window.scrollY;
    let ticking = false;
    const THRESHOLD = 8;
    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const dy = y - lastY;
        if (y < 80) {
          document.body.classList.remove('scroll-down');
        } else if (dy > THRESHOLD) {
          document.body.classList.add('scroll-down');
        } else if (dy < -THRESHOLD) {
          document.body.classList.remove('scroll-down');
        }
        lastY = y;
        ticking = false;
      });
    }, { passive: true });
  }
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
