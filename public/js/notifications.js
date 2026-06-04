(async function () {
  if (!requireAuth()) return;
  await renderNav('notifications');

  const el = document.getElementById('notif-list');

  const verb = {
    like: 'liked your post',
    comment: 'commented on your post',
    repost: 'reposted your post',
    share: 'shared your post',
    connect: 'connected with you',
    connection_request: 'wants to connect with you',
    connect_accepted: 'accepted your connection request',
    new_post: 'shared a new post',
    message: 'sent you a message',
    profile_view: 'viewed your profile',
    profile_view_anon: 'viewed your profile',
  };
  const link = {
    like: n => `/feed.html#post-${n.payload.post_id}`,
    comment: n => `/feed.html#post-${n.payload.post_id}`,
    repost: n => `/feed.html#post-${n.payload.post_id}`,
    share: n => `/feed.html#post-${n.payload.post_id}`,
    new_post: n => `/feed.html#post-${n.payload.post_id}`,
    connect: n => `/profile.html?id=${n.actor_id}`,
    connection_request: n => `/profile.html?id=${n.actor_id}`,
    connect_accepted: n => `/profile.html?id=${n.actor_id}`,
    message: n => `/messages.html?user=${n.actor_id}`,
    profile_view: n => `/profile.html?id=${n.actor_id}`,
  };

  async function render() {
    const { notifications } = await api('/api/notifications');
    if (!notifications.length) { el.innerHTML = '<p class="empty">No notifications yet.</p>'; return; }

    el.innerHTML = notifications.map(n => {
      const a = n.actor || { name: 'Someone', avatar_color: '#888' };
      const href = (link[n.type] || (() => '#'))(n);
      const isReq = n.type === 'connection_request';
      const stillPending = isReq && a.pending_in === true; // they sent → I'm recipient
      const actions = stillPending ? `
        <div class="notif-actions" data-actor="${n.actor_id}">
          <button class="btn-fill accept-btn">Accept</button>
          <button class="btn-tiny ghost decline-btn">Ignore</button>
        </div>` : '';
      return `
        <div class="notif ${n.read ? '' : 'unread'} ${isReq ? 'notif-request' : ''}">
          <a class="notif-main" href="${href}">
            ${avatar(a, 'md')}
            <div class="body">
              <div class="text"><b>${escapeHTML(a.name)}</b> ${verb[n.type] || n.type}</div>
              <div class="time">${timeAgo(n.created_at)}</div>
            </div>
          </a>
          ${actions}
        </div>`;
    }).join('');

    el.querySelectorAll('.notif-actions').forEach(box => {
      const id = box.dataset.actor;
      box.querySelector('.accept-btn').onclick = async (e) => {
        e.preventDefault();
        await api(`/api/connections/${id}/accept`, { method: 'POST' });
        toast('Connected!'); render();
      };
      box.querySelector('.decline-btn').onclick = async (e) => {
        e.preventDefault();
        await api(`/api/connections/${id}/decline`, { method: 'POST' });
        render();
      };
    });

    await api('/api/notifications/read', { method: 'POST' });
  }

  // Live updates: re-render when a new notification arrives in real time.
  let rtTimer = null;
  RT.on('notification', () => {
    clearTimeout(rtTimer);
    rtTimer = setTimeout(render, 300);
  });

  render();
})();
