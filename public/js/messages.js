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

  // Seamless single-path tick glyphs (Material "done" / "done_all"); the
  // double-check is one connected shape so there's no gap between the ticks.
  const TICK_SENT = '<svg class="tick-ic" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
  const TICK_SEEN = '<svg class="tick-ic" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z"/></svg>';
  function tickHTML(read) {
    return `<span class="msg-ticks${read ? ' read' : ''}" title="${read ? 'Seen' : 'Sent'}">${read ? TICK_SEEN : TICK_SENT}</span>`;
  }

  // ===== Attachments (one-to-one chat, <= 5 MB) =====
  const MAX_ATTACH = 5 * 1024 * 1024;
  const ATTACH_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,audio/*,video/*';
  const PAPERCLIP = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>';
  function fmtSize(b) {
    if (b == null) return '';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return Math.round(b / 1024) + ' KB';
    return (b / 1048576).toFixed(1) + ' MB';
  }
  function fileGlyph(type) {
    type = type || '';
    if (type === 'application/pdf') return '📄';
    if (type.includes('zip')) return '🗜️';
    if (type.includes('word') || type === 'text/plain') return '📝';
    if (type.includes('sheet') || type.includes('excel')) return '📊';
    if (type.includes('presentation') || type.includes('powerpoint')) return '📽️';
    if (type.startsWith('audio/')) return '🎵';
    if (type.startsWith('video/')) return '🎬';
    return '📎';
  }
  function attachmentHTML(att) {
    if (!att || !att.url) return '';
    const url = escapeHTML(att.url);
    const type = att.type || '';
    const name = escapeHTML(att.name || 'file');
    if (type.startsWith('image/')) {
      return `<a class="msg-att-img" href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${name}" loading="lazy"></a>`;
    }
    if (type.startsWith('video/')) {
      return `<video class="msg-att-media" src="${url}" controls preload="metadata"></video>`;
    }
    if (type.startsWith('audio/')) {
      return `<audio class="msg-att-audio" src="${url}" controls preload="metadata"></audio>`;
    }
    return `<a class="msg-att-file" href="${url}" target="_blank" rel="noopener" download="${name}">
      <span class="att-ic">${fileGlyph(type)}</span>
      <span class="att-info"><span class="att-name">${name}</span><span class="att-size">${fmtSize(att.size)}</span></span>
    </a>`;
  }
  function readAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('Could not read file'));
      r.readAsDataURL(file);
    });
  }

  // A post shared into the DM: strip any inlined post text from the displayed
  // note (legacy messages stored "[Shared post #N] <body>") and render the post
  // as a clickable reference card that deep-links to the post itself.
  function sharedNoteText(m) {
    let text = m.content || '';
    if (m.attached_post_id) {
      const idx = text.indexOf('[Shared post #');
      if (idx >= 0) text = text.slice(0, idx).trim();
    }
    return text;
  }
  function sharedPostHTML(m) {
    if (!m.attached_post_id) return '';
    const sp = m.shared_post || {};
    const href = `/feed.html#post-${m.attached_post_id}`;
    const author = sp.author_name ? `<span class="spc-author">${escapeHTML(sp.author_name)}</span>` : '';
    const snippet = sp.preview ? `<span class="spc-snippet">${escapeHTML(sp.preview)}</span>` : '';
    return `<a class="shared-post-card" href="${href}">
        <span class="spc-ico" aria-hidden="true">📄</span>
        <span class="spc-body">
          <span class="spc-title">Shared a post</span>
          ${author}${snippet}
          <span class="spc-go">View post →</span>
        </span>
      </a>`;
  }

  // Small icon buttons that appear on each message for quick reply / react.
  const ICON_REACT = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>';
  const ICON_REPLY = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>';

  // Cache of rendered messages (id -> message), so replies and reactions can
  // look up the original without re-fetching the thread.
  const msgCache = new Map();
  let replyTarget = null; // the message currently being replied to (or null)

  // A short human label for an attachment-only message (used in reply previews).
  function attachmentLabel(type) {
    type = type || '';
    if (type.startsWith('image/')) return '📷 Photo';
    if (type.startsWith('video/')) return '🎬 Video';
    if (type.startsWith('audio/')) return '🎵 Audio';
    return '📎 Attachment';
  }

  // The quoted-message card rendered inside a bubble when it's a reply.
  function replyQuoteHTML(m) {
    if (!m.reply_to) return '';
    const rt = m.reply_to;
    const who = rt.from_id === me.id ? 'You'
      : (rt.from_name || (activeUser && activeUser.name) || 'User');
    let snippet = rt.content || '';
    if (!snippet && rt.attachment_type) snippet = attachmentLabel(rt.attachment_type);
    if (rt.deleted) snippet = 'Original message unavailable';
    const snip = snippet ? escapeHTML(snippet.slice(0, 120)) : '(no text)';
    return `<div class="reply-quote" data-target="${rt.id}">
      <span class="rq-author">${escapeHTML(who)}</span>
      <span class="rq-snippet">${snip}</span>
    </div>`;
  }

  // Reaction pills (emoji + count). `mineReacted` highlights the pill you added.
  function reactionPillsHTML(reactions) {
    if (!reactions || !reactions.length) return '';
    return reactions.map(r => {
      const reacted = (r.user_ids || []).map(Number).includes(me.id);
      return `<button type="button" class="reaction-pill${reacted ? ' mine' : ''}" data-emoji="${escapeHTML(r.emoji)}">
        <span class="rp-emoji">${escapeHTML(r.emoji)}</span><span class="rp-count">${r.count}</span></button>`;
    }).join('');
  }

  // Create/update/remove the reactions strip for a rendered message item.
  function setReactions(item, reactions) {
    if (!item) return;
    const row = item.querySelector('.msg-row');
    const mineMsg = row && row.classList.contains('from-me');
    const html = reactionPillsHTML(reactions);
    let box = item.querySelector('.msg-reactions');
    if (!html) { if (box) box.remove(); return; }
    if (!box) {
      box = document.createElement('div');
      box.className = 'msg-reactions ' + (mineMsg ? 'from-me' : 'from-them');
      const meta = item.querySelector('.msg-meta');
      item.insertBefore(box, meta);
    }
    box.innerHTML = html;
  }

  function bubbleHTML(m, pending) {
    const mine = m.from_id === me.id;
    const who = mine ? me : (activeUser || { name: '', avatar_color: '#0a66c2' });
    const age = Date.now() - m.created_at;
    let actions = '';
    if (mine && !pending) {
      const parts = [];
      // Editing only makes sense when there is text to edit.
      if (age <= MSG_EDIT_MS && m.content) parts.push('<a href="#" class="m-edit">Edit</a>');
      if (age <= MSG_DELETE_MS) parts.push('<a href="#" class="m-del">Delete</a>');
      if (parts.length) actions = ' · ' + parts.join(' · ');
    }
    const edited = m.edited ? ' <span class="edited-tag">(edited)</span>' : '';
    // While an outgoing message is still uploading, show a subtle status instead
    // of the read ticks (which only make sense once the server has it).
    const ticks = pending ? '<span class="m-sending">Sending…</span>' : (mine ? tickHTML(m.read) : '');
    const attHTML = attachmentHTML(m.attachment);
    const postHTML = sharedPostHTML(m);
    const noteText = m.attached_post_id ? sharedNoteText(m) : m.content;
    const textHTML = noteText ? `<span class="m-text">${escapeHTML(noteText)}</span>` : '';
    const quoteHTML = replyQuoteHTML(m);
    const attOnly = (attHTML || postHTML) && !textHTML && !quoteHTML ? ' att-only' : '';
    // Reply / react affordances (need a real message id, so not on pending sends).
    const hoverActions = pending ? '' : `<div class="msg-hover-actions">
        <button type="button" class="mh-act mh-react" title="React" aria-label="React to message">${ICON_REACT}</button>
        <button type="button" class="mh-act mh-reply" title="Reply" aria-label="Reply to message">${ICON_REPLY}</button>
      </div>`;
    const reactionsBox = (m.reactions && m.reactions.length)
      ? `<div class="msg-reactions ${mine ? 'from-me' : 'from-them'}">${reactionPillsHTML(m.reactions)}</div>` : '';
    return `<div class="msg-item${pending ? ' sending' : ''}" data-mid="${m.id}" data-created="${m.created_at}">
      <div class="msg-row ${mine ? 'from-me' : 'from-them'}">
        ${avatar(who, 'sm')}
        <div class="msg-bubble ${mine ? 'from-me' : 'from-them'}${attHTML || postHTML ? ' has-att' : ''}${attOnly}">${quoteHTML}${attHTML}${textHTML}${postHTML}</div>
        ${hoverActions}
      </div>
      ${reactionsBox}
      <div class="msg-meta ${mine ? 'from-me' : ''}">${timeAgo(m.created_at)}${edited}${actions}${ticks}</div>
    </div>`;
  }

  function findItem(id) {
    const body = document.getElementById('conv-body');
    return body ? body.querySelector(`.msg-item[data-mid="${id}"]`) : null;
  }
  function updateBubble(m) {
    const cached = msgCache.get(Number(m.id));
    if (cached) { cached.content = m.content; cached.edited = 1; }
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
    msgCache.delete(Number(id));
    const item = findItem(id);
    if (item) item.remove();
  }

  // "Active now" if online, otherwise "last seen 5m ago".
  function statusText(user) {
    if (!user) return '';
    if (isUserOnline(user)) return 'Active now';
    if (user.last_seen) return 'last seen ' + timeAgo(user.last_seen);
    return '';
  }
  function isUserOnline(user) {
    if (!user) return false;
    if (window.Presence && Presence.seeded) return Presence.isOnline(user.id);
    return !!user.online;
  }
  function renderStatusLine(user) {
    const el = document.getElementById('conv-status');
    if (!el) return;
    const online = isUserOnline(user);
    el.textContent = statusText(user);
    el.classList.toggle('online', online);
  }
  // The header renders before presence may have finished seeding (common on
  // mobile, where the SSE/presence fetch can resolve a beat later). Re-render the
  // status line once presence seeds (and on every re-seed after a reconnect) so
  // "Active now" / "last seen …" is always accurate instead of stuck on a stale
  // value.
  if (window.Presence && Presence.onSeed) {
    Presence.onSeed(() => { if (activeUser) renderStatusLine(activeUser); });
  }
  // Flip every outgoing bubble's tick to the blue double "seen" state.
  function markOutgoingSeen() {
    document.querySelectorAll('#conv-body .msg-ticks').forEach(s => {
      s.classList.add('read');
      s.innerHTML = TICK_SEEN;
      s.title = 'Seen';
    });
  }

  async function loadThreads() {
    const { threads } = await api('/api/messages/threads');
    const head = '<div class="msg-list-head">Messaging</div>';
    if (!threads.length) {
      listEl.innerHTML = head + '<p class="empty">No conversations yet.<br/>Start one from someone\'s profile.</p>';
      return;
    }
    listEl.innerHTML = head + threads.map(t => {
      const lm = t.last_message;
      let previewText = lm.content || '';
      // Hide the legacy "[Shared post #N] …" marker from the list preview.
      if (lm.attached_post_id) {
        const idx = previewText.indexOf('[Shared post #');
        if (idx >= 0) previewText = previewText.slice(0, idx).trim();
      }
      let preview = previewText ? escapeHTML(previewText.slice(0, 80)) : '';
      if (!preview && lm.attached_post_id) {
        preview = '📄 Shared a post';
      }
      if (!preview && lm.attachment_type) {
        preview = '📎 ' + (lm.attachment_type.startsWith('image/') ? 'Photo'
          : lm.attachment_type.startsWith('video/') ? 'Video'
          : lm.attachment_type.startsWith('audio/') ? 'Audio' : 'Attachment');
      }
      return `
      <div class="msg-thread ${active === t.user.id ? 'active' : ''}" data-id="${t.user.id}">
        ${avatar(t.user, 'md')}
        <div class="body">
          <div class="head"><span class="name">${escapeHTML(t.user.name)}</span><span class="time">${timeAgo(lm.created_at)}</span></div>
          <div class="preview">${preview}</div>
        </div>
        ${t.unread ? '<div class="unread-dot"></div>' : ''}
      </div>`;
    }).join('');
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
    msgCache.set(Number(m.id), m);
    const emptyEl = body.querySelector('.empty');
    if (emptyEl) body.innerHTML = '';
    body.insertAdjacentHTML('beforeend', bubbleHTML(m));
    scrollConvToBottom();
  }

  // Render an outgoing message instantly (before the upload finishes) using a
  // temporary id and a local preview URL for images. Reconciled once the server
  // responds with the real message.
  function appendOptimistic(m) {
    const body = document.getElementById('conv-body');
    if (!body) return;
    const emptyEl = body.querySelector('.empty');
    if (emptyEl) body.innerHTML = '';
    body.insertAdjacentHTML('beforeend', bubbleHTML(m, true));
    scrollConvToBottom();
  }
  function findItemByMid(id) {
    const body = document.getElementById('conv-body');
    return body ? body.querySelector(`.msg-item[data-mid="${id}"]`) : null;
  }
  // Swap the temporary bubble for the real one once the send succeeds.
  function reconcileOptimistic(tempId, real) {
    const temp = findItemByMid(tempId);
    if (temp) temp.remove();
    appendLiveMessage(real);
  }
  // Mark a failed send so the user knows it didn't go through.
  function failOptimistic(tempId, msg) {
    const temp = findItemByMid(tempId);
    if (temp) {
      temp.classList.remove('sending');
      temp.classList.add('failed');
      const meta = temp.querySelector('.msg-meta');
      if (meta) meta.innerHTML = '<span class="m-failed">Failed to send — tap to dismiss</span>';
      temp.onclick = () => temp.remove();
    }
    if (msg) toast(msg);
  }

  // ===== Reply state + the "replying to …" bar above the composer =====
  function renderReplyBar() {
    const bar = document.getElementById('reply-bar');
    if (!bar) return;
    if (!replyTarget) { bar.hidden = true; bar.innerHTML = ''; return; }
    const m = replyTarget;
    const who = m.from_id === me.id ? 'yourself' : ((activeUser && activeUser.name) || 'them');
    let snippet = m.content || '';
    if (!snippet && m.attachment) snippet = attachmentLabel(m.attachment.type);
    if (!snippet && m.attachment_type) snippet = attachmentLabel(m.attachment_type);
    bar.innerHTML = `<div class="reply-bar-inner">
        <div class="rb-accent"></div>
        <div class="rb-body">
          <span class="rb-author">Replying to ${escapeHTML(who)}</span>
          <span class="rb-snippet">${escapeHTML((snippet || '').slice(0, 140)) || '(no text)'}</span>
        </div>
        <button type="button" class="rb-close" title="Cancel reply" aria-label="Cancel reply">×</button>
      </div>`;
    bar.hidden = false;
    bar.querySelector('.rb-close').onclick = clearReplyTarget;
  }
  function setReplyTarget(m) {
    if (!m) return;
    replyTarget = m;
    renderReplyBar();
    const ta = convEl.querySelector('.msg-form textarea');
    if (ta) ta.focus();
  }
  function clearReplyTarget() { replyTarget = null; renderReplyBar(); }

  // Smooth-scroll to a quoted message and briefly highlight it.
  function jumpToMessage(id) {
    const item = findItem(id);
    if (!item) return;
    item.scrollIntoView({ block: 'center', behavior: 'smooth' });
    item.classList.add('msg-highlight');
    setTimeout(() => item.classList.remove('msg-highlight'), 1600);
  }

  // Toggle/set a reaction on a message, then reflect the server's aggregate.
  async function reactToMessage(messageId, emoji) {
    try {
      const { reactions } = await api(`/api/messages/${messageId}/react`, { method: 'POST', body: { emoji } });
      const item = findItem(messageId);
      if (item) setReactions(item, reactions);
      const cached = msgCache.get(Number(messageId));
      if (cached) cached.reactions = reactions;
    } catch (ex) { toast(ex.message || 'Could not react to the message.'); }
  }
  function openReactionPicker(anchor, messageId) {
    if (!window.EmojiPicker) return;
    EmojiPicker.open(anchor, { onPick: (emoji) => reactToMessage(messageId, emoji) });
  }

  function insertAtCursor(ta, text) {
    if (!ta) return;
    const start = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
    const end = ta.selectionEnd != null ? ta.selectionEnd : ta.value.length;
    ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
    const pos = start + text.length;
    ta.selectionStart = ta.selectionEnd = pos;
    ta.focus();
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
          <div class="conv-status${isUserOnline(user) ? ' online' : ''}" id="conv-status">${escapeHTML(statusText(user))}</div>
        </div>
        <div class="spacer" style="flex:1"></div>
        <div class="conv-head-actions" id="conv-call-actions"></div>
        <a class="btn-tiny view-profile" href="/profile.html?id=${user.id}" aria-label="View profile">
          <svg class="vp-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          <span class="vp-label">View profile</span>
        </a>
      </div>
      <div class="msg-conv-body" id="conv-body"></div>
      <div class="smart-replies" id="smart-replies" hidden></div>
      <div class="msg-reply-bar" id="reply-bar" hidden></div>
      <div class="msg-attach-preview" id="attach-preview" hidden></div>
      <form class="msg-form">
        <button type="button" class="msg-attach-btn" id="attach-btn" title="Attach a file" aria-label="Attach a file">${PAPERCLIP}</button>
        <button type="button" class="msg-emoji-btn" id="emoji-btn" title="Emoji" aria-label="Insert emoji">${ICON_REACT}</button>
        <input type="file" id="attach-input" class="msg-attach-input" accept="${ATTACH_ACCEPT}" hidden />
        <textarea placeholder="Write a message…"></textarea>
        <button class="btn-fill" type="submit">Send</button>
      </form>
      <div class="msg-drop-hint" id="drop-hint">Drop file to send (max 5 MB)</div>`;

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
    msgCache.clear();
    replyTarget = null;
    renderReplyBar();
    if (!messages.length) {
      body.innerHTML = '<div class="empty">No messages yet — say hi 👋</div>';
    } else {
      messages.forEach(m => { seen.add(m.id); msgCache.set(Number(m.id), m); });
      body.innerHTML = messages.map(m => bubbleHTML(m)).join('');
      scrollConvToBottom();
    }
    loadCallLogs(userId);
    setupComposer(userId);
    const backBtn = document.getElementById('back');
    if (backBtn) backBtn.onclick = () => { shell.classList.remove('show-conv'); active = null; };
    loadThreads();

    // Warm-intro draft handoff from a profile page: prefill the composer once.
    try {
      const draftRaw = sessionStorage.getItem('pronet_msg_draft');
      if (draftRaw) {
        const draft = JSON.parse(draftRaw);
        if (draft && Number(draft.userId) === Number(userId) && draft.text) {
          const ta = convEl.querySelector('.msg-form textarea');
          if (ta) { ta.value = draft.text; ta.focus(); }
        }
        sessionStorage.removeItem('pronet_msg_draft');
      }
    } catch (e) {}

    // Smart Replies: suggest quick responses to the latest INCOMING message.
    maybeSuggestReplies(messages);
  }

  // Render AI smart-reply pills above the composer, based on the last message
  // the peer sent (only if AI is enabled and the last message isn't ours).
  let smartRepliesToken = 0;
  async function maybeSuggestReplies(messages) {
    const strip = document.getElementById('smart-replies');
    if (!strip || !window.AI) return;
    if (!(await AI.feature('smart_replies'))) return;
    const last = messages && messages.length ? messages[messages.length - 1] : null;
    if (!last || last.from_id === me.id) { strip.hidden = true; strip.innerHTML = ''; return; }
    const context = (last.content || '').trim();
    if (!context) { strip.hidden = true; return; }
    const token = ++smartRepliesToken;
    try {
      const { replies } = await api('/api/ai/suggest-replies', { method: 'POST', body: { context } });
      if (token !== smartRepliesToken) return; // a newer conversation/message superseded us
      if (!replies || !replies.length) { strip.hidden = true; return; }
      strip.innerHTML = `<span class="sr-label">${AI.SPARKLE}</span>` +
        replies.map(r => `<button type="button" class="sr-pill">${escapeHTML(r)}</button>`).join('');
      strip.hidden = false;
      strip.querySelectorAll('.sr-pill').forEach(b => {
        b.onclick = () => {
          const ta = convEl.querySelector('.msg-form textarea');
          if (ta) { ta.value = b.textContent; ta.focus(); }
          strip.hidden = true;
        };
      });
    } catch (e) { strip.hidden = true; }
  }

  // Drag-and-drop wiring shared across conversations (convEl is reused).
  let currentSetPending = null;
  let dropWired = false;
  function wireDropZoneOnce() {
    if (dropWired) return;
    dropWired = true;
    let dragDepth = 0;
    convEl.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
      e.preventDefault(); dragDepth++; convEl.classList.add('drag-over');
    });
    convEl.addEventListener('dragover', (e) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault();
    });
    convEl.addEventListener('dragleave', (e) => {
      e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; convEl.classList.remove('drag-over'); }
    });
    convEl.addEventListener('drop', (e) => {
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;
      e.preventDefault(); dragDepth = 0; convEl.classList.remove('drag-over');
      if (currentSetPending) currentSetPending(file);
    });
  }

  // Wire up the message composer: text + file attachments via the paperclip
  // button, drag-and-drop onto the conversation, or paste from the clipboard.
  function setupComposer(userId) {
    const form = convEl.querySelector('.msg-form');
    if (!form) return;
    const ta = form.querySelector('textarea');
    const sendBtn = form.querySelector('button[type="submit"]');
    const attachBtn = document.getElementById('attach-btn');
    const attachInput = document.getElementById('attach-input');
    const preview = document.getElementById('attach-preview');
    let pendingFile = null;
    let previewUrl = null;

    function clearPending() {
      pendingFile = null;
      if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
      if (attachInput) attachInput.value = '';
      if (preview) { preview.hidden = true; preview.innerHTML = ''; }
    }
    function setPending(file) {
      if (!file) return;
      if (file.size > MAX_ATTACH) { toast('File too large — the limit is 5 MB.'); return; }
      pendingFile = file;
      if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
      let thumb;
      if (file.type.startsWith('image/')) {
        previewUrl = URL.createObjectURL(file);
        thumb = `<img src="${previewUrl}" alt="">`;
      } else {
        thumb = `<span class="att-ic">${fileGlyph(file.type)}</span>`;
      }
      preview.innerHTML = `<div class="att-chip">${thumb}
        <span class="att-info"><span class="att-name">${escapeHTML(file.name)}</span><span class="att-size">${fmtSize(file.size)}</span></span>
        <button type="button" class="att-remove" title="Remove" aria-label="Remove attachment">×</button></div>`;
      preview.hidden = false;
      preview.querySelector('.att-remove').onclick = clearPending;
    }

    if (attachBtn && attachInput) {
      attachBtn.onclick = () => attachInput.click();
      attachInput.onchange = () => { if (attachInput.files[0]) setPending(attachInput.files[0]); };
    }

    // Emoji button → open the full picker; selections insert at the cursor and
    // the picker stays open so several emojis can be added in a row.
    const emojiBtn = document.getElementById('emoji-btn');
    if (emojiBtn && window.EmojiPicker) {
      emojiBtn.onclick = () => EmojiPicker.open(emojiBtn, {
        startExpanded: true, keepOpenOnPick: true,
        onPick: (emoji) => insertAtCursor(ta, emoji),
      });
    }

    // Drag & drop anywhere over the conversation pane. The listeners are wired
    // once (convEl persists across openConv) and routed to the live composer.
    currentSetPending = setPending;
    wireDropZoneOnce();

    // Paste an image (or any file) straight from the clipboard.
    ta.addEventListener('paste', (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const it of items) {
        if (it.kind === 'file') {
          const file = it.getAsFile();
          if (file) { e.preventDefault(); setPending(file); break; }
        }
      }
    });

    // Enter to send, Shift+Enter for newline.
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
    });

    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const text = ta.value.trim();
      const file = pendingFile;
      if (!text && !file) return;
      if (file && file.size > MAX_ATTACH) { toast('File too large — the limit is 5 MB.'); return; }
      // Tone Guardian on outgoing text (no-op if AI unavailable).
      if (text && window.AI && !(await AI.tonePrecheck(text))) return;

      // Capture (and clear) the reply target up front so the composer resets
      // immediately even though the send completes asynchronously.
      const reply = replyTarget;
      const replyPreview = reply ? {
        id: reply.id, from_id: reply.from_id,
        from_name: reply.from_id === me.id ? null : ((activeUser && activeUser.name) || null),
        content: reply.content || '',
        attachment_type: (reply.attachment && reply.attachment.type) || reply.attachment_type || null,
      } : null;

      // Render the message immediately (with a local image preview) so sending
      // feels instant, then upload in the background and reconcile. The composer
      // is cleared right away so the user can keep typing.
      const tempId = 'tmp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      const localUrl = file && file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
      const optimistic = {
        id: tempId, from_id: me.id, to_id: userId, content: text,
        created_at: Date.now(), read: 0, edited: 0,
        reply_to: replyPreview || undefined,
        attachment: file ? { url: localUrl || '#', type: file.type, name: file.name, size: file.size } : null,
      };
      appendOptimistic(optimistic);
      ta.value = '';
      clearPending();
      clearReplyTarget();
      const sr = document.getElementById('smart-replies');
      if (sr) { sr.hidden = true; sr.innerHTML = ''; }
      ta.focus();

      try {
        let message;
        if (file) {
          // Send the raw bytes as multipart/form-data — no base64 (~33% smaller
          // upload, no encode/decode cost on either end).
          const fd = new FormData();
          fd.append('content', text);
          if (replyPreview) fd.append('reply_to_id', String(replyPreview.id));
          fd.append('file', file, file.name);
          ({ message } = await api(`/api/messages/${userId}`, { method: 'POST', body: fd }));
        } else {
          const body = { content: text };
          if (replyPreview) body.reply_to_id = replyPreview.id;
          ({ message } = await api(`/api/messages/${userId}`, { method: 'POST', body }));
        }
        reconcileOptimistic(tempId, message);
        loadThreads();
      } catch (ex) {
        failOptimistic(tempId, ex.message || 'Could not send the message.');
      } finally {
        if (localUrl) URL.revokeObjectURL(localUrl);
      }
    };
  }

  // ===== Realtime: live incoming/outgoing messages =====
  RT.on('message', (d) => {
    if (!d || !d.message) {
      // Read-receipt ping: the peer opened our conversation and saw our messages.
      if (d && d.action === 'read' && active && Number(d.by) === active) { markOutgoingSeen(); return; }
      // Reaction update on a message in (any of) our conversations.
      if (d && d.action === 'react' && d.message_id != null) {
        const item = findItem(d.message_id);
        if (item) setReactions(item, d.reactions || []);
        const cached = msgCache.get(Number(d.message_id));
        if (cached) cached.reactions = d.reactions || [];
      }
      return;
    }
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
      // Mark the peer's messages read via a tiny endpoint instead of re-pulling
      // the whole conversation (which re-downloaded every message + attachment).
      if (m.to_id === me.id) {
        api(`/api/messages/${active}/read`, { method: 'POST' }).catch(() => {});
        // Refresh smart replies for the newly arrived incoming message.
        maybeSuggestReplies([m]);
      }
    }
    loadThreads();
  });

  // ===== Realtime: keep the chat header's online / last-seen line current =====
  RT.on('presence', (d) => {
    if (!d || d.user_id == null || !activeUser) return;
    if (Number(d.user_id) !== Number(activeUser.id)) return;
    // On going offline we don't get an exact timestamp from the event, so stamp
    // "now" locally; a fresh open of the thread will reconcile with the server.
    if (!d.online) activeUser.last_seen = Date.now();
    renderStatusLine(activeUser);
  });

  // ===== Reply / react interactions (delegated; convEl persists across renders) =====
  convEl.addEventListener('click', (e) => {
    const item = e.target.closest('.msg-item');

    // Jump to a quoted message when its preview is tapped.
    const quote = e.target.closest('.reply-quote');
    if (quote) { e.preventDefault(); jumpToMessage(quote.dataset.target); return; }

    // Toggle a reaction by tapping an existing pill.
    const pill = e.target.closest('.reaction-pill');
    if (pill && item) { e.preventDefault(); reactToMessage(item.dataset.mid, pill.dataset.emoji); return; }

    // Reply affordance.
    const replyBtn = e.target.closest('.mh-reply');
    if (replyBtn && item) {
      e.preventDefault();
      const m = msgCache.get(Number(item.dataset.mid));
      if (m) setReplyTarget(m);
      return;
    }

    // React affordance → open the emoji picker anchored to the button.
    const reactBtn = e.target.closest('.mh-react');
    if (reactBtn && item) {
      e.preventDefault();
      openReactionPicker(reactBtn, item.dataset.mid);
      return;
    }
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
      if (!(await confirmDialog({ title: 'Delete message?', message: 'This message will be removed from the chat.', confirmText: 'Delete' }))) return;
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
    if (active !== userId) return; // conversation switched while we were fetching
    body.querySelectorAll('.call-log-line').forEach(n => n.remove());
    const emptyEl = body.querySelector('.empty');
    if (emptyEl) emptyEl.remove();
    // Only auto-scroll if the user is already reading the latest messages.
    const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 200;
    // Weave each call into the thread at its chronological position (message
    // bubbles carry data-created) instead of dumping every old call at the
    // bottom of the conversation.
    const recent = logs.slice(0, 8).sort((a, b) => a.created_at - b.created_at);
    for (const c of recent) {
      const icon = c.call_type === 'video' ? '🎥' : '📞';
      const dir = c.caller_id === me.id ? 'out' : 'in';
      const el = document.createElement('div');
      el.className = `call-log-line ${dir}`;
      el.dataset.created = c.created_at;
      el.innerHTML = `<span class="cll-icon">${icon}</span>${escapeHTML(callLogLabel(c))} · ${timeAgo(c.created_at)}`;
      const nodes = body.querySelectorAll('.msg-item, .call-log-line');
      let before = null;
      for (const n of nodes) {
        if (Number(n.dataset.created || 0) > c.created_at) { before = n; break; }
      }
      if (before) body.insertBefore(el, before); else body.appendChild(el);
    }
    if (nearBottom) scrollConvToBottom();
  }

  // When a call ends, refresh the call-log lines in the open conversation.
  window.__onCallEnded = () => { if (active) loadCallLogs(active); };

  await loadThreads();
  const initialUser = new URLSearchParams(location.search).get('user');
  if (initialUser) openConv(+initialUser);
})();
