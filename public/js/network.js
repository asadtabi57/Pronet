(async function () {
  if (!requireAuth()) return;
  await renderNav('network');

  async function loadConnections() {
    const { connections } = await api('/api/connections');
    document.getElementById('conn-count').textContent = connections.length;
    const el = document.getElementById('connections');
    if (!connections.length) { el.innerHTML = '<p class="empty">No connections yet. Start connecting below!</p>'; return; }
    el.innerHTML = connections.map(p => `
      <div class="person" data-id="${p.id}">
        ${avatar(p, 'md')}
        <div class="info">
          <div class="name"><a href="/profile.html?id=${p.id}">${escapeHTML(p.name)}</a></div>
          <div class="headline">${escapeHTML(p.headline || '')}</div>
        </div>
        <a class="btn-tiny" href="/messages.html?user=${p.id}">💬 Message</a>
        <button class="btn-tiny ghost remove-btn">Remove</button>
      </div>`).join('');
    el.querySelectorAll('.person').forEach(node => {
      node.querySelector('.remove-btn').onclick = async () => {
        if (!confirm('Remove this connection?')) return;
        await api(`/api/people/${node.dataset.id}/disconnect`, { method: 'POST' });
        loadConnections(); loadSuggestions();
      };
    });
  }

  async function loadSuggestions() {
    const { people } = await api('/api/people');
    const el = document.getElementById('suggestions');
    const unconnected = people.filter(p => !p.connected);
    if (!unconnected.length) { el.innerHTML = '<p class="empty">No more suggestions for now.</p>'; return; }
    el.innerHTML = unconnected.map(p => `
      <div class="person" data-id="${p.id}">
        ${avatar(p, 'md')}
        <div class="info">
          <div class="name"><a href="/profile.html?id=${p.id}">${escapeHTML(p.name)}</a></div>
          <div class="headline">${escapeHTML(p.headline || '')}</div>
          <div class="headline">${escapeHTML(p.location || '')}</div>
        </div>
        <button class="btn-fill connect-btn">+ Connect</button>
      </div>`).join('');
    el.querySelectorAll('.person').forEach(node => {
      node.querySelector('.connect-btn').onclick = async () => {
        await api(`/api/people/${node.dataset.id}/connect`, { method: 'POST' });
        toast('Connected!'); loadConnections(); loadSuggestions();
      };
    });
  }

  loadConnections(); loadSuggestions();
})();
