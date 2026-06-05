(async function () {
  if (!requireAuth()) return;
  const me = getMe();
  const id = +(new URLSearchParams(location.search).get('id') || me.id);
  await renderNav(id === me.id ? 'me' : '');

  const root = document.getElementById('profile-root');
  let data;
  try { data = (await api(`/api/users/${id}`)).user; }
  catch (e) { root.innerHTML = `<div class="card empty">${escapeHTML(e.message)}</div>`; return; }

  const isMe = data.id === me.id;
  function profileBtnLabel(d) {
    if (d.connected)   return '✓ Connected';
    if (d.pending_out) return 'Pending';
    if (d.pending_in)  return 'Accept request';
    return '+ Connect';
  }
  const actions = isMe
    ? `<button class="btn-tiny" id="edit-btn">✎ Edit profile</button>
       <button class="ai-btn ai-btn-tiny" id="career-btn" title="AI Career Coach">✨ <span>Career coach</span></button>`
    : `<button class="btn-fill" id="connect-btn">${profileBtnLabel(data)}</button>
       <button class="btn-tiny" id="message-btn">💬 Message</button>
       <button class="ai-btn ai-btn-tiny" id="intro-btn" title="Draft a connection note with AI">✨ <span>Draft intro</span></button>`;

  root.innerHTML = `
    <article class="card profile-hero">
      <div class="cover" style="background:${data.cover_color}"></div>
      <div class="avatar-row">${avatar(data, 'xl')}</div>
      <div class="profile-body">
        <div class="actions">${actions}</div>
        <h1>${escapeHTML(data.name)}${data.subscription ? '<span class="premium-badge">PREMIUM</span>' : ''}</h1>
        <p class="profile-headline">${escapeHTML(data.headline || '')}</p>
        <p class="profile-loc">${escapeHTML(data.location || '')} · ${data.connection_count} connections</p>
      </div>
      ${data.about ? `
        <div class="profile-section">
          <h2>About</h2>
          <p class="about-text">${escapeHTML(data.about)}</p>
        </div>` : ''}
      ${data.experience && data.experience.length ? `
        <div class="profile-section">
          <h2>Experience</h2>
          ${data.experience.map(e => `
            <div class="exp-item">
              <div class="logo">🏢</div>
              <div class="body">
                <div class="title">${escapeHTML(e.title)}</div>
                <div class="company">${escapeHTML(e.company)}</div>
                <div class="date">${escapeHTML(e.from || '')} – ${escapeHTML(e.to || '')}</div>
                ${e.description ? `<div class="desc">${escapeHTML(e.description)}</div>` : ''}
              </div>
            </div>`).join('')}
        </div>` : ''}
      ${data.education && data.education.length ? `
        <div class="profile-section">
          <h2>Education</h2>
          ${data.education.map(e => `
            <div class="exp-item">
              <div class="logo">🎓</div>
              <div class="body">
                <div class="title">${escapeHTML(e.school)}</div>
                <div class="company">${escapeHTML(e.degree || '')}</div>
                <div class="date">${escapeHTML(e.from || '')} – ${escapeHTML(e.to || '')}</div>
              </div>
            </div>`).join('')}
        </div>` : ''}
      ${data.skills && data.skills.length ? `
        <div class="profile-section">
          <h2>Skills</h2>
          <div class="skills-list">
            ${data.skills.map(s => `<span class="skill-chip">${escapeHTML(s)}</span>`).join('')}
          </div>
        </div>` : ''}
    </article>

    <h2 class="section-title" style="margin-top:24px">Activity</h2>
    <div id="posts">${data.posts.length ? '' : '<div class="card empty">No activity yet.</div>'}</div>
  `;

  const postsEl = document.getElementById('posts');
  if (data.posts.length) {
    postsEl.innerHTML = data.posts.map(p => `<article class="card post" data-id="${p.id}">${renderPostInner(p)}</article>`).join('');
    postsEl.querySelectorAll('.post').forEach(el => {
      const p = data.posts.find(x => x.id === +el.dataset.id);
      wirePost(el, p, { onChange: () => location.reload() });
    });
  }

  if (!isMe) {
    document.getElementById('connect-btn').onclick = async (ev) => {
      if (data.connected) {
        if (!(await confirmDialog({ title: 'Remove connection?', message: 'They will be removed from your connections.', confirmText: 'Remove' }))) return;
        await api(`/api/people/${data.id}/disconnect`, { method: 'POST' });
        data.connected = false; data.pending_out = false; data.pending_in = false;
      } else if (data.pending_in) {
        await api(`/api/connections/${data.id}/accept`, { method: 'POST' });
        data.connected = true; data.pending_in = false;
        toast('Connected!');
      } else if (data.pending_out) {
        return; // already pending — no-op
      } else {
        await api(`/api/people/${data.id}/connect`, { method: 'POST' });
        data.pending_out = true;
        toast('Request sent');
      }
      ev.target.textContent = profileBtnLabel(data);
      if (data.pending_out) ev.target.disabled = true;
    };
    if (data.pending_out) document.getElementById('connect-btn').disabled = true;
    document.getElementById('message-btn').onclick = () => location.href = `/messages.html?user=${data.id}`;

    // ✨ Draft intro — generate a warm connection note and carry it into the chat.
    const introBtn = document.getElementById('intro-btn');
    if (introBtn && window.AI) {
      introBtn.onclick = () => AI.assistant({
        title: `Draft an intro to ${data.name}`,
        insertLabel: '💬 Use in message',
        run: async () => (await api('/api/ai/draft-intro', { method: 'POST', body: { targetUserId: data.id } })).text,
        onInsert: (text) => {
          try { sessionStorage.setItem('pronet_msg_draft', JSON.stringify({ userId: data.id, text })); } catch (e) {}
          location.href = `/messages.html?user=${data.id}`;
        },
      });
    }
  } else {
    document.getElementById('edit-btn').onclick = () => openEditModal(data);
    // ✨ AI Career Coach — gap analysis toward a target role.
    const careerBtn = document.getElementById('career-btn');
    if (careerBtn && window.AI) {
      careerBtn.onclick = () => openCareerCoach();
    }
  }

  function openEditModal(u) {
    const avatarPreview = u.avatar_url
      ? `<div class="preview"><img src="${escapeHTML(u.avatar_url)}"/></div>`
      : `<div class="preview" style="background:${u.avatar_color}">${initials(u.name)}</div>`;
    const body = `
      <div class="avatar-uploader">
        <div id="ed-avatar-preview">${avatarPreview}</div>
        <div class="controls">
          <input type="file" id="ed-avatar-file" accept="image/png,image/jpeg,image/gif,image/webp" style="font-size:13px"/>
          <div style="display:flex;gap:6px">
            <button type="button" class="btn-tiny" id="ed-avatar-upload">Upload from device</button>
            ${u.avatar_url ? '<button type="button" class="btn-tiny ghost" id="ed-avatar-remove">Remove photo</button>' : ''}
          </div>
          <p style="margin:0;font-size:11px;color:var(--muted)">PNG/JPG/GIF/WebP up to 4 MB</p>
        </div>
      </div>
      <div class="field"><label>Name</label><input id="ed-name" value="${escapeHTML(u.name)}"/></div>
      <div class="field"><label class="ai-field-label">Headline <button type="button" class="ai-btn ai-btn-tiny ai-enhance" data-field="headline" title="Enhance with AI">✨</button></label><input id="ed-headline" value="${escapeHTML(u.headline || '')}"/></div>
      <div class="field"><label>Location</label><input id="ed-location" value="${escapeHTML(u.location || '')}"/></div>
      <div class="field"><label class="ai-field-label">About <button type="button" class="ai-btn ai-btn-tiny ai-enhance" data-field="about" title="Enhance with AI">✨</button></label><textarea id="ed-about" rows="5">${escapeHTML(u.about || '')}</textarea></div>
      <div class="field"><label>Skills (comma-separated)</label><input id="ed-skills" value="${escapeHTML((u.skills || []).join(', '))}"/></div>`;
    const footer = `<button class="btn-fill" id="save-profile">Save</button>`;
    const m = openModal({ title: 'Edit profile', body, footer });

    // ✨ Enhance headline/about with AI (always shown; guided message if AI off).
    m.el.querySelectorAll('.ai-enhance').forEach(btn => {
      if (!window.AI) { btn.style.display = 'none'; return; }
      btn.onclick = () => {
        const field = btn.dataset.field;
        const input = m.el.querySelector(field === 'headline' ? '#ed-headline' : '#ed-about');
        const notes = (input.value || '').trim();
        if (!notes) { toast('Type a few words first, then enhance.'); input.focus(); return; }
        AI.assistant({
          title: field === 'headline' ? 'Enhance headline' : 'Enhance About',
          insertLabel: 'Replace',
          run: async () => (await api('/api/ai/enhance-profile', { method: 'POST', body: { field, notes } })).text,
          onInsert: (text) => { input.value = text; input.focus(); },
        });
      };
    });

    const fileInput = m.el.querySelector('#ed-avatar-file');
    const previewBox = m.el.querySelector('#ed-avatar-preview');
    m.el.querySelector('#ed-avatar-upload').onclick = () => fileInput.click();
    fileInput.onchange = async () => {
      const f = fileInput.files[0];
      if (!f) return;
      if (f.size > 4 * 1024 * 1024) { toast('Image must be under 4 MB'); return; }
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const r = await api('/api/me/avatar', { method: 'POST', body: { data_url: reader.result } });
          setMe(r.user);
          previewBox.innerHTML = `<div class="preview"><img src="${escapeHTML(r.user.avatar_url)}"/></div>`;
          toast('Profile photo updated');
        } catch (e) { toast(e.message); }
      };
      reader.readAsDataURL(f);
    };
    const removeBtn = m.el.querySelector('#ed-avatar-remove');
    if (removeBtn) removeBtn.onclick = async () => {
      const r = await api('/api/me/avatar', { method: 'DELETE' });
      setMe(r.user);
      previewBox.innerHTML = `<div class="preview" style="background:${r.user.avatar_color}">${initials(r.user.name)}</div>`;
      removeBtn.remove();
      toast('Photo removed');
    };

    m.el.querySelector('#save-profile').onclick = async () => {
      const updates = {
        name: m.el.querySelector('#ed-name').value.trim(),
        headline: m.el.querySelector('#ed-headline').value.trim(),
        location: m.el.querySelector('#ed-location').value.trim(),
        about: m.el.querySelector('#ed-about').value,
        skills: m.el.querySelector('#ed-skills').value.split(',').map(s => s.trim()).filter(Boolean),
      };
      const r = await api('/api/me', { method: 'PUT', body: updates });
      setMe(r.user); m.close(); location.reload();
    };
  }

  // ✨ AI Career Coach — enter a target role, get a data-driven gap analysis.
  function openCareerCoach() {
    const body = `
      <p class="ai-coach-intro">Tell me the role you're aiming for and I'll compare your profile to people already in that role.</p>
      <div class="field"><label>Target role</label>
        <input id="cc-role" placeholder="e.g. Senior Frontend Engineer" />
      </div>
      <button type="button" class="btn-fill" id="cc-go" style="width:100%">Analyze my path</button>
      <div id="cc-out" class="ai-coach-out" hidden></div>`;
    const m = openModal({ title: '✨ AI Career Coach', body });
    const roleInput = m.el.querySelector('#cc-role');
    const out = m.el.querySelector('#cc-out');
    const go = m.el.querySelector('#cc-go');
    roleInput.focus();
    const run = async () => {
      const targetRole = roleInput.value.trim();
      if (!targetRole) { roleInput.focus(); return; }
      out.hidden = false;
      out.innerHTML = `<div class="ai-loading"><span class="ai-spinner"></span> Analyzing…</div>`;
      try {
        const r = await api('/api/ai/career-gap', { method: 'POST', body: { targetRole } });
        const skills = (r.missing_skills || []).map(s => `<span class="skill-chip">${escapeHTML(s)}</span>`).join('');
        out.innerHTML = `
          <div class="ai-coach-analysis">${escapeHTML(r.analysis).replace(/\n/g, '<br>')}</div>
          ${skills ? `<h4 class="ai-coach-h">Skills to build</h4><div class="skills-list">${skills}</div>` : ''}`;
      } catch (e) {
        out.innerHTML = `<div class="ai-error">${escapeHTML(e.message || 'Could not analyze right now.')}</div>`;
      }
    };
    go.onclick = run;
    roleInput.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
  }
})();
