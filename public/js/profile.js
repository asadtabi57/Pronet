// Rich profile page — two-column (desktop) / stacked (mobile) layout with hero,
// completion meter, About, Experience, Education, Projects, Certifications,
// Skills + endorsements, Activity, and a sidebar (stats, who viewed, people also
// viewed, AI profile score). Owner sees edit affordances; visitors see endorse +
// AI "draft intro".
(async function () {
  if (!requireAuth()) return;
  const me = getMe();
  const id = +(new URLSearchParams(location.search).get('id') || me.id);
  await renderNav(id === me.id ? 'me' : '');

  const root = document.getElementById('profile-root');
  let data, extras;
  try {
    [data, extras] = await Promise.all([
      api(`/api/users/${id}`).then(r => r.user),
      api(`/api/users/${id}/extras`).catch(() => ({})),
    ]);
  } catch (e) { root.innerHTML = `<div class="card empty">${escapeHTML(e.message)}</div>`; return; }
  extras = extras || {};
  const isMe = data.id === me.id;

  // ---------- helpers ----------
  function profileBtnLabel(d) {
    if (d.connected)   return '✓ Connected';
    if (d.pending_out) return 'Pending';
    if (d.pending_in)  return 'Accept request';
    return '+ Connect';
  }
  function durationLabel(from, to) {
    if (!from) return escapeHTML(to || '');
    return `${escapeHTML(from)} – ${escapeHTML(to || 'Present')}`;
  }
  function coverStyle(d) {
    return d.cover_url
      ? `background-image:url('${escapeHTML(d.cover_url)}');background-size:cover;background-position:center`
      : `background:linear-gradient(135deg, ${d.cover_color || '#a0c4ff'}, #c7d8ff)`;
  }

  // ---------- HERO ----------
  function heroHTML() {
    const stats = `
      <div class="ph-stats">
        <span><b>${data.connection_count}</b> connection${data.connection_count === 1 ? '' : 's'}</span>
        ${isMe ? `<span><b>${extras.profile_views || 0}</b> profile views</span>` : ''}
        <span><b>${extras.post_count || 0}</b> post${(extras.post_count || 0) === 1 ? '' : 's'}</span>
      </div>`;
    const otw = data.open_to_work
      ? `<div class="open-to-work-badge">💼 Open to work${data.open_to_work_roles ? ` · ${escapeHTML(data.open_to_work_roles)}` : ''}</div>`
      : '';
    const actions = isMe
      ? `<button class="btn-tiny" id="edit-btn">✎ Edit profile</button>
         <button class="ai-btn ai-btn-tiny" id="complete-ai-btn" title="Complete profile with AI">✨ <span>Complete with AI</span></button>
         <button class="btn-tiny ghost" id="share-btn">🔗 Share</button>`
      : `<button class="btn-fill" id="connect-btn">${profileBtnLabel(data)}</button>
         <button class="btn-tiny" id="message-btn">💬 Message</button>
         <button class="ai-btn ai-btn-tiny" id="intro-btn" title="Draft an intro with AI">✨ <span>Draft intro</span></button>`;
    return `
      <article class="card profile-hero">
        <div class="ph-cover" style="${coverStyle(data)}">
          ${isMe ? `<button class="ph-cover-edit" id="cover-edit-btn" title="Change cover">📷</button>` : ''}
        </div>
        <div class="ph-avatar-wrap">${avatar(data, 'xl')}</div>
        <div class="ph-body">
          <div class="ph-actions">${actions}</div>
          <h1>${escapeHTML(data.name)}${data.subscription ? '<span class="premium-badge">PREMIUM</span>' : ''}</h1>
          <p class="ph-headline">${escapeHTML(data.headline || '')}</p>
          <p class="ph-loc">${escapeHTML(data.location || '')}</p>
          ${otw}
          ${stats}
        </div>
      </article>`;
  }

  // ---------- COMPLETION METER (owner only) ----------
  function completionHTML() {
    if (!isMe || !extras.completion) return '';
    const c = extras.completion;
    const todo = (c.todo || []).map(t => `<li>${escapeHTML(t.label)}</li>`).join('');
    return `
      <article class="card profile-completion">
        <div class="pc-top">
          <div class="pc-ring" style="--pct:${c.score}">
            <span>${c.score}%</span>
          </div>
          <div class="pc-info">
            <h3>Profile strength: <span class="pc-tier">${escapeHTML(c.tier)}</span></h3>
            ${todo ? `<p>Next steps to level up:</p><ul class="pc-todo">${todo}</ul>` : '<p>🎉 Your profile is looking great!</p>'}
          </div>
        </div>
      </article>`;
  }

  // ---------- ABOUT ----------
  function aboutHTML() {
    if (!data.about && !isMe) return '';
    return `
      <article class="card profile-section">
        <div class="ps-head"><h2>About</h2>${isMe ? `<button class="ps-edit" data-edit="about" title="Edit">✎</button>` : ''}</div>
        <p class="about-text">${data.about ? escapeHTML(data.about) : '<span class="muted">Add a summary about yourself.</span>'}</p>
      </article>`;
  }

  // ---------- EXPERIENCE ----------
  function experienceHTML() {
    const list = data.experience || [];
    if (!list.length && !isMe) return '';
    const items = list.map(e => `
      <div class="exp-item">
        <div class="logo">🏢</div>
        <div class="body">
          <div class="title">${escapeHTML(e.title || '')}</div>
          <div class="company">${escapeHTML(e.company || '')}</div>
          <div class="date">${durationLabel(e.from, e.to)}</div>
          ${e.description ? `<div class="desc">${escapeHTML(e.description)}</div>` : ''}
        </div>
      </div>`).join('');
    return `
      <article class="card profile-section">
        <div class="ps-head"><h2>Experience</h2>${isMe ? `<button class="ps-edit" data-edit="experience" title="Edit">✎</button>` : ''}</div>
        ${items || '<p class="muted">No experience added yet.</p>'}
      </article>`;
  }

  // ---------- EDUCATION ----------
  function educationHTML() {
    const list = data.education || [];
    if (!list.length && !isMe) return '';
    const items = list.map(e => `
      <div class="exp-item">
        <div class="logo">🎓</div>
        <div class="body">
          <div class="title">${escapeHTML(e.school || '')}</div>
          <div class="company">${escapeHTML(e.degree || '')}</div>
          <div class="date">${durationLabel(e.from, e.to)}</div>
        </div>
      </div>`).join('');
    return `
      <article class="card profile-section">
        <div class="ps-head"><h2>Education</h2>${isMe ? `<button class="ps-edit" data-edit="education" title="Edit">✎</button>` : ''}</div>
        ${items || '<p class="muted">No education added yet.</p>'}
      </article>`;
  }

  // ---------- PROJECTS / FEATURED ----------
  function projectsHTML() {
    const list = extras.projects || [];
    if (!list.length && !isMe) return '';
    const cards = list.map(p => `
      <div class="proj-card" data-pid="${p.id}">
        ${p.image_url ? `<div class="proj-img"><img src="${escapeHTML(p.image_url)}" alt=""/></div>` : ''}
        <div class="proj-body">
          <div class="proj-title">${escapeHTML(p.title)}${p.url ? ` <a href="${escapeHTML(p.url)}" target="_blank" rel="noopener">↗</a>` : ''}</div>
          ${p.description ? `<div class="proj-desc">${escapeHTML(p.description)}</div>` : ''}
          ${(p.tags || []).length ? `<div class="proj-tags">${p.tags.map(t => `<span class="tag-chip">${escapeHTML(t)}</span>`).join('')}</div>` : ''}
        </div>
        ${isMe ? `<button class="proj-del" data-pid="${p.id}" title="Remove">×</button>` : ''}
      </div>`).join('');
    return `
      <article class="card profile-section">
        <div class="ps-head"><h2>Featured & Projects</h2>${isMe ? `<button class="ps-add" id="add-project" title="Add project">+ Add</button>` : ''}</div>
        <div class="proj-grid">${cards || '<p class="muted">Showcase your best work here.</p>'}</div>
      </article>`;
  }

  // ---------- CERTIFICATIONS ----------
  function certsHTML() {
    const list = extras.certifications || [];
    if (!list.length && !isMe) return '';
    const items = list.map(c => `
      <div class="cert-item" data-cid="${c.id}">
        <div class="cert-ic">📜</div>
        <div class="cert-body">
          <div class="cert-name">${escapeHTML(c.name)}${c.credential_url ? ` <a href="${escapeHTML(c.credential_url)}" target="_blank" rel="noopener">↗</a>` : ''}</div>
          <div class="cert-meta">${escapeHTML(c.issuer || '')}${c.issue_date ? ` · ${escapeHTML(c.issue_date)}` : ''}</div>
        </div>
        ${isMe ? `<button class="cert-del" data-cid="${c.id}" title="Remove">×</button>` : ''}
      </div>`).join('');
    return `
      <article class="card profile-section">
        <div class="ps-head"><h2>Licenses & Certifications</h2>${isMe ? `<button class="ps-add" id="add-cert" title="Add certification">+ Add</button>` : ''}</div>
        ${items || '<p class="muted">Add your certifications (AWS, Google, etc.).</p>'}
      </article>`;
  }

  // ---------- SKILLS + ENDORSEMENTS ----------
  function skillsHTML() {
    const list = data.skills || [];
    if (!list.length && !isMe) return '';
    const end = extras.endorsements || {};
    const chips = list.map(s => {
      const e = end[s] || { count: 0, mine: false };
      const canEndorse = !isMe;
      return `<span class="skill-chip endorsable${e.mine ? ' endorsed' : ''}" data-skill="${escapeHTML(s)}">
        ${escapeHTML(s)}${e.count ? `<b class="end-count">${e.count}</b>` : ''}
        ${canEndorse ? `<button class="endorse-btn" data-skill="${escapeHTML(s)}" title="${e.mine ? 'Remove endorsement' : 'Endorse'}">${e.mine ? '✓' : '+'}</button>` : ''}
      </span>`;
    }).join('');
    return `
      <article class="card profile-section">
        <div class="ps-head"><h2>Skills</h2>${isMe ? `<button class="ps-edit" data-edit="skills" title="Edit">✎</button>` : ''}</div>
        <div class="skills-list">${chips || '<p class="muted">Add your skills.</p>'}</div>
      </article>`;
  }

  // ---------- ACTIVITY ----------
  function activityHTML() {
    if (data.activity_restricted) {
      return `<article class="card profile-section"><h2>Activity</h2><p class="muted">This member's activity is private.</p></article>`;
    }
    return `
      <article class="card profile-section">
        <h2>Activity</h2>
        <div id="posts">${(data.posts && data.posts.length) ? '' : '<p class="muted">No activity yet.</p>'}</div>
      </article>`;
  }

  // ---------- SIDEBAR ----------
  function sidebarHTML() {
    const langs = (data.languages || []).map(l => `<span class="mini-chip">${escapeHTML(l)}</span>`).join('');
    const ints = (data.interests || []).map(l => `<span class="mini-chip">${escapeHTML(l)}</span>`).join('');
    const aiScore = isMe ? `
      <div class="card side-card ai-score-card" id="ai-score-card">
        <h4>✨ AI Profile Review</h4>
        <button class="btn-tiny" id="ai-score-btn">Analyze my profile</button>
        <div id="ai-score-out"></div>
      </div>` : '';
    const whoViewed = isMe ? `
      <div class="card side-card" id="who-viewed-card">
        <h4>👁 Who viewed your profile</h4>
        <div id="who-viewed-list"><p class="muted">Loading…</p></div>
      </div>` : '';
    const langCard = (langs || ints) ? `
      <div class="card side-card">
        ${langs ? `<h4>Languages</h4><div class="mini-chips">${langs}</div>` : ''}
        ${ints ? `<h4 style="margin-top:${langs ? '14px' : '0'}">Interests</h4><div class="mini-chips">${ints}</div>` : ''}
      </div>` : '';
    return `
      ${aiScore}
      ${whoViewed}
      <div class="card side-card" id="also-viewed-card">
        <h4>People you may know</h4>
        <div id="also-viewed-list"><p class="muted">Loading…</p></div>
      </div>
      ${langCard}`;
  }

  // ---------- RENDER ----------
  function render() {
    root.innerHTML = `
      <div class="profile-grid">
        <div class="profile-main">
          ${heroHTML()}
          ${completionHTML()}
          ${aboutHTML()}
          ${experienceHTML()}
          ${educationHTML()}
          ${projectsHTML()}
          ${certsHTML()}
          ${skillsHTML()}
          ${activityHTML()}
        </div>
        <aside class="profile-side">
          ${sidebarHTML()}
        </aside>
      </div>`;
    wireActivity();
    wireActions();
    loadSidebar();
  }

  function wireActivity() {
    const postsEl = document.getElementById('posts');
    if (postsEl && data.posts && data.posts.length) {
      postsEl.innerHTML = data.posts.map(p => `<article class="card post" data-id="${p.id}">${renderPostInner(p)}</article>`).join('');
      postsEl.querySelectorAll('.post').forEach(el => {
        const p = data.posts.find(x => x.id === +el.dataset.id);
        wirePost(el, p, { onChange: () => location.reload() });
      });
    }
  }

  // ---------- SIDEBAR DATA ----------
  async function loadSidebar() {
    // People also viewed
    api(`/api/users/${id}/also-viewed`).then(({ people }) => {
      const el = document.getElementById('also-viewed-list');
      if (!el) return;
      if (!people || !people.length) { el.innerHTML = '<p class="muted">No suggestions.</p>'; return; }
      el.innerHTML = people.map(p => `
        <a class="side-person" href="/profile.html?id=${p.id}">
          ${avatar(p, 'sm')}
          <div class="sp-info"><div class="sp-name">${escapeHTML(p.name)}</div><div class="sp-head">${escapeHTML(p.headline || '')}</div></div>
        </a>`).join('');
    }).catch(() => {});

    if (isMe) {
      api('/api/me/profile-views').then(({ viewers, total }) => {
        const el = document.getElementById('who-viewed-list');
        if (!el) return;
        if (!viewers || !viewers.length) { el.innerHTML = '<p class="muted">No views yet. Share your profile to get noticed.</p>'; return; }
        el.innerHTML = viewers.slice(0, 6).map(v => {
          if (v.anonymous || !v.user) {
            return `<div class="side-person"><div class="avatar sm" style="background:#cbd5e1">?</div><div class="sp-info"><div class="sp-name">LinkedIn Member</div><div class="sp-head">Viewed ${timeAgo(v.last_viewed_at)}</div></div></div>`;
          }
          return `<a class="side-person" href="/profile.html?id=${v.user.id}">
            ${avatar(v.user, 'sm')}
            <div class="sp-info"><div class="sp-name">${escapeHTML(v.user.name)}</div><div class="sp-head">${escapeHTML(v.user.headline || '')}</div></div>
          </a>`;
        }).join('') + (total > 6 ? `<div class="side-more">+${total - 6} more</div>` : '');
      }).catch(() => {});
    }
  }

  // ---------- ACTIONS ----------
  function wireActions() {
    if (isMe) {
      const editBtn = document.getElementById('edit-btn');
      if (editBtn) editBtn.onclick = () => openEditModal();
      const shareBtn = document.getElementById('share-btn');
      if (shareBtn) shareBtn.onclick = () => {
        if (typeof openProfileShareSheet === 'function') openProfileShareSheet(data);
        else {
          const url = location.origin + `/profile.html?id=${data.id}`;
          if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => toast('Profile link copied!'), () => {});
          else toast(url);
        }
      };
      const coverBtn = document.getElementById('cover-edit-btn');
      if (coverBtn) coverBtn.onclick = () => uploadCover();
      const completeAi = document.getElementById('complete-ai-btn');
      if (completeAi && window.AI) completeAi.onclick = () => openCompleteWithAI();
      const scoreBtn = document.getElementById('ai-score-btn');
      if (scoreBtn && window.AI) scoreBtn.onclick = () => runProfileScore();
      // Section edit buttons
      root.querySelectorAll('.ps-edit').forEach(b => b.onclick = () => openEditModal(b.dataset.edit));
      const addProj = document.getElementById('add-project');
      if (addProj) addProj.onclick = () => openProjectModal();
      root.querySelectorAll('.proj-del').forEach(b => b.onclick = async () => {
        if (!(await confirmDialog({ title: 'Remove project?', confirmText: 'Remove' }))) return;
        await api(`/api/me/projects/${b.dataset.pid}`, { method: 'DELETE' }); reload();
      });
      const addCert = document.getElementById('add-cert');
      if (addCert) addCert.onclick = () => openCertModal();
      root.querySelectorAll('.cert-del').forEach(b => b.onclick = async () => {
        if (!(await confirmDialog({ title: 'Remove certification?', confirmText: 'Remove' }))) return;
        await api(`/api/me/certifications/${b.dataset.cid}`, { method: 'DELETE' }); reload();
      });
    } else {
      const connectBtn = document.getElementById('connect-btn');
      if (connectBtn) connectBtn.onclick = async (ev) => {
        if (data.connected) {
          if (!(await confirmDialog({ title: 'Remove connection?', message: 'They will be removed from your connections.', confirmText: 'Remove' }))) return;
          await api(`/api/people/${data.id}/disconnect`, { method: 'POST' });
          data.connected = false; data.pending_out = false; data.pending_in = false;
        } else if (data.pending_in) {
          await api(`/api/connections/${data.id}/accept`, { method: 'POST' });
          data.connected = true; data.pending_in = false; toast('Connected!');
        } else if (data.pending_out) { return; }
        else { await api(`/api/people/${data.id}/connect`, { method: 'POST' }); data.pending_out = true; toast('Request sent'); }
        ev.target.textContent = profileBtnLabel(data);
        if (data.pending_out) ev.target.disabled = true;
      };
      if (data.pending_out && connectBtn) connectBtn.disabled = true;
      const msgBtn = document.getElementById('message-btn');
      if (msgBtn) msgBtn.onclick = () => location.href = `/messages.html?user=${data.id}`;
      const introBtn = document.getElementById('intro-btn');
      if (introBtn && window.AI) introBtn.onclick = () => AI.assistant({
        title: `Draft an intro to ${data.name}`,
        insertLabel: '💬 Use in message',
        run: async () => (await api('/api/ai/draft-intro', { method: 'POST', body: { targetUserId: data.id } })).text,
        onInsert: (text) => {
          try { sessionStorage.setItem('pronet_msg_draft', JSON.stringify({ userId: data.id, text })); } catch (e) {}
          location.href = `/messages.html?user=${data.id}`;
        },
      });
      // Endorsements
      root.querySelectorAll('.endorse-btn').forEach(b => b.onclick = async (ev) => {
        ev.preventDefault();
        try {
          const r = await api(`/api/users/${data.id}/endorse`, { method: 'POST', body: { skill: b.dataset.skill } });
          const chip = b.closest('.skill-chip');
          chip.classList.toggle('endorsed', r.mine);
          b.textContent = r.mine ? '✓' : '+';
          let cnt = chip.querySelector('.end-count');
          if (r.count > 0) { if (!cnt) { cnt = document.createElement('b'); cnt.className = 'end-count'; chip.insertBefore(cnt, b); } cnt.textContent = r.count; }
          else if (cnt) cnt.remove();
          toast(r.mine ? 'Endorsed!' : 'Endorsement removed');
        } catch (e) { toast(e.message); }
      });
    }
  }

  async function reload() {
    [data, extras] = await Promise.all([
      api(`/api/users/${id}`).then(r => r.user),
      api(`/api/users/${id}/extras`).catch(() => ({})),
    ]);
    extras = extras || {};
    render();
  }

  // ---------- COVER UPLOAD ----------
  function uploadCover() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/png,image/jpeg,image/gif,image/webp';
    input.onchange = () => {
      const f = input.files[0]; if (!f) return;
      if (f.size > 5 * 1024 * 1024) { toast('Cover must be under 5 MB'); return; }
      const reader = new FileReader();
      reader.onload = async () => {
        try { const r = await api('/api/me/cover', { method: 'POST', body: { data_url: reader.result } }); setMe(r.user); toast('Cover updated'); reload(); }
        catch (e) { toast(e.message); }
      };
      reader.readAsDataURL(f);
    };
    input.click();
  }

  // ---------- EDIT PROFILE MODAL ----------
  function openEditModal(focusSection) {
    const u = data;
    const avatarPreview = u.avatar_url
      ? `<div class="preview"><img src="${escapeHTML(u.avatar_url)}"/></div>`
      : `<div class="preview" style="background:${u.avatar_color}">${initials(u.name)}</div>`;
    const expRows = (u.experience || []).map((e, i) => expRowHTML(e, i)).join('');
    const eduRows = (u.education || []).map((e, i) => eduRowHTML(e, i)).join('');
    const body = `
      <div class="avatar-uploader">
        <div id="ed-avatar-preview">${avatarPreview}</div>
        <div class="controls">
          <input type="file" id="ed-avatar-file" accept="image/png,image/jpeg,image/gif,image/webp" style="font-size:13px"/>
          <div style="display:flex;gap:6px">
            <button type="button" class="btn-tiny" id="ed-avatar-upload">Upload photo</button>
            ${u.avatar_url ? '<button type="button" class="btn-tiny ghost" id="ed-avatar-remove">Remove</button>' : ''}
          </div>
        </div>
      </div>
      <div class="field"><label>Name</label><input id="ed-name" value="${escapeHTML(u.name)}"/></div>
      <div class="field"><label class="ai-field-label">Headline <button type="button" class="ai-btn ai-btn-tiny ai-enhance" data-field="headline" title="Enhance with AI">✨</button></label><input id="ed-headline" value="${escapeHTML(u.headline || '')}"/></div>
      <div class="field"><label>Location</label><input id="ed-location" value="${escapeHTML(u.location || '')}"/></div>
      <div class="field"><label class="ai-field-label">About <button type="button" class="ai-btn ai-btn-tiny ai-enhance" data-field="about" title="Enhance with AI">✨</button></label><textarea id="ed-about" rows="4">${escapeHTML(u.about || '')}</textarea></div>
      <div class="field"><label>Skills (comma-separated)</label><input id="ed-skills" value="${escapeHTML((u.skills || []).join(', '))}"/></div>
      <div class="field"><label>Languages (comma-separated)</label><input id="ed-languages" value="${escapeHTML((u.languages || []).join(', '))}"/></div>
      <div class="field"><label>Interests (comma-separated)</label><input id="ed-interests" value="${escapeHTML((u.interests || []).join(', '))}"/></div>
      <div class="field otw-field">
        <label class="otw-toggle"><input type="checkbox" id="ed-otw" ${u.open_to_work ? 'checked' : ''}/> 💼 Open to work</label>
        <input id="ed-otw-roles" placeholder="Roles you're open to (e.g. Frontend Engineer)" value="${escapeHTML(u.open_to_work_roles || '')}"/>
      </div>
      <div class="edit-subsection">
        <div class="ess-head"><h4>Experience</h4><button type="button" class="btn-tiny" id="add-exp">+ Add</button></div>
        <div id="exp-rows">${expRows}</div>
      </div>
      <div class="edit-subsection">
        <div class="ess-head"><h4>Education</h4><button type="button" class="btn-tiny" id="add-edu">+ Add</button></div>
        <div id="edu-rows">${eduRows}</div>
      </div>`;
    const footer = `<button class="btn-fill" id="save-profile">Save</button>`;
    const m = openModal({ title: 'Edit profile', body, footer });

    // AI enhance
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

    // Avatar upload
    const fileInput = m.el.querySelector('#ed-avatar-file');
    const previewBox = m.el.querySelector('#ed-avatar-preview');
    m.el.querySelector('#ed-avatar-upload').onclick = () => fileInput.click();
    fileInput.onchange = async () => {
      const f = fileInput.files[0]; if (!f) return;
      if (f.size > 4 * 1024 * 1024) { toast('Image must be under 4 MB'); return; }
      const reader = new FileReader();
      reader.onload = async () => {
        try { const r = await api('/api/me/avatar', { method: 'POST', body: { data_url: reader.result } });
          setMe(r.user); previewBox.innerHTML = `<div class="preview"><img src="${escapeHTML(r.user.avatar_url)}"/></div>`; toast('Photo updated'); }
        catch (e) { toast(e.message); }
      };
      reader.readAsDataURL(f);
    };
    const removeBtn = m.el.querySelector('#ed-avatar-remove');
    if (removeBtn) removeBtn.onclick = async () => {
      const r = await api('/api/me/avatar', { method: 'DELETE' });
      setMe(r.user); previewBox.innerHTML = `<div class="preview" style="background:${r.user.avatar_color}">${initials(r.user.name)}</div>`; removeBtn.remove();
    };

    // Experience/education add + remove
    m.el.querySelector('#add-exp').onclick = () => {
      m.el.querySelector('#exp-rows').insertAdjacentHTML('beforeend', expRowHTML({}, Date.now()));
      wireRowRemovers(m.el);
    };
    m.el.querySelector('#add-edu').onclick = () => {
      m.el.querySelector('#edu-rows').insertAdjacentHTML('beforeend', eduRowHTML({}, Date.now()));
      wireRowRemovers(m.el);
    };
    wireRowRemovers(m.el);

    if (focusSection === 'about') m.el.querySelector('#ed-about').focus();
    else if (focusSection === 'headline') m.el.querySelector('#ed-headline').focus();
    else if (focusSection === 'skills') m.el.querySelector('#ed-skills').focus();

    m.el.querySelector('#save-profile').onclick = async () => {
      const splitCsv = v => v.split(',').map(s => s.trim()).filter(Boolean);
      const experience = [...m.el.querySelectorAll('#exp-rows .ee-row')].map(r => ({
        title: r.querySelector('.ee-title').value.trim(),
        company: r.querySelector('.ee-company').value.trim(),
        from: r.querySelector('.ee-from').value.trim(),
        to: r.querySelector('.ee-to').value.trim(),
        description: r.querySelector('.ee-desc').value.trim(),
      })).filter(e => e.title || e.company);
      const education = [...m.el.querySelectorAll('#edu-rows .ee-row')].map(r => ({
        school: r.querySelector('.ee-school').value.trim(),
        degree: r.querySelector('.ee-degree').value.trim(),
        from: r.querySelector('.ee-from').value.trim(),
        to: r.querySelector('.ee-to').value.trim(),
      })).filter(e => e.school || e.degree);
      const updates = {
        name: m.el.querySelector('#ed-name').value.trim(),
        headline: m.el.querySelector('#ed-headline').value.trim(),
        location: m.el.querySelector('#ed-location').value.trim(),
        about: m.el.querySelector('#ed-about').value,
        skills: splitCsv(m.el.querySelector('#ed-skills').value),
        languages: splitCsv(m.el.querySelector('#ed-languages').value),
        interests: splitCsv(m.el.querySelector('#ed-interests').value),
        open_to_work: m.el.querySelector('#ed-otw').checked,
        open_to_work_roles: m.el.querySelector('#ed-otw-roles').value.trim(),
        experience, education,
      };
      try { const r = await api('/api/me', { method: 'PUT', body: updates }); setMe(r.user); m.close(); reload(); }
      catch (e) { toast(e.message); }
    };
  }

  function expRowHTML(e, key) {
    return `<div class="ee-row" data-key="${key}">
      <input class="ee-title" placeholder="Title" value="${escapeHTML(e.title || '')}"/>
      <input class="ee-company" placeholder="Company" value="${escapeHTML(e.company || '')}"/>
      <div class="ee-dates"><input class="ee-from" placeholder="From (2021)" value="${escapeHTML(e.from || '')}"/><input class="ee-to" placeholder="To (Present)" value="${escapeHTML(e.to || '')}"/></div>
      <textarea class="ee-desc" rows="2" placeholder="Description (optional)">${escapeHTML(e.description || '')}</textarea>
      <button type="button" class="ee-remove" title="Remove">Remove</button>
    </div>`;
  }
  function eduRowHTML(e, key) {
    return `<div class="ee-row" data-key="${key}">
      <input class="ee-school" placeholder="School" value="${escapeHTML(e.school || '')}"/>
      <input class="ee-degree" placeholder="Degree" value="${escapeHTML(e.degree || '')}"/>
      <div class="ee-dates"><input class="ee-from" placeholder="From" value="${escapeHTML(e.from || '')}"/><input class="ee-to" placeholder="To" value="${escapeHTML(e.to || '')}"/></div>
      <button type="button" class="ee-remove" title="Remove">Remove</button>
    </div>`;
  }
  function wireRowRemovers(scope) {
    scope.querySelectorAll('.ee-remove').forEach(b => b.onclick = () => b.closest('.ee-row').remove());
  }

  // ---------- PROJECT MODAL ----------
  function openProjectModal() {
    const body = `
      <div class="field"><label>Title</label><input id="pr-title" placeholder="Project name"/></div>
      <div class="field"><label>Description</label><textarea id="pr-desc" rows="3"></textarea></div>
      <div class="field"><label>Link (optional)</label><input id="pr-url" placeholder="https://…"/></div>
      <div class="field"><label>Image URL (optional)</label><input id="pr-img" placeholder="https://…"/></div>
      <div class="field"><label>Tags (comma-separated)</label><input id="pr-tags" placeholder="React, Node, AI"/></div>`;
    const m = openModal({ title: 'Add project', body, footer: `<button class="btn-fill" id="pr-save">Add project</button>` });
    m.el.querySelector('#pr-title').focus();
    m.el.querySelector('#pr-save').onclick = async () => {
      const title = m.el.querySelector('#pr-title').value.trim();
      if (!title) { toast('Title required'); return; }
      try {
        await api('/api/me/projects', { method: 'POST', body: {
          title, description: m.el.querySelector('#pr-desc').value.trim(),
          url: m.el.querySelector('#pr-url').value.trim(), image_url: m.el.querySelector('#pr-img').value.trim(),
          tags: m.el.querySelector('#pr-tags').value.split(',').map(s => s.trim()).filter(Boolean),
        }});
        m.close(); reload();
      } catch (e) { toast(e.message); }
    };
  }

  // ---------- CERTIFICATION MODAL ----------
  function openCertModal() {
    const body = `
      <div class="field"><label>Name</label><input id="ct-name" placeholder="AWS Solutions Architect"/></div>
      <div class="field"><label>Issuer</label><input id="ct-issuer" placeholder="Amazon Web Services"/></div>
      <div class="field"><label>Date</label><input id="ct-date" placeholder="2024"/></div>
      <div class="field"><label>Credential URL (optional)</label><input id="ct-url" placeholder="https://…"/></div>`;
    const m = openModal({ title: 'Add certification', body, footer: `<button class="btn-fill" id="ct-save">Add</button>` });
    m.el.querySelector('#ct-name').focus();
    m.el.querySelector('#ct-save').onclick = async () => {
      const name = m.el.querySelector('#ct-name').value.trim();
      if (!name) { toast('Name required'); return; }
      try {
        await api('/api/me/certifications', { method: 'POST', body: {
          name, issuer: m.el.querySelector('#ct-issuer').value.trim(),
          issue_date: m.el.querySelector('#ct-date').value.trim(), credential_url: m.el.querySelector('#ct-url').value.trim(),
        }});
        m.close(); reload();
      } catch (e) { toast(e.message); }
    };
  }

  // ---------- AI: COMPLETE WITH AI ----------
  function openCompleteWithAI() {
    const body = `
      <p class="ai-coach-intro">Tell me a few rough notes about yourself and I'll draft <b>every section</b> of your profile — headline, About, skills, experience, education, languages and interests. I'll ask if anything important is missing.</p>
      <div class="field"><label>Quick notes</label><textarea id="cwa-notes" rows="3" placeholder="e.g. react dev 3 yrs at TechCorp since 2022, BSCS from FAST 2021, speak English/Urdu, into AI"></textarea></div>
      <button type="button" class="btn-fill" id="cwa-go" style="width:100%">Generate</button>
      <div id="cwa-out" hidden></div>`;
    const m = openModal({ title: '✨ Complete profile with AI', body });
    const notes = m.el.querySelector('#cwa-notes');
    const out = m.el.querySelector('#cwa-out');
    notes.focus();
    m.el.querySelector('#cwa-go').onclick = async () => {
      out.hidden = false;
      out.innerHTML = `<div class="ai-loading"><span class="ai-spinner"></span> Generating…</div>`;
      try {
        const r = await api('/api/ai/complete-profile', { method: 'POST', body: { notes: notes.value.trim() } });
        const sec = (label, html) => html
          ? `<div class="cwa-field"><label>${label}</label><div class="cwa-val">${html}</div></div>` : '';
        const expHTML = (r.experience || []).map(e =>
          `<div class="cwa-item"><b>${escapeHTML(e.title || '')}</b>${e.company ? ' · ' + escapeHTML(e.company) : ''}` +
          `${(e.from || e.to) ? ` <small>(${escapeHTML(e.from || '?')} – ${escapeHTML(e.to || 'Present')})</small>` : ''}` +
          `${e.description ? `<div class="cwa-desc">${escapeHTML(e.description)}</div>` : ''}</div>`).join('');
        const eduHTML = (r.education || []).map(e =>
          `<div class="cwa-item"><b>${escapeHTML(e.school || '')}</b>${e.degree ? ' · ' + escapeHTML(e.degree) : ''}` +
          `${(e.from || e.to) ? ` <small>(${escapeHTML(e.from || '?')} – ${escapeHTML(e.to || '')})</small>` : ''}</div>`).join('');
        const chips = (arr) => (arr || []).map(s => `<span class="skill-chip">${escapeHTML(s)}</span>`).join(' ');
        // Sections that still need user-provided info → explicit prompts.
        const needsHTML = (r.needs && r.needs.length)
          ? `<div class="cwa-needs"><b>To finish the remaining sections, tell me:</b><ul>` +
            r.needs.map(n => `<li><b>${escapeHTML(n.section)}</b> — ${escapeHTML(n.question)}</li>`).join('') +
            `</ul><small>Add these details to your notes above and hit Generate again.</small></div>` : '';
        out.innerHTML = `
          ${sec('Headline', r.headline ? escapeHTML(r.headline) : '')}
          ${sec('About', r.about ? escapeHTML(r.about) : '')}
          ${sec('Skills', chips(r.skills))}
          ${sec('Experience', expHTML)}
          ${sec('Education', eduHTML)}
          ${sec('Languages', chips(r.languages))}
          ${sec('Interests', chips(r.interests))}
          ${sec('Open-to-work roles', r.open_to_work_roles ? escapeHTML(r.open_to_work_roles) : '')}
          ${needsHTML}
          <button type="button" class="btn-fill" id="cwa-apply" style="width:100%;margin-top:12px">Apply filled sections to my profile</button>`;
        out.querySelector('#cwa-apply').onclick = async () => {
          try {
            // Only write sections the AI actually produced — empty ones (the
            // "needs" list) never overwrite what's already on the profile.
            const body = {};
            if (r.headline) body.headline = r.headline;
            if (r.about) body.about = r.about;
            if (r.skills && r.skills.length) body.skills = r.skills;
            if (r.experience && r.experience.length) body.experience = r.experience;
            if (r.education && r.education.length) body.education = r.education;
            if (r.languages && r.languages.length) body.languages = r.languages;
            if (r.interests && r.interests.length) body.interests = r.interests;
            if (r.open_to_work_roles) body.open_to_work_roles = r.open_to_work_roles;
            if (!Object.keys(body).length) { toast('Nothing to apply yet — add more notes.'); return; }
            const upd = await api('/api/me', { method: 'PUT', body });
            setMe(upd.user); m.close(); toast('Profile updated with AI ✨'); reload();
          } catch (e) { toast(e.message); }
        };
      } catch (e) {
        out.innerHTML = `<div class="ai-error">${escapeHTML(e.message || 'Could not generate. Try again.')}</div>`;
      }
    };
  }

  // ---------- AI: PROFILE SCORE ----------
  async function runProfileScore() {
    const out = document.getElementById('ai-score-out');
    const btn = document.getElementById('ai-score-btn');
    if (!out) return;
    out.innerHTML = `<div class="ai-loading"><span class="ai-spinner"></span> Analyzing…</div>`;
    if (btn) btn.disabled = true;
    try {
      const r = await api('/api/ai/profile-score', { method: 'POST', body: {} });
      const tips = (r.suggestions || []).map(s => `<li>${escapeHTML(s)}</li>`).join('');
      out.innerHTML = `
        <div class="ai-score-result">
          <div class="asr-score">${r.score}<small>/100 · ${escapeHTML(r.tier)}</small></div>
          <p class="asr-review">${escapeHTML(r.review)}</p>
          ${tips ? `<ul class="asr-tips">${tips}</ul>` : ''}
        </div>`;
    } catch (e) {
      out.innerHTML = `<div class="ai-error">${escapeHTML(e.message || 'Could not analyze.')}</div>`;
    } finally { if (btn) btn.disabled = false; }
  }

  render();
})();
