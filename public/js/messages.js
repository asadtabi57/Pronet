(async function () {
  if (!requireAuth()) return;
  await renderNav('messaging');
  const me = getMe();
  const listEl = document.getElementById('msg-list');
  const convEl = document.getElementById('msg-conv');
  const shell = document.getElementById('msg-shell');
  let active = null;
  let activeUser = null;
  const seen = new Set(); // message ids already rendered in the open conversation

  // Messages are editable for 2 minutes, deletable for 5 minutes after sending.
  const MSG_EDIT_MS = 2 * 60 * 1000;
  const MSG_DELETE_MS = 5 * 60 * 1000;

  function bubbleHTML(m) {
    const mine = m.from_id === me.id;
    const who = mine ? me : (activeUser || { name: '', avatar_color: '#0a66c2' });
    const age = Date.now() - m.created_at;
    let actions = '';
    if (mine) {
      const parts = [];
      if (age <= MSG_EDIT_MS) parts.push('<a href="#" class="m-edit">Edit</a>');
      if (age <= MSG_DELETE_MS) parts.push('<a href="#" class="m-del">Delete</a>');
      if (parts.length) actions = ' · ' + parts.join(' · ');
    }
    const edited = m.edited ? ' <span class="edited-tag">(edited)</span>' : '';
    return `<div class="msg-item" data-mid="${m.id}" data-created="${m.created_at}">
      <div class="msg-row ${mine ? 'from-me' : 'from-them'}">
        ${avatar(who, 'sm')}
        <div class="msg-bubble ${mine ? 'from-me' : 'from-them'}"><span class="m-text">${escapeHTML(m.content)}</span></div>
      </div>
      <div class="msg-meta ${mine ? 'from-me' : ''}">${timeAgo(m.created_at)}${edited}${actions}</div>
    </div>`;
  }

  function findItem(id) {
    const body = document.getElementById('conv-body');
    return body ? body.querySelector(`.msg-item[data-mid="${id}"]`) : null;
  }
  function updateBubble(m) {
    const item = findItem(m.id);
    if (!item) return;
    const t = item.querySelector('.m-text');
    if (t) t.textContent = m.content;
    const meta = item.querySelector('.msg-meta');
    if (meta && !meta.querySelector('.edited-tag')) {
      const tag = document.createElement('span');
      tag.className = 'edited-tag';
      tag.textContent = ' (edited)';
      // Place right after the timestamp text node, before any action links.
      meta.insertBefore(tag, meta.childNodes[1] || null);
    }
  }
  function removeBubble(id) {
    const item = findItem(id);
    if (item) item.remove();
  }

  async function loadThreads() {
    const { threads } = await api('/api/messages/threads');
    const head = '<div class="msg-list-head">Messaging</div>';
    if (!threads.length) {
      listEl.innerHTML = head + '<p class="empty">No conversations yet.<br/>Start one from someone\'s profile.</p>';
      return;
    }
    listEl.innerHTML = head + threads.map(t => `
      <div class="msg-thread ${active === t.user.id ? 'active' : ''}" data-id="${t.user.id}">
        ${avatar(t.user, 'md')}
        <div class="body">
          <div class="head"><span class="name">${escapeHTML(t.user.name)}</span><span class="time">${timeAgo(t.last_message.created_at)}</span></div>
          <div class="preview">${escapeHTML(t.last_message.content.slice(0, 80))}</div>
        </div>
        ${t.unread ? '<div class="unread-dot"></div>' : ''}
      </div>`).join('');
    listEl.querySelectorAll('.msg-thread').forEach(node => {
      node.onclick = () => openConv(+node.dataset.id);
    });
  }

  function scrollConvToBottom() {
    const body = document.getElementById('conv-body');
    if (body) body.scrollTop = body.scrollHeight;
  }

  // Append a single live message to the open conversation (with dedupe).
  function appendLiveMessage(m) {
    const body = document.getElementById('conv-body');
    if (!body) return;
    if (seen.has(m.id)) return;
    seen.add(m.id);
    const emptyEl = body.querySelector('.empty');
    if (emptyEl) body.innerHTML = '';
    body.insertAdjacentHTML('beforeend', bubbleHTML(m));
    scrollConvToBottom();
  }

  async function openConv(userId) {
    active = userId;
    seen.clear();
    shell.classList.add('show-conv');
    convEl.innerHTML = '<div class="empty">Loading…</div>';
    const { user, messages } = await api(`/api/messages/${userId}`);
    activeUser = user;
    convEl.innerHTML = `
      <div class="msg-conv-head">
        <button type="button" id="back" class="msg-back" aria-label="Back">←</button>
        ${avatar(user, 'md')}
        <div class="conv-head-info">
          <div style="font-weight:700">${escapeHTML(user.name)}</div>
          <div style="color:var(--muted);font-size:12px">${escapeHTML(user.headline || '')}</div>
        </div>
        <div class="spacer" style="flex:1"></div>
        <div class="conv-head-actions" id="conv-call-actions"></div>
        <a class="btn-tiny" href="/profile.html?id=${user.id}">View profile</a>
      </div>
      <div class="msg-conv-body" id="conv-body"></div>
      <form class="msg-form">
        <textarea placeholder="Write a message…" required></textarea>
        <button class="btn-fill" type="submit">Send</button>
      </form>`;

    // Call buttons (audio/video) — only for connected users.
    if (window.CallUI && user.connected) {
      const box = document.getElementById('conv-call-actions');
      box.innerHTML = `
        <button type="button" class="call-icon-btn" id="btn-audio-call" title="Audio call" aria-label="Audio call">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
        </button>
        <button type="button" class="call-icon-btn" id="btn-video-call" title="Video call" aria-label="Video call">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
        </button>`;
      document.getElementById('btn-audio-call').onclick = () => window.CallUI.startCall(user, 'audio');
      document.getElementById('btn-video-call').onclick = () => window.CallUI.startCall(user, 'video');
    }

    const body = document.getElementById('conv-body');
    if (!messages.length) {
      body.innerHTML = '<div class="empty">No messages yet — say hi 👋</div>';
    } else {
      messages.forEach(m => seen.add(m.id));
      body.innerHTML = messages.map(bubbleHTML).join('');
      scrollConvToBottom();
    }
    loadCallLogs(userId);
    convEl.querySelector('form').onsubmit = async (ev) => {
      ev.preventDefault();
      const ta = ev.target.querySelector('textarea');
      const v = ta.value.trim();
      if (!v) return;
      ta.value = '';
      const { message } = await api(`/api/messages/${userId}`, { method: 'POST', body: { content: v } });
      appendLiveMessage(message);
      loadThreads();
    };
    const backBtn = document.getElementById('back');
    if (backBtn) backBtn.onclick = () => { shell.classList.remove('show-conv'); active = null; };
    loadThreads();
  }

  // ===== Realtime: live incoming/outgoing messages =====
  RT.on('message', (d) => {
    if (!d || !d.message) return;
    const m = d.message;
    const action = d.action || 'new';
    const otherId = m.from_id === me.id ? m.to_id : m.from_id;
    if (action === 'update') {
      if (active && otherId === active) updateBubble(m);
      loadThreads();
      return;
    }
    if (action === 'delete') {
      if (active && otherId === active) removeBubble(m.id);
      loadThreads();
      return;
    }
    if (active && otherId === active) {
      appendLiveMessage(m);
      if (m.to_id === me.id) api(`/api/messages/${active}`).catch(() => {});
    }
    loadThreads();
  });

  // ===== Edit / delete own messages (delegated; convEl persists across renders) =====
  convEl.addEventListener('click', async (e) => {
    const editA = e.target.closest('.m-edit');
    const delA = e.target.closest('.m-del');
    if (!editA && !delA) return;
    e.preventDefault();
    const item = e.target.closest('.msg-item');
    if (!item) return;
    const mid = item.dataset.mid;

    if (delA) {
      if (!confirm('Delete this message?')) return;
      try { await api(`/api/messages/${mid}`, { method: 'DELETE' }); removeBubble(mid); loadThreads(); }
      catch (ex) { toast(ex.message || 'Could not delete message.'); }
      return;
    }

    // Inline edit
    const bubble = item.querySelector('.msg-bubble');
    const textEl = item.querySelector('.m-text');
    if (item.querySelector('.m-edit-box')) return; // already editing
    const current = textEl.textContent;
    const box = document.createElement('div');
    box.className = 'm-edit-box';
    box.innerHTML = `<input class="m-edit-input" /><div class="m-edit-actions"><a href="#" class="m-save">Save</a> · <a href="#" class="m-cancel">Cancel</a></div>`;
    bubble.appendChild(box);
    const input = box.querySelector('.m-edit-input');
    input.value = current; input.focus();
    box.querySelector('.m-cancel').onclick = (ev) => { ev.preventDefault(); box.remove(); };
    box.querySelector('.m-save').onclick = async (ev) => {
      ev.preventDefault();
      const v = input.value.trim();
      if (!v) return;
      try {
        const r = await api(`/api/messages/${mid}`, { method: 'PUT', body: { content: v } });
        box.remove();
        updateBubble({ id: mid, from_id: me.id, content: r.content });
      } catch (ex) { toast(ex.message || 'Could not edit message.'); }
    };
  });

  // ===== Call logs (last 30 days) shown as system lines in the conversation =====
  function fmtDuration(s) {
    if (!s) return '';
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }
  function callLogLabel(c) {
    const outgoing = c.caller_id === me.id;
    const type = c.call_type === 'video' ? 'Video call' : 'Audio call';
    if (c.status === 'ended') return `${type} ended · ${fmtDuration(c.duration_seconds)}`;
    if (c.status === 'missed') return outgoing ? `${type} — no answer` : `Missed ${type.toLowerCase()}`;
    if (c.status === 'rejected') return outgoing ? `${type} declined` : `${type} declined`;
    return type;
  }
  async function loadCallLogs(userId) {
    let logs = [];
    try { ({ logs } = await api(`/api/calls/logs/${userId}`)); } catch (e) { return; }
    const body = document.getElementById('conv-body');
    if (!body || !logs.length) return;
    // Render newest call as a subtle centered line at the bottom of the thread.
    body.querySelectorAll('.call-log-line').forEach(n => n.remove());
    const html = logs.slice(0, 8).reverse().map(c => {
      const icon = c.call_type === 'video' ? '🎥' : '📞';
      const dir = c.caller_id === me.id ? 'out' : 'in';
      return `<div class="call-log-line ${dir}"><span class="cll-icon">${icon}</span>${escapeHTML(callLogLabel(c))} · ${timeAgo(c.created_at)}</div>`;
    }).join('');
    body.insertAdjacentHTML('beforeend', html);
    scrollConvToBottom();
  }

  // When a call ends, refresh the call-log lines in the open conversation.
  window.__onCallEnded = () => { if (active) loadCallLogs(active); };

  await loadThreads();
  const initialUser = new URLSearchParams(location.search).get('user');
  if (initialUser) openConv(+initialUser);
})();
