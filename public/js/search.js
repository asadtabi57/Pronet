(async function () {
  if (!requireAuth()) return;
  await renderNav('');

  const q = new URLSearchParams(location.search).get('q') || '';
  const root = document.getElementById('results');
  if (!q.trim()) { root.innerHTML = '<div class="card empty">Search for people and posts — use the search bar, or the 🔍 button up top on mobile.</div>'; return; }

  const { people, posts, semantic_people } = await api('/api/search?q=' + encodeURIComponent(q));
  document.getElementById('global-search').value = q;

  // Semantic matches the keyword pass missed (AI/vector-powered).
  const sem = (semantic_people || []);
  const semHTML = sem.length ? `
    <div class="section">
      <h3 class="ai-section-title">✨ Related people <span class="ai-subtle">semantic matches</span></h3>
      <div class="card card-pad" id="sem-list"></div>
    </div>` : '';

  root.innerHTML = `
    <h2 class="section-title">Search results for "${escapeHTML(q)}"</h2>
    <div class="section">
      <h3>People (${people.length})</h3>
      <div class="card card-pad" id="ppl-list">
        ${people.length ? '' : '<p class="empty">No people matched.</p>'}
      </div>
    </div>
    ${semHTML}
    <div class="section">
      <h3>Posts (${posts.length})</h3>
      <div id="post-list">
        ${posts.length ? '' : '<div class="card empty">No posts matched.</div>'}
      </div>
    </div>`;

  function personRow(p, opts = {}) {
    let btn;
    if (p.connected)        btn = '<button class="btn-tiny" disabled>✓ Connected</button>';
    else if (p.pending_out) btn = '<button class="btn-tiny" disabled>Pending</button>';
    else if (p.pending_in)  btn = '<button class="btn-fill accept-btn">Accept</button>';
    else                    btn = '<button class="btn-fill connect-btn">+ Connect</button>';
    const badge = opts.score != null ? `<span class="match-badge" title="Similarity">✨ ${opts.score}%</span>` : '';
    return `
      <div class="person" data-id="${p.id}">
        ${avatar(p, 'md')}
        <div class="info">
          <div class="name"><a href="/profile.html?id=${p.id}">${escapeHTML(p.name)}</a> ${badge}</div>
          <div class="headline">${escapeHTML(p.headline || '')}</div>
          <div class="headline">${escapeHTML(p.location || '')}</div>
        </div>
        ${btn}
        <a class="btn-tiny" href="/profile.html?id=${p.id}">View</a>
      </div>`;
  }
  function wirePeople(container) {
    container.querySelectorAll('.connect-btn').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.closest('.person').dataset.id;
        await api(`/api/people/${id}/connect`, { method: 'POST' });
        btn.outerHTML = '<button class="btn-tiny" disabled>Pending</button>';
        toast('Request sent');
      };
    });
    container.querySelectorAll('.accept-btn').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.closest('.person').dataset.id;
        await api(`/api/connections/${id}/accept`, { method: 'POST' });
        btn.outerHTML = '<button class="btn-tiny" disabled>✓ Connected</button>';
        toast('Connected!');
      };
    });
  }

  if (people.length) {
    const el = document.getElementById('ppl-list');
    el.innerHTML = people.map(p => personRow(p)).join('');
    wirePeople(el);
  }
  if (sem.length) {
    const el = document.getElementById('sem-list');
    el.innerHTML = sem.map(p => personRow(p, { score: p.match_score })).join('');
    wirePeople(el);
  }

  if (posts.length) {
    const el = document.getElementById('post-list');
    el.innerHTML = posts.map(p => `<article class="card post" data-id="${p.id}">${renderPostInner(p)}</article>`).join('');
    el.querySelectorAll('.post').forEach(node => {
      const p = posts.find(x => x.id === +node.dataset.id);
      wirePost(node, p, { onChange: () => location.reload() });
    });
  }
})();
