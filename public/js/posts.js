// ===== Reactions =====
const REACTIONS = [
  { id: 'like',       emoji: '👍', label: 'Like',       color: '#0a66c2' },
  { id: 'heart',      emoji: '❤️', label: 'Heart',      color: '#e11d48' },
  { id: 'clap',       emoji: '👏', label: 'Clap',       color: '#ca8a04' },
  { id: 'appreciate', emoji: '💜', label: 'Appreciate', color: '#7a3eaf' },
  { id: 'amazed',     emoji: '🤩', label: 'Amazed',     color: '#0e7490' },
];
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
    <div class="reaction-picker">
      ${REACTIONS.map(rx => `<button data-rx="${rx.id}" data-label="${rx.label}" title="${rx.label}">${rx.emoji}</button>`).join('')}
    </div>
    <button class="like-btn ${cls}"><span class="my-rx">${emoji}</span> ${label}</button>
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
      media = `<div class="post-media"><iframe width="100%" height="400" src="https://www.youtube.com/embed/${id}" frameborder="0" allowfullscreen></iframe></div>`;
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
      <button class="comment-btn"><span class="icon">💬</span> Comment</button>
      <button class="repost-btn"><span class="icon">🔁</span> Repost</button>
      <button class="send-btn"><span class="icon">📤</span> Send</button>
      <button class="share-btn"><span class="icon">🔗</span> Share</button>
    </div>
    <div class="comments" hidden></div>
  `;
}

function wirePost(el, p, opts = {}) {
  const id = p.id;
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
    newBtn.onclick = (ev) => {
      ev.stopPropagation();
      // default: toggle 'like'
      setReaction('like');
    };
    newWrap.querySelectorAll('.reaction-picker button').forEach(b => {
      b.onclick = (ev) => {
        ev.stopPropagation(); ev.preventDefault();
        newWrap.classList.remove('open');
        setReaction(b.dataset.rx);
      };
    });
    // long-press / right-click to open picker on touch
    let pressTimer;
    newBtn.addEventListener('touchstart', () => { pressTimer = setTimeout(() => newWrap.classList.add('open'), 350); });
    newBtn.addEventListener('touchend',   () => clearTimeout(pressTimer));
    newBtn.addEventListener('contextmenu', e => { e.preventDefault(); newWrap.classList.toggle('open'); });
  }
  rewireLike();

  el.querySelector('.comment-btn').onclick = () => toggleComments(el, id);
  el.querySelector('.repost-btn').onclick = () => openRepostModal(p, opts.onChange);
  el.querySelector('.send-btn').onclick = () => openSendModal(p);
  el.querySelector('.share-btn').onclick = async () => {
    const url = `${location.origin}/feed.html#post-${id}`;
    try { await navigator.clipboard.writeText(url); toast('Link copied to clipboard'); }
    catch { prompt('Copy this link:', url); }
    await api(`/api/posts/${id}/share`, { method: 'POST' });
  };
  const more = el.querySelector('.more');
  const me = getMe();
  if (me && p.user_id === me.id) {
    more.onclick = async () => {
      if (!confirm('Delete this post?')) return;
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
  box.innerHTML = comments.map(c => `
    <div class="comment">
      ${avatar({ name: c.name, avatar_color: c.avatar_color, avatar_url: c.avatar_url }, 'sm')}
      <div class="bubble">
        <a href="/profile.html?id=${c.user_id}"><span class="name">${escapeHTML(c.name)}</span></a>
        <div class="headline">${escapeHTML(c.headline || '')}</div>
        ${escapeHTML(c.content)}
      </div>
    </div>`).join('') + `
    <form class="comment-form">
      ${avatar(me, 'sm')}
      <input placeholder="Add a comment…" required />
      <button class="btn btn-primary" type="submit">Send</button>
    </form>`;
  box.querySelector('form').onsubmit = async (ev) => {
    ev.preventDefault();
    const input = ev.target.querySelector('input');
    const v = input.value.trim();
    if (!v) return;
    await api(`/api/posts/${id}/comments`, { method: 'POST', body: { content: v } });
    input.value = '';
    box.hidden = true; toggleComments(el, id);
    const stat = el.querySelector('.comment-stat');
    const m = stat.textContent.match(/(\d+) comments · (\d+) reposts/);
    if (m) stat.textContent = `${(+m[1])+1} comments · ${m[2]} reposts`;
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
