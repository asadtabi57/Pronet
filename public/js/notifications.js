(async function () {
  if (!requireAuth()) return;
  await renderNav('notifications');

  const { notifications } = await api('/api/notifications');
  const el = document.getElementById('notif-list');
  if (!notifications.length) { el.innerHTML = '<p class="empty">No notifications yet.</p>'; return; }

  const verb = {
    like: 'liked your post',
    comment: 'commented on your post',
    repost: 'reposted your post',
    share: 'shared your post',
    connect: 'connected with you',
    message: 'sent you a message',
  };
  const link = {
    like: n => `/feed.html#post-${n.payload.post_id}`,
    comment: n => `/feed.html#post-${n.payload.post_id}`,
    repost: n => `/feed.html#post-${n.payload.post_id}`,
    share: n => `/feed.html#post-${n.payload.post_id}`,
    connect: n => `/profile.html?id=${n.actor_id}`,
    message: n => `/messages.html?user=${n.actor_id}`,
  };

  el.innerHTML = notifications.map(n => {
    const a = n.actor || { name: 'Someone', avatar_color: '#888' };
    const href = (link[n.type] || (() => '#'))(n);
    return `
      <a class="notif ${n.read ? '' : 'unread'}" href="${href}">
        ${avatar(a, 'md')}
        <div class="body">
          <div class="text"><b>${escapeHTML(a.name)}</b> ${verb[n.type] || n.type}</div>
          <div class="time">${timeAgo(n.created_at)}</div>
        </div>
      </a>`;
  }).join('');

  await api('/api/notifications/read', { method: 'POST' });
})();
