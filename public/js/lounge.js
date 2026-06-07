// ==========================================================================
// Connectik — Co-Working Lounge
// A low-pressure presence room: see who's online ("in the zone") and share a
// lofi stream. No backend changes — the grid is driven by the existing SSE
// Presence set (window.Presence) plus a local `isInLounge` toggle for self.
// ==========================================================================
(async function () {
  if (typeof requireAuth === 'function' && !requireAuth()) return;

  const navP = (typeof renderNav === 'function') ? renderNav('lounge') : Promise.resolve();

  let me = (typeof getMe === 'function' && getMe()) || null;
  let people = [];
  try {
    const meRes = await api('/api/me').catch(() => null);
    if (meRes && meRes.user) { me = meRes.user; setMe(me); }
    const peopleRes = await api('/api/people').catch(() => ({ people: [] }));
    people = peopleRes.people || [];
  } catch (e) { /* non-fatal — grid just shows fewer faces */ }
  await navP;

  // ---- State ----
  let isInLounge = false; // local self-presence in the lounge view

  const grid = document.getElementById('lounge-grid');
  const empty = document.getElementById('lounge-empty');
  const countEl = document.getElementById('lounge-count');
  const joinBtn = document.getElementById('lounge-join-btn');

  // Build a de-duped roster of candidate users we can show (self + discovered
  // people). We render only those the Presence layer reports as online.
  function roster() {
    const map = new Map();
    if (me) map.set(Number(me.id), me);
    people.forEach(u => { if (u && u.id != null) map.set(Number(u.id), u); });
    return map;
  }

  function avatarMarkup(u, inZone) {
    const cls = 'lounge-avatar' + (inZone ? ' in-zone' : '');
    const name = escapeHTML(u.name || '');
    const sub = escapeHTML(u.headline || '');
    const inner = u.avatar_url
      ? `<img class="${cls}" src="${escapeHTML(u.avatar_url)}" alt="${name}" />`
      : `<div class="${cls} la-initials" style="background:${u.avatar_color || 'var(--brand)'}">${initials(u.name)}</div>`;
    return `
      <div class="lounge-person" title="${name}${sub ? ' — ' + sub : ''}">
        ${inner}
        <span class="lounge-name">${name}${u.__self ? ' (You)' : ''}</span>
      </div>`;
  }

  function render() {
    const map = roster();
    const onlineIds = [];
    map.forEach((u, id) => {
      const online = window.Presence && Presence.isOnline(id);
      const self = me && id === Number(me.id);
      if (online || (self && isInLounge)) onlineIds.push(id);
    });
    // Always include self up-front when joined.
    if (me && isInLounge && !onlineIds.includes(Number(me.id))) onlineIds.unshift(Number(me.id));

    if (!onlineIds.length) {
      grid.innerHTML = '';
      empty.style.display = '';
      countEl.textContent = '0 in the zone';
      return;
    }
    empty.style.display = 'none';
    grid.innerHTML = onlineIds.map(id => {
      const u = Object.assign({}, map.get(id) || { id, name: 'Member' });
      if (me && id === Number(me.id)) u.__self = true;
      // Everyone shown is actively present, so everyone gets the "in the zone" pulse.
      return avatarMarkup(u, true);
    }).join('');
    countEl.textContent = onlineIds.length + (onlineIds.length === 1 ? ' in the zone' : ' in the zone');
  }

  joinBtn.addEventListener('click', () => {
    isInLounge = !isInLounge;
    joinBtn.classList.toggle('joined', isInLounge);
    joinBtn.textContent = isInLounge ? 'Leave the lounge' : 'Join the lounge';
    render();
  });

  // Re-render whenever the real-time presence set changes or first seeds.
  if (window.Presence) {
    Presence.onSeed(render);
    if (window.RT && RT.on) RT.on('presence', () => render());
  }
  render();

  // ---- Audio player (custom play / pause / mute over a hidden <audio>) ----
  const audio = document.getElementById('lounge-audio');
  const playBtn = document.getElementById('la-play');
  const muteBtn = document.getElementById('la-mute');
  const statusEl = document.getElementById('la-status');
  const eq = document.getElementById('la-eq');

  function syncAudioUI() {
    const playing = !audio.paused;
    playBtn.textContent = playing ? '❚❚' : '▶';
    playBtn.setAttribute('aria-label', playing ? 'Pause lofi' : 'Play lofi');
    eq.classList.toggle('on', playing && !audio.muted);
    muteBtn.textContent = audio.muted ? '🔇' : '🔊';
    statusEl.textContent = !playing ? 'Paused' : (audio.muted ? 'Playing (muted)' : 'Now playing');
  }

  playBtn.addEventListener('click', async () => {
    try {
      if (audio.paused) {
        // First user gesture: unmute so they actually hear it.
        audio.muted = false;
        await audio.play();
      } else {
        audio.pause();
      }
    } catch (e) {
      statusEl.textContent = 'Tap again to start audio';
    }
    syncAudioUI();
  });

  muteBtn.addEventListener('click', () => {
    audio.muted = !audio.muted;
    syncAudioUI();
  });

  audio.addEventListener('play', syncAudioUI);
  audio.addEventListener('pause', syncAudioUI);
  syncAudioUI();
})();
