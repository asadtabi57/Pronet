// Pronet mobile app shell — gives the site a native-app feel on phones &
// installed PWA: a slim top app-bar, a bottom tab bar with a center compose
// button, a "Me" sheet, and a search overlay. Pure progressive enhancement —
// everything is hidden by CSS media query on desktop, so this never affects the
// desktop layout. Reuses the existing backend + app.js helpers.
(function () {
  'use strict';

  // Only mount on authenticated app pages (they have #top-nav). Skip landing/
  // auth pages which don't.
  function boot() {
    const topNav = document.getElementById('top-nav');
    if (!topNav) return;
    document.body.classList.add('mobile-shell');

    const path = location.pathname;
    const titleMap = {
      '/feed.html': 'Home', '/network.html': 'My Network', '/messages.html': 'Messaging',
      '/notifications.html': 'Notifications', '/profile.html': 'Profile',
      '/lounge.html': 'Lounge', '/premium.html': 'Premium', '/search.html': 'Search',
    };
    const pageTitle = titleMap[path] || 'Pronet';
    const active =
      path.startsWith('/feed') ? 'home' :
      path.startsWith('/network') ? 'network' :
      path.startsWith('/messages') ? 'messaging' :
      path.startsWith('/profile') ? 'me' : '';

    buildTopBar(pageTitle);
    buildTabBar(active);
    wireChatFullscreen();
    startBadgeSync();
  }

  // ---------- Top app bar ----------
  function buildTopBar(title) {
    const bar = document.createElement('header');
    bar.className = 'm-topbar';
    bar.innerHTML = `
      <div class="m-topbar-inner">
        <a class="m-brand" href="/feed.html" aria-label="Home">P</a>
        <h1 class="m-title">${escapeHTML(title)}</h1>
        <button class="m-icon-btn" id="m-search-btn" aria-label="Search">${ICONS.search}</button>
        <a class="m-icon-btn" id="m-bell" href="/notifications.html" aria-label="Notifications">
          ${ICONS.bell}<span class="m-badge" id="m-bell-badge" hidden>0</span>
        </a>
      </div>`;
    document.body.appendChild(bar);
    bar.querySelector('#m-search-btn').onclick = openSearchOverlay;
  }

  // ---------- Bottom tab bar ----------
  function buildTabBar(active) {
    const me = (typeof getMe === 'function' && getMe()) || {};
    const bar = document.createElement('nav');
    bar.className = 'm-tabbar';
    bar.setAttribute('aria-label', 'Primary');
    bar.innerHTML = `
      <a class="m-tab ${active === 'home' ? 'active' : ''}" href="/feed.html">${ICONS.home}<span>Home</span></a>
      <a class="m-tab ${active === 'network' ? 'active' : ''}" href="/network.html">${ICONS.people}<span>Network</span></a>
      <button class="m-tab m-post" id="m-post-btn" aria-label="Create a post">${ICONS.plus}</button>
      <a class="m-tab ${active === 'messaging' ? 'active' : ''}" href="/messages.html">
        ${ICONS.chat}<span>Chats</span><span class="m-badge" id="m-msg-badge" hidden>0</span>
      </a>
      <button class="m-tab ${active === 'me' ? 'active' : ''}" id="m-me-btn" aria-label="You">
        <span class="m-tab-avatar">${typeof avatar === 'function' ? avatar(me, 'sm') : ''}</span><span>Me</span>
      </button>`;
    document.body.appendChild(bar);
    bar.querySelector('#m-post-btn').onclick = openComposeSheet;
    bar.querySelector('#m-me-btn').onclick = openMeSheet;
  }

  // ---------- Compose sheet ----------
  function openComposeSheet() {
    const me = (typeof getMe === 'function' && getMe()) || {};
    const sheet = makeSheet('compose', `
      <div class="m-sheet-head">
        <button class="m-sheet-cancel">Cancel</button>
        <span class="m-sheet-title">Create a post</span>
        <button class="m-sheet-action" id="mc-post" disabled>Post</button>
      </div>
      <div class="m-compose-body">
        <div class="m-compose-row">
          ${typeof avatar === 'function' ? avatar(me, 'md') : ''}
          <div class="m-compose-name">${escapeHTML(me.name || 'You')}</div>
        </div>
        <textarea id="mc-text" placeholder="Share an update, idea, or win…" autofocus></textarea>
        <div class="m-compose-tools">
          ${window.AI ? `<button type="button" class="ai-btn ai-btn-tiny" id="mc-ai">✨ <span>Write with AI</span></button>` : ''}
        </div>
      </div>`);
    const ta = sheet.el.querySelector('#mc-text');
    const postBtn = sheet.el.querySelector('#mc-post');
    ta.addEventListener('input', () => { postBtn.disabled = !ta.value.trim(); autoGrow(ta); });
    setTimeout(() => ta.focus(), 80);
    sheet.el.querySelector('.m-sheet-cancel').onclick = sheet.close;
    const aiBtn = sheet.el.querySelector('#mc-ai');
    if (aiBtn) aiBtn.onclick = () => {
      // Reuse the feed's AI writer if present; otherwise call the endpoint inline.
      AI.assistant({
        title: 'Write a post',
        insertLabel: 'Use this post',
        run: async () => (await api('/api/ai/draft-post', { method: 'POST', body: { topic: ta.value.trim() || 'a professional update' } })).text,
        onInsert: (text) => { ta.value = text; postBtn.disabled = !text.trim(); autoGrow(ta); },
      });
    };
    postBtn.onclick = async () => {
      const content = ta.value.trim();
      if (!content) return;
      if (window.AI && AI.tonePrecheck && !(await AI.tonePrecheck(content))) return;
      postBtn.disabled = true; postBtn.textContent = 'Posting…';
      try {
        await api('/api/posts', { method: 'POST', body: { content } });
        sheet.close();
        if (typeof toast === 'function') toast('Posted!');
        if (location.pathname.startsWith('/feed')) location.reload();
        else location.href = '/feed.html';
      } catch (e) { if (typeof toast === 'function') toast(e.message || 'Could not post'); postBtn.disabled = false; postBtn.textContent = 'Post'; }
    };
  }

  // ---------- "Me" sheet ----------
  function openMeSheet() {
    const me = (typeof getMe === 'function' && getMe()) || {};
    const installItem = (window.__canInstallPWA && !window.isStandalonePWA?.())
      ? `<button class="m-menu-item" id="mm-install">${ICONS.download}<span>Install app</span></button>` : '';
    const sheet = makeSheet('me', `
      <div class="m-sheet-grab"></div>
      <a class="m-me-card" href="/profile.html?id=${me.id}">
        ${typeof avatar === 'function' ? avatar(me, 'lg') : ''}
        <div class="m-me-info">
          <div class="m-me-name">${escapeHTML(me.name || '')}</div>
          <div class="m-me-head">${escapeHTML(me.headline || 'View your profile')}</div>
        </div>
      </a>
      <div class="m-menu">
        <a class="m-menu-item" href="/profile.html?id=${me.id}">${ICONS.user}<span>View profile</span></a>
        <a class="m-menu-item" href="/network.html">${ICONS.people}<span>My network</span></a>
        <a class="m-menu-item" href="/notifications.html">${ICONS.bell}<span>Notifications</span></a>
        <a class="m-menu-item" href="/lounge.html">${ICONS.sparkle}<span>Lounge &amp; AI tools</span></a>
        <a class="m-menu-item" href="/premium.html">${ICONS.star}<span>Premium</span></a>
        ${installItem}
        <button class="m-menu-item" id="mm-settings">${ICONS.gear}<span>Settings &amp; privacy</span></button>
        <button class="m-menu-item danger" id="mm-signout">${ICONS.logout}<span>Sign out</span></button>
      </div>`);
    const inst = sheet.el.querySelector('#mm-install');
    if (inst) inst.onclick = () => { sheet.close(); window.promptInstall && window.promptInstall(); };
    sheet.el.querySelector('#mm-settings').onclick = () => {
      sheet.close();
      // openSettingsMenu renders as a bottom sheet on mobile (no anchor needed).
      if (typeof openSettingsMenu === 'function') setTimeout(() => openSettingsMenu(), 60);
    };
    sheet.el.querySelector('#mm-signout').onclick = () => { if (typeof signOut === 'function') signOut(); else location.href = '/'; };
  }

  // ---------- Search overlay ----------
  function openSearchOverlay() {
    const ov = document.createElement('div');
    ov.className = 'm-search-ov';
    ov.innerHTML = `
      <div class="m-search-top">
        <button class="m-icon-btn" id="ms-back" aria-label="Back">${ICONS.back}</button>
        <input id="ms-input" placeholder="Search people, posts…" autocomplete="off" />
      </div>
      <div class="m-search-results" id="ms-results"><p class="m-search-hint">Search for people and posts.</p></div>`;
    document.body.appendChild(ov);
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => ov.classList.add('show'));
    const input = ov.querySelector('#ms-input');
    const results = ov.querySelector('#ms-results');
    setTimeout(() => input.focus(), 60);
    const close = () => { ov.classList.remove('show'); document.body.style.overflow = ''; setTimeout(() => ov.remove(), 200); };
    ov.querySelector('#ms-back').onclick = close;

    let timer = null;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (!q) { results.innerHTML = '<p class="m-search-hint">Search for people and posts.</p>'; return; }
      timer = setTimeout(async () => {
        results.innerHTML = '<div class="ai-loading"><span class="ai-spinner"></span> Searching…</div>';
        try {
          const { people = [], semantic_people = [], posts = [] } = await api('/api/search?q=' + encodeURIComponent(q));
          const allPeople = [...people];
          semantic_people.forEach(p => { if (!allPeople.some(x => x.id === p.id)) allPeople.push(p); });
          let html = '';
          if (allPeople.length) {
            html += '<div class="m-search-sec">People</div>' + allPeople.map(p => `
              <a class="m-search-person" href="/profile.html?id=${p.id}">
                ${typeof avatar === 'function' ? avatar(p, 'md') : ''}
                <div><div class="msp-name">${escapeHTML(p.name)}</div><div class="msp-head">${escapeHTML(p.headline || '')}</div></div>
              </a>`).join('');
          }
          if (posts.length) {
            html += '<div class="m-search-sec">Posts</div>' + posts.map(p => `
              <a class="m-search-post" href="/feed.html#post-${p.id}">
                <div class="msp-name">${escapeHTML(p.name)}</div>
                <div class="msp-snip">${escapeHTML((p.content || '').slice(0, 100))}</div>
              </a>`).join('');
          }
          results.innerHTML = html || '<p class="m-search-hint">No results found.</p>';
        } catch (e) { results.innerHTML = '<p class="m-search-hint">Search failed. Try again.</p>'; }
      }, 280);
    });
  }

  // ---------- Full-screen chat (hide bars while a conversation is open) ----------
  function wireChatFullscreen() {
    if (!location.pathname.startsWith('/messages')) return;
    const shell = document.getElementById('msg-shell');
    if (!shell) return;
    const sync = () => document.body.classList.toggle('m-chat-open', shell.classList.contains('show-conv'));
    new MutationObserver(sync).observe(shell, { attributes: true, attributeFilter: ['class'] });
    sync();
  }

  // ---------- Badge sync ----------
  function startBadgeSync() {
    const apply = () => {
      setBadge('m-msg-badge', window.__unreadMsgs || 0);
      setBadge('m-bell-badge', window.__unreadNotif || 0);
    };
    apply();
    // Reflect realtime bumps if the RT bus is available.
    try {
      if (window.RT && RT.on) {
        RT.on('notification', () => setTimeout(apply, 50));
        RT.on('message', () => setTimeout(apply, 50));
      }
    } catch (e) {}
    setInterval(apply, 4000);
  }
  function setBadge(id, n) {
    const el = document.getElementById(id);
    if (!el) return;
    if (n > 0) { el.textContent = n > 99 ? '99+' : String(n); el.hidden = false; }
    else el.hidden = true;
  }

  // ---------- Sheet primitive (bottom sheet w/ backdrop + swipe-down) ----------
  function makeSheet(kind, innerHTML) {
    const back = document.createElement('div');
    back.className = 'm-sheet-back';
    back.innerHTML = `<div class="m-sheet m-sheet-${kind}">${innerHTML}</div>`;
    document.body.appendChild(back);
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => back.classList.add('show'));
    const sheetEl = back.querySelector('.m-sheet');
    const close = () => { back.classList.remove('show'); document.body.style.overflow = ''; setTimeout(() => back.remove(), 240); };
    back.addEventListener('click', e => { if (e.target === back) close(); });
    // swipe-down to dismiss
    let sy = 0, dy = 0, drag = false;
    sheetEl.addEventListener('touchstart', e => { sy = e.touches[0].clientY; drag = true; sheetEl.style.transition = 'none'; }, { passive: true });
    sheetEl.addEventListener('touchmove', e => { if (!drag) return; dy = Math.max(0, e.touches[0].clientY - sy); sheetEl.style.transform = `translateY(${dy}px)`; }, { passive: true });
    sheetEl.addEventListener('touchend', () => { if (!drag) return; sheetEl.style.transition = ''; if (dy > 110) close(); else sheetEl.style.transform = ''; drag = false; dy = 0; });
    return { el: sheetEl, back, close };
  }

  function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 280) + 'px'; }

  // ---------- Inline SVG icons ----------
  const ICONS = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5 12 3l9 6.5"/><path d="M5 10v10h14V10"/></svg>',
    people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 5.5a3 3 0 0 1 0 5.5M21 20a6 6 0 0 0-4-5.7"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.5L3 21l2-5.6A8.5 8.5 0 1 1 21 11.5Z"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 2.6 5.6L21 9.3l-4.5 4.3L17.8 21 12 17.8 6.2 21l1.3-7.4L3 9.3l6.4-.7Z"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 2.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 7 2.6h.1A1.6 1.6 0 0 0 9 1.1V1a2 2 0 1 1 4 0v.1A1.6 1.6 0 0 0 17 2.6a1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.1a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.4 1Z"/></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 21h16"/></svg>',
    sparkle: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.6 4.6L18 8.2l-4.4 1.6L12 14l-1.6-4.2L6 8.2l4.4-1.6L12 2z"/></svg>',
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
