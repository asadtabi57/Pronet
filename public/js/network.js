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
        if (!(await confirmDialog({ title: 'Remove connection?', message: 'They will be removed from your connections.', confirmText: 'Remove' }))) return;
        await api(`/api/people/${node.dataset.id}/disconnect`, { method: 'POST' });
        loadConnections(); loadSuggestions();
      };
    });
  }

  async function loadRequests() {
    const { requests } = await api('/api/connections/requests');
    const el = document.getElementById('requests');
    const head = document.getElementById('requests-head');
    if (!requests.length) {
      el.innerHTML = '';
      if (head) head.style.display = 'none';
      return;
    }
    if (head) {
      head.style.display = '';
      head.querySelector('span').textContent = requests.length;
    }
    el.innerHTML = `<div class="person-grid">${requests.map(p => personCard(p, `
      <button class="btn-fill accept-btn">Accept</button>
      <button class="btn-tiny ghost decline-btn">Ignore</button>
    `)).join('')}</div>`;
    el.querySelectorAll('.person-card').forEach(node => {
      node.querySelector('.accept-btn').onclick = async () => {
        await api(`/api/connections/${node.dataset.id}/accept`, { method: 'POST' });
        toast('Connected!'); loadRequests(); loadConnections(); loadSuggestions();
      };
      node.querySelector('.decline-btn').onclick = async () => {
        await api(`/api/connections/${node.dataset.id}/decline`, { method: 'POST' });
        loadRequests();
      };
    });
  }

  async function loadSuggestions() {
    const { people } = await api('/api/people');
    const el = document.getElementById('suggestions');
    const unconnected = people.filter(p => !p.connected && !p.pending_in);
    if (!unconnected.length) {
      el.innerHTML = '<p class="empty">No more suggestions for now.</p>';
      return;
    }
    el.innerHTML = `<div class="person-grid">${unconnected.map(p => personCard(p,
      p.pending_out
        ? `<button class="btn-tiny ghost" disabled>Pending</button>`
        : `<button class="btn-fill connect-btn">+ Connect</button>`
    )).join('')}</div>`;
    el.querySelectorAll('.person-card .connect-btn').forEach(btn => {
      btn.onclick = async () => {
        const card = btn.closest('.person-card');
        await api(`/api/people/${card.dataset.id}/connect`, { method: 'POST' });
        toast('Request sent'); loadSuggestions();
      };
    });
  }

  async function loadSmartMatches() {
    const el = document.getElementById('smart-matches');
    const head = document.getElementById('smart-head');
    if (!el) return;
    try {
      const { matches } = await api('/api/network/smart-matches');
      const list = (matches || []).filter(p => !p.connected && !p.pending_in && !p.pending_out);
      if (!list.length) { el.innerHTML = ''; if (head) head.style.display = 'none'; return; }
      if (head) head.style.display = '';
      el.innerHTML = `<div class="person-grid">${list.map(p => personCard({ ...p },
        `<span class="match-badge" title="Profile similarity">✨ ${p.match_score}% match</span>` +
        (p.pending_out
          ? `<button class="btn-tiny ghost" disabled>Pending</button>`
          : `<button class="btn-fill connect-btn">+ Connect</button>`)
      )).join('')}</div>`;
      el.querySelectorAll('.person-card .connect-btn').forEach(btn => {
        btn.onclick = async () => {
          const card = btn.closest('.person-card');
          await api(`/api/people/${card.dataset.id}/connect`, { method: 'POST' });
          toast('Request sent'); loadSmartMatches();
        };
      });
    } catch (e) { if (head) head.style.display = 'none'; }
  }

  loadRequests(); loadConnections(); loadSuggestions(); loadSmartMatches();
})();
