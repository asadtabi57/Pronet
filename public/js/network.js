(async function () {
  if (!requireAuth()) return;
  await renderNav('network');

  function personCard(p, actionsHtml) {
    return `
      <article class="person-card" data-id="${p.id}">
        <div class="pc-cover" style="${p.cover_color ? `background: linear-gradient(135deg, ${p.cover_color}, #c7d8ff)` : ''}"></div>
        <div class="pc-body">
          <a href="/profile.html?id=${p.id}" class="pc-avatar">${avatar(p, 'md')}</a>
          <div class="pc-name"><a href="/profile.html?id=${p.id}">${escapeHTML(p.name)}</a></div>
          <div class="pc-headline">${escapeHTML(p.headline || 'Member on Pronet')}</div>
          ${p.location ? `<div class="pc-loc">📍 ${escapeHTML(p.location)}</div>` : ''}
          <div class="pc-actions">${actionsHtml}</div>
        </div>
      </article>`;
  }

  async function loadConnections() {
    const { connections } = await api('/api/connections');
    document.getElementById('conn-count').textContent = connections.length;
    const el = document.getElementById('connections');
    if (!connections.length) {
      el.innerHTML = '<p class="empty">No connections yet. Start connecting below!</p>';
      return;
    }
    el.innerHTML = `<div class="person-grid">${connections.map(p => personCard(p, `
      <a class="btn-fill" href="/messages.html?user=${p.id}">Message</a>
      <button class="btn-tiny ghost remove-btn">Remove</button>
    `)).join('')}</div>`;
    el.querySelectorAll('.person-card').forEach(node => {
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
    if (!unconnected.length) {
      el.innerHTML = '<p class="empty">No more suggestions for now.</p>';
      return;
    }
    el.innerHTML = `<div class="person-grid">${unconnected.map(p => personCard(p, `
      <button class="btn-fill connect-btn">+ Connect</button>
    `)).join('')}</div>`;
    el.querySelectorAll('.person-card').forEach(node => {
      node.querySelector('.connect-btn').onclick = async () => {
        await api(`/api/people/${node.dataset.id}/connect`, { method: 'POST' });
        toast('Connected!'); loadConnections(); loadSuggestions();
      };
    });
  }

  loadConnections(); loadSuggestions();
})();
