// ===== Reactions =====
const REACTIONS = [
  { id: 'like',       emoji: '👍', label: 'Like',       color: '#0a66c2' },
  { id: 'heart',      emoji: '❤️', label: 'Love',       color: '#df3535' },
  { id: 'celebrate',  emoji: '🎉', label: 'Celebrate',  color: '#6dae4f' },
  { id: 'support',    emoji: '🤗', label: 'Support',    color: '#a872e8' },
  { id: 'insightful', emoji: '💡', label: 'Insightful', color: '#e7a33e' },
  { id: 'funny',      emoji: '😄', label: 'Funny',      color: '#1a8d8d' },
  { id: 'sad',        emoji: '😢', label: 'Sad',        color: '#5a7185' },
  // Legacy aliases so old data still renders
  { id: 'clap',       emoji: '🎉', label: 'Celebrate',  color: '#6dae4f' },
  { id: 'appreciate', emoji: '🤗', label: 'Support',    color: '#a872e8' },
  { id: 'amazed',     emoji: '💡', label: 'Insightful', color: '#e7a33e' },
];
const PICKER_REACTIONS = REACTIONS.slice(0, 7);
const reactionById = id => REACTIONS.find(r => r.id === id);

function reactionSummary(counts) {
  if (!counts) return '';
  const entries = Object.entries(counts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '';
  const top = entries.slice(0, 3).map(([id]) => `<span class="rx">${(reactionById(id) || {}).emoji || '👍'}</span>`).join('');
  const total = entries.reduce((s, [, n]) => s + n, 0);
  return `<span class="reaction-summary">${top}</span> ${total}`;
}

function likeBtnHTML(p) {
  const r = p.my_reaction ? reactionById(p.my_reaction) : null;
  const cls = r ? `rx-${r.id}` : '';
  const label = r ? r.label : 'Like';
  const emoji = r ? r.emoji : '👍';
  return `<div class="like-wrap">
    <div class="reaction-picker" aria-hidden="true">
      ${PICKER_REACTIONS.map((rx, i) => `<button data-rx="${rx.id}" data-label="${rx.label}" title="${rx.label}" style="--i:${i}">${rx.emoji}</button>`).join('')}
    </div>
    <button class="like-btn ${cls}" type="button"><span class="my-rx">${emoji}</span> <span class="my-lbl label">${label}</span></button>
  </div>`;
}

// ===== Post rendering shared between pages =====
function renderPostInner(p) {
  let media = '';
  if (p.media_type === 'image' && p.media_url) {
    media = `<div class="post-media"><img src="${escapeHTML(p.media_url)}" alt="" loading="lazy"/></div>`;
  } else if (p.media_type === 'video' && p.media_url) {
    if (/youtube\.com|youtu\.be/.test(p.media_url)) {
      const id = (p.media_url.match(/(?:v=|youtu\.be\/)([\w-]+)/) || [])[1];
      // Lightweight click-to-play facade: just a thumbnail until tapped, so the
      // heavy YouTube player iframe is never loaded for off-screen feed posts.
      media = `<div class="post-media yt-facade" data-yt="${escapeHTML(id || '')}">
        <img src="https://i.ytimg.com/vi/${escapeHTML(id || '')}/hqdefault.jpg" alt="" loading="lazy"/>
        <button type="button" class="yt-play" aria-label="Play video"></button>
      </div>`;
    } else {
      media = `<div class="post-media"><video src="${escapeHTML(p.media_url)}" controls preload="metadata"></video></div>`;
    }
  }
  let repost = '';
  if (p.repost_of) {
    const orig = p.repost_of;
    repost = `<div class="repost-wrap">
      <div class="post-head">
        ${avatar({ name: orig.name, avatar_color: orig.avatar_color, avatar_url: orig.avatar_url })}
        <div>
          <div class="name"><a href="/profile.html?id=${orig.user_id}">${escapeHTML(orig.name)}</a></div>
          <div class="meta">${escapeHTML(orig.headline || '')} · ${timeAgo(orig.created_at)}</div>
        </div>
      </div>
      <div class="post-content">${escapeHTML(orig.content)}</div>
      ${orig.media_type === 'image' && orig.media_url ? `<div class="post-media"><img src="${escapeHTML(orig.media_url)}" loading="lazy"/></div>` : ''}
    </div>`;
  }
  return `
    <div class="post-head">
      ${avatar({ name: p.name, avatar_color: p.avatar_color, avatar_url: p.avatar_url })}
      <div>
        <div class="name"><a href="/profile.html?id=${p.user_id}">${escapeHTML(p.name)}</a></div>
        <div class="meta">${escapeHTML(p.headline || '')} · ${timeAgo(p.created_at)}</div>
      </div>
      <button class="more" title="More">⋯</button>
    </div>
    ${p.content ? `<div class="post-content">${escapeHTML(p.content)}</div>` : ''}
    ${media}
    ${repost}
    <div class="post-stats">
      <span class="like-stat">${reactionSummary(p.reaction_counts) || '👍 0'}</span>
      <span class="comment-stat">${p.comment_count} comments · ${p.share_count} reposts</span>
    </div>
    <div class="post-actions">
      ${likeBtnHTML(p)}
      <button class="comment-btn"><span class="icon">💬</span> <span class="label">Comment</span></button>
      <button class="repost-btn"><span class="icon">🔁</span> <span class="label">Repost</span></button>
      <button class="send-btn"><span class="icon">📤</span> <span class="label">Send</span></button>
      <button class="share-btn"><span class="icon">🔗</span> <span class="label">Share</span></button>
    </div>
    <div class="comments" hidden></div>
  `;
}

function wirePost(el, p, opts = {}) {
  const id = p.id;
  // Dead media source (deleted/blocked upstream) → friendly placeholder
  // instead of a permanently blank player.
  const vidEl = el.querySelector('.post-media video');
  if (vidEl) {
    vidEl.addEventListener('error', () => {
      const box = vidEl.closest('.post-media');
      if (box) box.innerHTML = '<div class="media-unavailable">🎬 Video unavailable</div>';
    }, { once: true });
  }
  // Click-to-play YouTube facade → swap in the real player only on demand.
  const fac = el.querySelector('.yt-facade');
  if (fac) {
    fac.addEventListener('click', () => {
      const vid = fac.dataset.yt;
      if (!vid) return;
      fac.outerHTML = `<div class="post-media"><iframe width="100%" height="400" src="https://www.youtube.com/embed/${vid}?autoplay=1" frameborder="0" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe></div>`;
    }, { once: true });
  }
  const wrap = el.querySelector('.like-wrap');
  const likeBtn = el.querySelector('.like-btn');

  async function setReaction(type) {
    // type = string id or null to remove
    const next = (p.my_reaction === type) ? null : type;
    const r = await api(`/api/posts/${id}/react`, { method: 'POST', body: { type: next } });
    // update local DTO and stats
    if (p.my_reaction) {
      p.reaction_counts[p.my_reaction] = Math.max(0, (p.reaction_counts[p.my_reaction] || 1) - 1);
    }
    if (r.my_reaction) {
      p.reaction_counts[r.my_reaction] = (p.reaction_counts[r.my_reaction] || 0) + 1;
    }
    p.my_reaction = r.my_reaction;
    p.like_count = Object.values(p.reaction_counts).reduce((s, n) => s + n, 0);
    // re-render button + summary
    const oldWrap = el.querySelector('.like-wrap');
    oldWrap.outerHTML = likeBtnHTML(p);
    el.querySelector('.like-stat').innerHTML = reactionSummary(p.reaction_counts) || '👍 0';
    rewireLike();
  }

  function rewireLike() {
    const newBtn = el.querySelector('.like-btn');
    const newWrap = el.querySelector('.like-wrap');

    // Click the main button: toggle 'like' (LinkedIn behavior)
    newBtn.onclick = (ev) => {
      ev.stopPropagation();
      newWrap.classList.remove('open');
      setReaction('like');
    };

    // Click a specific emoji
    newWrap.querySelectorAll('.reaction-picker button').forEach(b => {
      b.onclick = (ev) => {
        ev.stopPropagation(); ev.preventDefault();
        newWrap.classList.remove('open');
        setReaction(b.dataset.rx);
      };
    });

    // Hover-open with small delay; close after leaving with a grace period
    let openTimer, closeTimer;
    const open = () => {
      clearTimeout(closeTimer);
      openTimer = setTimeout(() => newWrap.classList.add('open'), 350);
    };
    const close = () => {
      clearTimeout(openTimer);
      closeTimer = setTimeout(() => newWrap.classList.remove('open'), 220);
    };
    newWrap.addEventListener('mouseenter', open);
    newWrap.addEventListener('mouseleave', close);
    newBtn.addEventListener('focus', open);
    newBtn.addEventListener('blur', close);

    // Touch: long-press to open
    let pressTimer;
    newBtn.addEventListener('touchstart', (e) => {
      pressTimer = setTimeout(() => {
        newWrap.classList.add('open');
        e.preventDefault();
      }, 380);
    }, { passive: false });
    newBtn.addEventListener('touchend', () => clearTimeout(pressTimer));
    newBtn.addEventListener('touchmove', () => clearTimeout(pressTimer));

    // Right-click anywhere on button also opens picker
    newBtn.addEventListener('contextmenu', e => { e.preventDefault(); newWrap.classList.toggle('open'); });

    // Click outside closes
    document.addEventListener('click', (e) => {
      if (!newWrap.contains(e.target)) newWrap.classList.remove('open');
    }, { once: false });
  }
  rewireLike();

  el.querySelector('.comment-btn').onclick = () => toggleComments(el, id);
  el.querySelector('.repost-btn').onclick = () => openRepostModal(p, opts.onChange);
  el.querySelector('.send-btn').onclick = () => openSendModal(p);
  el.querySelector('.share-btn').onclick = () => openShareSheet(p);
  const more = el.querySelector('.more');
  const me = getMe();
  if (me && p.user_id === me.id) {
    more.onclick = async () => {
      if (!(await confirmDialog({ title: 'Delete post?', message: 'This post will be permanently removed.', confirmText: 'Delete' }))) return;
      await api(`/api/posts/${id}`, { method: 'DELETE' });
      if (opts.onChange) opts.onChange();
    };
  } else { more.style.visibility = 'hidden'; }
}

async function toggleComments(el, id) {
  const box = el.querySelector('.comments');
  if (!box.hidden) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = '<p class="empty">Loading…</p>';
  const { comments } = await api(`/api/posts/${id}/comments`);
  const me = getMe();
  box.innerHTML = comments.map(c => commentHTML(c, me)).join('') + `
    <form class="comment-form">
      ${avatar(me, 'sm')}
      <input placeholder="Add a comment…" required />
      <button class="btn btn-primary" type="submit">Send</button>
    </form>`;
  box.querySelectorAll('.comment').forEach(node => wireComment(node, el, id));
  box.querySelector('form').onsubmit = async (ev) => {
    ev.preventDefault();
    const input = ev.target.querySelector('input');
    const v = input.value.trim();
    if (!v) return;
    if (window.AI && !(await AI.tonePrecheck(v))) return;
    await api(`/api/posts/${id}/comments`, { method: 'POST', body: { content: v } });
    input.value = '';
    box.hidden = true; toggleComments(el, id);
    const stat = el.querySelector('.comment-stat');
    const m = stat.textContent.match(/(\d+) comments · (\d+) reposts/);
    if (m) stat.textContent = `${(+m[1])+1} comments · ${m[2]} reposts`;
  };
}

// Comments are editable for 2 minutes and deletable for 5 minutes after posting.
const COMMENT_EDIT_MS = 2 * 60 * 1000;
const COMMENT_DELETE_MS = 5 * 60 * 1000;

function commentHTML(c, me) {
  const mine = me && c.user_id === me.id;
  const age = Date.now() - c.created_at;
  let actions = '';
  if (mine) {
    const canEdit = age <= COMMENT_EDIT_MS;
    const canDel = age <= COMMENT_DELETE_MS;
    const parts = [];
    if (canEdit) parts.push('<a href="#" class="c-edit">Edit</a>');
    if (canDel) parts.push('<a href="#" class="c-del">Delete</a>');
    if (parts.length) actions = `<div class="comment-actions">${parts.join(' · ')}</div>`;
  }
  const edited = c.edited ? ' <span class="edited-tag">(edited)</span>' : '';
  return `
    <div class="comment" data-cid="${c.id}" data-created="${c.created_at}">
      ${avatar({ name: c.name, avatar_color: c.avatar_color, avatar_url: c.avatar_url }, 'sm')}
      <div class="bubble">
        <a href="/profile.html?id=${c.user_id}"><span class="name">${escapeHTML(c.name)}</span></a>
        <div class="headline">${escapeHTML(c.headline || '')}</div>
        <span class="c-text">${escapeHTML(c.content)}</span>${edited}
        ${actions}
      </div>
    </div>`;
}

function wireComment(node, el, postId) {
  const cid = node.dataset.cid;
  const editLink = node.querySelector('.c-edit');
  const delLink = node.querySelector('.c-del');
  if (editLink) editLink.onclick = (e) => {
    e.preventDefault();
    const textEl = node.querySelector('.c-text');
    const current = textEl.textContent;
    const bubble = node.querySelector('.bubble');
    const actions = node.querySelector('.comment-actions');
    if (actions) actions.style.display = 'none';
    const editor = document.createElement('div');
    editor.className = 'comment-edit';
    editor.innerHTML = `<input class="c-edit-input" value="" /><div class="comment-actions"><a href="#" class="c-save">Save</a> · <a href="#" class="c-cancel">Cancel</a></div>`;
    bubble.appendChild(editor);
    const input = editor.querySelector('.c-edit-input');
    input.value = current; input.focus();
    editor.querySelector('.c-cancel').onclick = (ev) => { ev.preventDefault(); editor.remove(); if (actions) actions.style.display = ''; };
    editor.querySelector('.c-save').onclick = async (ev) => {
      ev.preventDefault();
      const v = input.value.trim();
      if (!v) return;
      try {
        const r = await api(`/api/comments/${cid}`, { method: 'PUT', body: { content: v } });
        textEl.textContent = r.content;
        if (!node.querySelector('.edited-tag')) {
          textEl.insertAdjacentHTML('afterend', ' <span class="edited-tag">(edited)</span>');
        }
        editor.remove(); if (actions) actions.style.display = '';
      } catch (ex) { toast(ex.message || 'Could not edit comment.'); }
    };
  };
  if (delLink) delLink.onclick = async (e) => {
    e.preventDefault();
    if (!(await confirmDialog({ title: 'Delete comment?', message: 'This comment will be permanently removed.', confirmText: 'Delete' }))) return;
    try {
      await api(`/api/comments/${cid}`, { method: 'DELETE' });
      node.remove();
      const stat = el.querySelector('.comment-stat');
      const m = stat.textContent.match(/(\d+) comments · (\d+) reposts/);
      if (m && +m[1] > 0) stat.textContent = `${(+m[1])-1} comments · ${m[2]} reposts`;
    } catch (ex) { toast(ex.message || 'Could not delete comment.'); }
  };
}

function openRepostModal(p, onChange) {
  const body = `
    <p style="margin:0 0 12px;color:var(--muted);font-size:13px">Add your thoughts (optional), then share with your network.</p>
    <textarea id="repost-text" rows="3" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:10px;font-family:inherit;font-size:14px" placeholder="Say something…"></textarea>
    <div class="repost-wrap" style="margin-top:12px">
      <div class="post-head">
        ${avatar({ name: p.name, avatar_color: p.avatar_color, avatar_url: p.avatar_url })}
        <div><div class="name">${escapeHTML(p.name)}</div><div class="meta">${escapeHTML(p.headline || '')}</div></div>
      </div>
      <div class="post-content">${escapeHTML((p.content || '').slice(0, 240))}${(p.content || '').length > 240 ? '…' : ''}</div>
    </div>`;
  const footer = `<button class="btn-fill" id="repost-confirm">Repost</button>`;
  const m = openModal({ title: 'Repost', body, footer });
  m.el.querySelector('#repost-confirm').onclick = async () => {
    const content = m.el.querySelector('#repost-text').value.trim();
    await api(`/api/posts/${p.id}/repost`, { method: 'POST', body: { content } });
    m.close(); toast('Reposted to your feed');
    if (onChange) onChange();
  };
}

async function openSendModal(p) {
  const { connections } = await api('/api/connections');
  const body = `
    <p style="margin:0 0 12px;color:var(--muted);font-size:13px">Send this post as a direct message.</p>
    <div class="field"><label>To</label>
      <select id="send-to" style="border:1px solid var(--border);border-radius:8px;padding:10px;font-size:14px">
        ${connections.length ? connections.map(c => `<option value="${c.id}">${escapeHTML(c.name)} — ${escapeHTML(c.headline || '')}</option>`).join('')
                              : '<option value="" disabled>No connections yet — visit My Network</option>'}
      </select>
    </div>
    <div class="field"><label>Note (optional)</label>
      <textarea id="send-note" rows="3" placeholder="Write a message…"></textarea>
    </div>`;
  const footer = `<button class="btn-fill" id="send-confirm" ${connections.length ? '' : 'disabled'}>Send</button>`;
  const m = openModal({ title: 'Send post', body, footer });
  const btn = m.el.querySelector('#send-confirm');
  if (btn) btn.onclick = async () => {
    const to_user_id = +m.el.querySelector('#send-to').value;
    const note = m.el.querySelector('#send-note').value.trim();
    await api(`/api/posts/${p.id}/send`, { method: 'POST', body: { to_user_id, note } });
    m.close(); toast('Message sent');
  };
}

// ===== LinkedIn-style share sheet (bottom-drawer on mobile, modal on desktop) =====
// Post share — thin wrapper around the generalized core.
async function openShareSheet(p) {
  return openShareSheetCore({
    url: `${location.origin}/feed.html#post-${p.id}`,
    shareText: 'Check out this post on Connectik',
    nativeTitle: 'Connectik post',
    sendLabel: 'Send as message',
    sendToConnection: async (to_user_id) => api(`/api/posts/${p.id}/send`, { method: 'POST', body: { to_user_id, note: '' } }),
    onCopy: async () => { try { await api(`/api/posts/${p.id}/share`, { method: 'POST' }); } catch (e) {} },
  });
}

// Profile share — same sheet, but shares a profile link and DMs that link.
async function openProfileShareSheet(user) {
  const url = `${location.origin}/profile.html?id=${user.id}`;
  return openShareSheetCore({
    url,
    shareText: `Check out ${user.name}'s profile on Connectik`,
    nativeTitle: `${user.name} on Connectik`,
    sendLabel: 'Send profile to a connection',
    sendToConnection: async (to_user_id) => api(`/api/messages/${to_user_id}`, { method: 'POST', body: { content: `Check out ${user.name}'s profile: ${url}` } }),
  });
}
if (typeof window !== 'undefined') window.openProfileShareSheet = openProfileShareSheet;

async function openShareSheetCore(cfg) {
  const url = cfg.url;
  const text = `${cfg.shareText}: ${url}`;
  const sendTitle = cfg.sendLabel || 'Send as message';

  // Backdrop + sheet
  const back = document.createElement('div');
  back.className = 'share-back';
  back.innerHTML = `
    <div class="share-sheet" role="dialog" aria-label="Share">
      <div class="share-grab"></div>
      <h3 class="share-title">${escapeHTML(sendTitle)}</h3>
      <div class="share-search">
        <input type="text" placeholder="Search connections" id="ss-search" />
      </div>
      <div class="share-people" id="ss-people">
        <div class="share-empty">Loading…</div>
      </div>
      <div class="share-divider"></div>
      <div class="share-actions">
        <button class="share-act" data-act="native">
          <span class="share-ico share-ico-blue">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          </span>
          <span>Share via</span>
        </button>
        <button class="share-act" data-act="copy">
          <span class="share-ico share-ico-gray">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          </span>
          <span>Copy link</span>
        </button>
        <a class="share-act" data-act="wa" href="https://api.whatsapp.com/send?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">
          <span class="share-ico share-ico-wa">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="#fff"><path d="M17.5 14.4c-.3-.1-1.7-.8-1.9-.9-.3-.1-.5-.1-.7.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.4-2.3-1.4-.9-.7-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5.1-.2.2-.3.2-.5.1-.2 0-.4 0-.5-.1-.1-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.1 3.3 5.2 4.6.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.7-.7 1.9-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3zM12 2C6.5 2 2 6.5 2 12c0 1.8.5 3.5 1.3 5L2 22l5.1-1.3c1.4.8 3.1 1.3 4.9 1.3 5.5 0 10-4.5 10-10S17.5 2 12 2z"/></svg>
          </span>
          <span>WhatsApp</span>
        </a>
        <a class="share-act" data-act="sms" href="sms:?body=${encodeURIComponent(text)}">
          <span class="share-ico share-ico-msg">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </span>
          <span>Messages</span>
        </a>
      </div>
    </div>`;
  document.body.appendChild(back);
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => back.classList.add('open'));

  function close() {
    back.classList.remove('open');
    document.body.style.overflow = '';
    setTimeout(() => back.remove(), 220);
  }
  back.addEventListener('click', (e) => { if (e.target === back) close(); });

  // Swipe-to-dismiss on mobile
  const sheet = back.querySelector('.share-sheet');
  let startY = 0, dy = 0, dragging = false;
  sheet.addEventListener('touchstart', (e) => {
    if (window.innerWidth > 600) return;
    startY = e.touches[0].clientY; dragging = true; sheet.style.transition = 'none';
  }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    dy = Math.max(0, e.touches[0].clientY - startY);
    sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  sheet.addEventListener('touchend', () => {
    if (!dragging) return;
    sheet.style.transition = '';
    if (dy > 100) close();
    else sheet.style.transform = '';
    dragging = false; dy = 0;
  });

  // Actions
  back.querySelector('[data-act="copy"]').onclick = async (e) => {
    e.preventDefault();
    try { await navigator.clipboard.writeText(url); toast('Link copied!'); }
    catch { prompt('Copy this link:', url); }
    if (cfg.onCopy) await cfg.onCopy();
    close();
  };
  const nativeBtn = back.querySelector('[data-act="native"]');
  if (navigator.share) {
    nativeBtn.onclick = async (e) => {
      e.preventDefault();
      try { await navigator.share({ title: cfg.nativeTitle || 'Connectik', text, url }); close(); }
      catch (err) {}
    };
  } else {
    nativeBtn.style.opacity = '0.5';
    nativeBtn.onclick = (e) => { e.preventDefault(); toast('Not supported here'); };
  }
  back.querySelectorAll('[data-act="wa"], [data-act="sms"]').forEach(a => {
    a.addEventListener('click', () => setTimeout(close, 100));
  });

  // Load connections horizontally
  try {
    const { connections } = await api('/api/connections');
    const peopleEl = back.querySelector('#ss-people');
    if (!connections.length) {
      peopleEl.innerHTML = '<div class="share-empty">No connections yet — visit My Network</div>';
    } else {
      renderPeople(connections);
      function renderPeople(list) {
        peopleEl.innerHTML = list.map(c => `
          <button class="share-person" data-id="${c.id}">
            ${avatar(c, 'lg')}
            <span class="share-pname">${escapeHTML((c.name || '').split(' ').slice(0, 2).join(' '))}</span>
          </button>`).join('');
        peopleEl.querySelectorAll('.share-person').forEach(node => {
          node.onclick = async () => {
            const to_user_id = +node.dataset.id;
            try { await cfg.sendToConnection(to_user_id); toast('Sent as message'); }
            catch (e) { toast(e.message || 'Could not send'); }
            close();
          };
        });
      }
      const search = back.querySelector('#ss-search');
      search.oninput = () => {
        const q = search.value.toLowerCase().trim();
        renderPeople(q ? connections.filter(c => (c.name || '').toLowerCase().includes(q)) : connections);
      };
    }
  } catch (e) {
    back.querySelector('#ss-people').innerHTML = '<div class="share-empty">Could not load connections</div>';
  }
}
