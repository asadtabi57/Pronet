(async function () {
  if (!requireAuth()) return;

  // Parallel: nav, me, posts, people — no reason to await sequentially
  const navP = renderNav('home');
  const meP = api('/api/me').catch(e => { console.error(e); return null; });
  const postsP = api('/api/posts').catch(e => { console.error(e); return { posts: [] }; });
  const peopleP = api('/api/people').catch(e => { console.error(e); return { people: [] }; });

  const meRes = await meP;
  if (!meRes) return;
  const me = meRes.user;
  setMe(me);
  await navP;

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
    // Tone Guardian: gentle pre-send check (no-op if AI is unavailable).
    if (content && window.AI && !(await AI.tonePrecheck(content))) return;
    await api('/api/posts', { method: 'POST', body: {
      content, media_type: url ? mediaType.value : null, media_url: url || null,
    }});
    ta.value = ''; mediaUrl.value = ''; mediaInput.classList.remove('active');
    loadPosts();
  };

  // ✨ Write with AI — opens a modal to enter a topic + tone, then drafts a post.
  const aiWriteBtn = document.getElementById('ai-write-btn');
  if (aiWriteBtn && window.AI) {
    aiWriteBtn.onclick = () => openWriteWithAI(ta.value.trim());
  }

  function openWriteWithAI(prefillTopic) {
    const body = `
      <div class="field">
        <label>What should the post be about?</label>
        <textarea id="wa-topic" rows="3" placeholder="e.g. I just earned my AWS Solutions Architect certification">${escapeHTML(prefillTopic || '')}</textarea>
      </div>
      <div class="field">
        <label>Tone</label>
        <select id="wa-tone">
          <option value="professional">Professional</option>
          <option value="enthusiastic">Enthusiastic</option>
          <option value="storytelling">Storytelling</option>
          <option value="thoughtful">Thoughtful</option>
          <option value="casual">Casual</option>
        </select>
      </div>
      <button type="button" class="btn-fill" id="wa-go" style="width:100%">✨ Generate post</button>
      <div class="wa-result-wrap" id="wa-result" hidden>
        <textarea class="ai-result" id="wa-text"></textarea>
        <div class="wa-actions">
          <button type="button" class="btn-tiny ghost" id="wa-regen">↻ Regenerate</button>
          <span style="flex:1"></span>
          <button type="button" class="btn-fill" id="wa-use">Use this post</button>
        </div>
      </div>`;
    const m = openModal({ title: '✨ Write a post with AI', body });
    const topicEl = m.el.querySelector('#wa-topic');
    const toneEl = m.el.querySelector('#wa-tone');
    const goBtn = m.el.querySelector('#wa-go');
    const resultWrap = m.el.querySelector('#wa-result');
    const textEl = m.el.querySelector('#wa-text');
    topicEl.focus();

    async function generate() {
      const topic = topicEl.value.trim();
      if (!topic) { toast('Tell me what the post should be about.'); topicEl.focus(); return; }
      goBtn.disabled = true; goBtn.textContent = 'Generating…';
      resultWrap.hidden = true;
      try {
        const r = await api('/api/ai/draft-post', { method: 'POST', body: { topic, tone: toneEl.value } });
        textEl.value = r.text || '';
        resultWrap.hidden = false;
        textEl.style.height = 'auto'; textEl.style.height = Math.min(textEl.scrollHeight, 320) + 'px';
      } catch (e) {
        toast(e.message || 'Could not generate a post. Try again.');
      } finally { goBtn.disabled = false; goBtn.textContent = '✨ Generate post'; }
    }
    goBtn.onclick = generate;
    m.el.querySelector('#wa-regen').onclick = generate;
    m.el.querySelector('#wa-use').onclick = () => {
      ta.value = textEl.value.trim();
      m.close();
      ta.focus();
    };
    textEl.addEventListener('input', () => { textEl.style.height = 'auto'; textEl.style.height = Math.min(textEl.scrollHeight, 320) + 'px'; });
  }

  // Network TL;DR digest card (shows only when AI is enabled & there's enough activity).
  (async () => {
    if (!window.AI || !(await AI.feature('feed_summary'))) return;
    try {
      const r = await api('/api/ai/feed-summary');
      if (!r || !r.summary) return;
      const box = document.getElementById('ai-digest');
      if (!box) return;
      box.innerHTML = `<div class="card ai-digest-card">
        <div class="ai-digest-head">${AI.SPARKLE} <span>Your network TL;DR</span><button class="ai-digest-x" aria-label="Dismiss">×</button></div>
        <div class="ai-digest-body">${escapeHTML(r.summary).replace(/\n/g, '<br>')}</div>
      </div>`;
      box.querySelector('.ai-digest-x').onclick = () => { box.innerHTML = ''; };
    } catch (e) {}
  })();

  const postsEl = document.getElementById('posts');

  function renderPosts(posts) {
    if (!posts.length) { postsEl.innerHTML = `<div class="card empty">No posts yet — be the first!</div>`; return; }
    postsEl.innerHTML = posts.map(p => `<article class="card post" id="post-${p.id}" data-id="${p.id}">${renderPostInner(p)}</article>`).join('');
    postsEl.querySelectorAll('.post').forEach(el => {
      const p = posts.find(x => x.id === +el.dataset.id);
      wirePost(el, p, { onChange: loadPosts });
    });
    if (location.hash.startsWith('#post-')) {
      const el = document.getElementById(location.hash.slice(1));
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    }
  }

  async function loadPosts() {
    const { posts } = await api('/api/posts');
    renderPosts(posts);
  }

  function connectBtnHtml(p) {
    if (p.connected)    return `<button class="btn-tiny" disabled>✓ Connected</button>`;
    if (p.pending_out)  return `<button class="btn-tiny" disabled>Pending</button>`;
    if (p.pending_in)   return `<button class="btn-fill accept-btn">Accept</button>`;
    return `<button class="btn-tiny connect-btn">+ Connect</button>`;
  }
  function renderPeople(people) {
    const el = document.getElementById('people-list');
    if (!people.length) { el.innerHTML = '<p class="empty">No suggestions.</p>'; return; }
    el.innerHTML = people.slice(0, 6).map(p => `
      <div class="person" data-id="${p.id}">
        ${avatar(p, 'md')}
        <div class="info">
          <div class="name"><a href="/profile.html?id=${p.id}">${escapeHTML(p.name)}</a></div>
          <div class="headline">${escapeHTML(p.headline || '')}</div>
        </div>
        ${connectBtnHtml(p)}
      </div>`).join('');
    el.querySelectorAll('.person').forEach(node => {
      const cBtn = node.querySelector('.connect-btn');
      if (cBtn) cBtn.onclick = async () => {
        await api(`/api/people/${node.dataset.id}/connect`, { method: 'POST' });
        toast('Request sent'); loadPeople();
      };
      const aBtn = node.querySelector('.accept-btn');
      if (aBtn) aBtn.onclick = async () => {
        await api(`/api/connections/${node.dataset.id}/accept`, { method: 'POST' });
        toast('Connected!'); loadPeople();
      };
    });
  }

  async function loadPeople() {
    const { people } = await api('/api/people');
    renderPeople(people);
  }

  // Use already-in-flight results from parallel fetch
  postsP.then(r => renderPosts(r.posts || []));
  peopleP.then(r => renderPeople(r.people || []));
})();
