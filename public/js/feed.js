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
  const mediaFile = document.getElementById('media-file');
  const mediaPreview = document.getElementById('media-preview');
  document.getElementById('toggle-media').onclick = () => mediaInput.classList.toggle('active');

  // Uploaded media (small files → Supabase storage). Holds {url, type} once a file
  // is uploaded; takes priority over a pasted URL when posting.
  const IMG_MAX = 1 * 1024 * 1024;   // 1 MB
  const VID_MAX = 5 * 1024 * 1024;   // 5 MB
  let uploaded = null;

  function clearUpload() {
    uploaded = null;
    mediaFile.value = '';
    mediaPreview.hidden = true;
    mediaPreview.innerHTML = '';
  }
  function showPreview(up) {
    mediaPreview.hidden = false;
    const media = up.type === 'video'
      ? `<video src="${escapeHTML(up.url)}" controls preload="metadata"></video>`
      : `<img src="${escapeHTML(up.url)}" alt=""/>`;
    mediaPreview.innerHTML = `${media}<button type="button" class="media-preview-x" aria-label="Remove">×</button>`;
    mediaPreview.querySelector('.media-preview-x').onclick = clearUpload;
  }

  mediaFile.onchange = async () => {
    const file = mediaFile.files && mediaFile.files[0];
    if (!file) return;
    const kind = fileKind(file);
    if (!kind) { toast('Only image or video files are allowed'); mediaFile.value = ''; return; }

    if (kind === 'video') {
      if (file.size > VID_MAX) { toast('Video too large (max 5 MB)'); mediaFile.value = ''; return; }
      await doUpload(file, 'video', file.name || 'video');
      return;
    }

    // Image: downscale + re-encode to JPEG in the browser. This shrinks big phone
    // photos to a few hundred KB and converts iPhone HEIC to JPEG (WebKit decodes
    // HEIC natively). If the browser can't decode it, fall back to raw upload and
    // let the server convert (server-side HEIC→JPEG).
    mediaPreview.hidden = false;
    mediaPreview.innerHTML = '<span class="media-uploading">Processing…</span>';
    let blob = null;
    try { blob = await processImage(file); } catch (e) { blob = null; }
    if (blob) {
      await doUpload(blob, 'image', 'photo.jpg');
    } else {
      if (file.size > VID_MAX) { toast('Image too large'); clearUpload(); return; }
      await doUpload(file, 'image', file.name || 'photo');
    }
  };

  async function doUpload(fileOrBlob, kind, name) {
    const fd = new FormData();
    fd.append('file', fileOrBlob, name || 'upload');
    mediaPreview.hidden = false;
    mediaPreview.innerHTML = '<span class="media-uploading">Uploading…</span>';
    try {
      const r = await api('/api/posts/media', { method: 'POST', body: fd });
      if (!r || !r.url) throw new Error('Upload failed');
      uploaded = { url: r.url, type: r.media_type || kind };
      mediaUrl.value = '';
      showPreview(uploaded);
    } catch (e) {
      clearUpload();
      toast((e && e.message) || 'Upload failed');
    }
  }

  function fileKind(file) {
    const t = String(file.type || '').toLowerCase();
    if (t.startsWith('video/')) return 'video';
    if (t.startsWith('image/')) return 'image';
    const n = String(file.name || '').toLowerCase();
    if (/\.(mp4|webm|ogv|mov|m4v)$/.test(n)) return 'video';
    if (/\.(png|jpe?g|gif|webp|heic|heif|bmp)$/.test(n)) return 'image';
    return '';
  }

  // Decode → draw to a canvas (max 1600px) → JPEG blob ≤ 1 MB. Returns null if the
  // image can't be decoded by this browser (e.g. HEIC on a non-Apple engine).
  async function processImage(file) {
    let drawable = null, width = 0, height = 0, cleanup = null;
    try {
      if (window.createImageBitmap) {
        const bmp = await createImageBitmap(file);
        drawable = bmp; width = bmp.width; height = bmp.height;
        cleanup = () => { try { bmp.close && bmp.close(); } catch (e) {} };
      }
    } catch (e) { drawable = null; }
    if (!drawable) {
      const url = URL.createObjectURL(file);
      try {
        const img = await new Promise((res, rej) => {
          const im = new Image();
          im.onload = () => res(im);
          im.onerror = () => rej(new Error('decode'));
          im.src = url;
        });
        drawable = img; width = img.naturalWidth; height = img.naturalHeight;
        cleanup = () => URL.revokeObjectURL(url);
      } catch (e) { URL.revokeObjectURL(url); return null; }
    }
    if (!width || !height) { if (cleanup) cleanup(); return null; }

    const MAXD = 1600;
    let scale = Math.min(1, MAXD / Math.max(width, height));
    let w = Math.max(1, Math.round(width * scale));
    let h = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const draw = () => { canvas.width = w; canvas.height = h; ctx.drawImage(drawable, 0, 0, w, h); };
    draw();

    let quality = 0.85;
    let blob = null;
    for (let i = 0; i < 7; i++) {
      blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
      if (!blob) break;
      if (blob.size <= IMG_MAX) break;
      if (quality > 0.5) { quality -= 0.15; }
      else { w = Math.round(w * 0.85); h = Math.round(h * 0.85); draw(); }
    }
    if (cleanup) cleanup();
    return blob || null;
  }

  document.getElementById('post-btn').onclick = async () => {
    const content = ta.value.trim();
    const url = mediaUrl.value.trim();
    const media_url = uploaded ? uploaded.url : (url || null);
    const media_type = uploaded ? uploaded.type : (url ? mediaType.value : null);
    if (!content && !media_url) { toast('Write something or add media'); return; }
    // Tone Guardian: gentle pre-send check (no-op if AI is unavailable).
    if (content && window.AI && !(await AI.tonePrecheck(content))) return;
    await api('/api/posts', { method: 'POST', body: { content, media_type, media_url } });
    ta.value = ''; mediaUrl.value = ''; mediaInput.classList.remove('active');
    clearUpload();
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

  // Network Highlights card — short AI highlights of important posts, each tied
  // to its author; clicking one jumps to that post in the feed.
  (async () => {
    if (!window.AI || !(await AI.feature('feed_summary'))) return;
    try {
      const r = await api('/api/ai/feed-summary');
      const highlights = (r && Array.isArray(r.highlights)) ? r.highlights : [];
      if (!highlights.length) return;
      const box = document.getElementById('ai-digest');
      if (!box) return;
      box.innerHTML = `<div class="card ai-digest-card">
        <div class="ai-digest-head">${AI.SPARKLE} <span>Highlights</span><button class="ai-digest-x" aria-label="Dismiss">×</button></div>
        <div class="ai-hl-list">
          ${highlights.map(h => `
            <button class="ai-hl" data-post="${h.post_id}">
              ${avatar({ id: h.author.id, name: h.author.name, avatar_color: h.author.avatar_color, avatar_url: h.author.avatar_url }, 'sm')}
              <span class="ai-hl-body">
                <span class="ai-hl-name">${escapeHTML(h.author.name || '')}</span>
                <span class="ai-hl-text">${escapeHTML(h.text)}</span>
              </span>
            </button>`).join('')}
        </div>
      </div>`;
      box.querySelector('.ai-digest-x').onclick = () => { box.innerHTML = ''; };
      box.querySelectorAll('.ai-hl').forEach(btn => {
        btn.addEventListener('click', () => goToPost(+btn.dataset.post));
      });
    } catch (e) {}
  })();

  // Scroll to a post in the feed and flash it. If it isn't loaded yet, retry a few
  // times as the feed fills in.
  function goToPost(id, tries = 0) {
    const el = document.getElementById('post-' + id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.remove('post-flash');
      void el.offsetWidth;
      el.classList.add('post-flash');
      setTimeout(() => el.classList.remove('post-flash'), 1800);
      return;
    }
    if (tries < 8) setTimeout(() => goToPost(id, tries + 1), 250);
  }

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
