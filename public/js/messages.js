(async function () {
  if (!requireAuth()) return;
  await renderNav('messaging');
  const me = getMe();
  const listEl = document.getElementById('msg-list');
  const convEl = document.getElementById('msg-conv');
  const shell = document.getElementById('msg-shell');
  let active = null;

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

  async function openConv(userId) {
    active = userId;
    shell.classList.add('show-conv');
    convEl.innerHTML = '<div class="empty">Loading…</div>';
    const { user, messages } = await api(`/api/messages/${userId}`);
    convEl.innerHTML = `
      <div class="msg-conv-head">
        <a href="#" id="back" style="display:none">← </a>
        ${avatar(user, 'md')}
        <div>
          <div style="font-weight:700">${escapeHTML(user.name)}</div>
          <div style="color:var(--muted);font-size:12px">${escapeHTML(user.headline || '')}</div>
        </div>
        <div class="spacer" style="flex:1"></div>
        <a class="btn-tiny" href="/profile.html?id=${user.id}">View profile</a>
      </div>
      <div class="msg-conv-body" id="conv-body"></div>
      <form class="msg-form">
        <textarea placeholder="Write a message…" required></textarea>
        <button class="btn-fill" type="submit">Send</button>
      </form>`;
    const body = document.getElementById('conv-body');
    if (!messages.length) {
      body.innerHTML = '<div class="empty">No messages yet — say hi 👋</div>';
    } else {
      body.innerHTML = messages.map(m => {
        const mine = m.from_id === me.id;
        return `<div class="msg-bubble ${mine ? 'from-me' : 'from-them'}">${escapeHTML(m.content)}</div>
                <div class="msg-meta ${mine ? 'from-me' : ''}">${timeAgo(m.created_at)}</div>`;
      }).join('');
      body.scrollTop = body.scrollHeight;
    }
    convEl.querySelector('form').onsubmit = async (ev) => {
      ev.preventDefault();
      const ta = ev.target.querySelector('textarea');
      const v = ta.value.trim();
      if (!v) return;
      await api(`/api/messages/${userId}`, { method: 'POST', body: { content: v } });
      ta.value = '';
      openConv(userId);
      loadThreads();
    };
    loadThreads();
  }

  await loadThreads();
  const initialUser = new URLSearchParams(location.search).get('user');
  if (initialUser) openConv(+initialUser);
})();
