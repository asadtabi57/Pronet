(async function () {
  if (!requireAuth()) return;
  await renderNav('home');

  let me;
  try { me = (await api('/api/me')).user; setMe(me); }
  catch { return; }

  document.getElementById('me-card').innerHTML = `
    <div class="cover" style="background:${me.cover_color || '#a0c4ff'}"></div>
    <div class="avatar-wrap">${avatar(me, 'lg')}</div>
    <h3><a href="/profile.html?id=${me.id}">${escapeHTML(me.name)}</a></h3>
    <p>${escapeHTML(me.headline || 'Add a headline')}</p>
    <div class="stats">Connections <b>${me.connection_count}</b></div>
  `;
  document.getElementById('composer-avatar').innerHTML = avatar(me, 'md');

  // Composer
  const ta = document.getElementById('post-content');
  const mediaInput = document.getElementById('media-input');
  const mediaType = document.getElementById('media-type');
  const mediaUrl = document.getElementById('media-url');
  document.getElementById('toggle-media').onclick = () => mediaInput.classList.toggle('active');
  document.getElementById('post-btn').onclick = async () => {
    const content = ta.value.trim();
    const url = mediaUrl.value.trim();
    if (!content && !url) { toast('Write something or add media'); return; }
    await api('/api/posts', { method: 'POST', body: {
      content, media_type: url ? mediaType.value : null, media_url: url || null,
    }});
    ta.value = ''; mediaUrl.value = ''; mediaInput.classList.remove('active');
    loadPosts();
  };

  const postsEl = document.getElementById('posts');

  async function loadPosts() {
    const { posts } = await api('/api/posts');
    if (!posts.length) { postsEl.innerHTML = `<div class="card empty">No posts yet — be the first!</div>`; return; }
    postsEl.innerHTML = posts.map(p => `<article class="card post" id="post-${p.id}" data-id="${p.id}">${renderPostInner(p)}</article>`).join('');
    postsEl.querySelectorAll('.post').forEach(el => {
      const p = posts.find(x => x.id === +el.dataset.id);
      wirePost(el, p, { onChange: loadPosts });
    });
    // anchor scroll if hash present
    if (location.hash.startsWith('#post-')) {
      const el = document.getElementById(location.hash.slice(1));
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    }
  }

  async function loadPeople() {
    const { people } = await api('/api/people');
    const el = document.getElementById('people-list');
    if (!people.length) { el.innerHTML = '<p class="empty">No suggestions.</p>'; return; }
    el.innerHTML = people.slice(0, 6).map(p => `
      <div class="person" data-id="${p.id}">
        ${avatar(p, 'md')}
        <div class="info">
          <div class="name"><a href="/profile.html?id=${p.id}">${escapeHTML(p.name)}</a></div>
          <div class="headline">${escapeHTML(p.headline || '')}</div>
        </div>
        <button class="btn-tiny" ${p.connected ? 'disabled' : ''}>${p.connected ? '✓ Connected' : '+ Connect'}</button>
      </div>`).join('');
    el.querySelectorAll('.person').forEach(node => {
      const btn = node.querySelector('button');
      if (btn.disabled) return;
      btn.onclick = async () => { await api(`/api/people/${node.dataset.id}/connect`, { method: 'POST' }); loadPeople(); };
    });
  }

  loadPosts(); loadPeople();
})();
