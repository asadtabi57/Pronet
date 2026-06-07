// ==========================================================================
// Connectik — 1-to-1 WebRTC calls (audio / video / screen share)
// Peer-to-peer media via RTCPeerConnection; signaling over our SSE bus +
// POST /api/calls/:id/signal. Loaded on every authenticated page so the
// incoming-call modal can appear no matter where the user is.
// ==========================================================================
(function () {
  if (window.CallUI) return; // singleton
  if (typeof RT === 'undefined') return;

  const ICE_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  const RING_TIMEOUT_MS = 35000;

  const state = {
    call: null,        // current call DTO
    role: null,        // 'caller' | 'receiver'
    peerUser: null,    // the other person (public user)
    pc: null,
    localStream: null,
    remoteStream: null,
    cameraTrack: null, // saved camera track while screen-sharing
    screenStream: null,
    pendingCandidates: [],
    haveRemoteDesc: false,
    timer: null,
    ringTimer: null,
    startedAt: null,
    muted: false,
    camOff: false,
    sharing: false,
    facingMode: 'user', // 'user' (front) | 'environment' (back)
  };

  // ---------- DOM ----------
  let elOverlay, elIncoming, ringAudio, vibrateTimer = null;

  function buildUI() {
    // In-call window
    elOverlay = document.createElement('div');
    elOverlay.className = 'call-overlay';
    elOverlay.id = 'call-overlay';
    elOverlay.innerHTML = `
      <div class="call-window">
        <div class="call-stage">
          <video class="call-remote" id="call-remote" autoplay playsinline></video>
          <div class="call-remote-audio" id="call-remote-audio" hidden>
            <div class="call-avatar" id="call-avatar"></div>
            <div class="call-peer-name" id="call-peer-name"></div>
          </div>
          <video class="call-local" id="call-local" autoplay playsinline muted></video>
          <div class="call-topbar">
            <span class="call-status-pill" id="call-status">Connecting…</span>
            <span class="call-timer" id="call-timer" hidden>00:00</span>
          </div>
        </div>
        <div class="call-controls" id="call-controls">
          <button class="call-ctrl" id="ctrl-mute" title="Mute"><span class="ci">🎤</span><small>Mute</small></button>
          <button class="call-ctrl" id="ctrl-cam" title="Camera"><span class="ci">📷</span><small>Camera</small></button>
          <button class="call-ctrl" id="ctrl-flip" title="Switch camera" style="display:none"><span class="ci">🔄</span><small>Flip</small></button>
          <button class="call-ctrl" id="ctrl-screen" title="Share screen"><span class="ci">🖥️</span><small>Share</small></button>
          <button class="call-ctrl call-end" id="ctrl-end" title="End call"><span class="ci">📞</span><small>End</small></button>
        </div>
      </div>`;
    document.body.appendChild(elOverlay);

    // Incoming call modal
    elIncoming = document.createElement('div');
    elIncoming.className = 'call-incoming';
    elIncoming.id = 'call-incoming';
    elIncoming.innerHTML = `
      <div class="call-incoming-card">
        <div class="call-avatar lg" id="inc-avatar"></div>
        <div class="inc-name" id="inc-name"></div>
        <div class="inc-sub" id="inc-sub">Incoming call…</div>
        <div class="inc-actions">
          <button class="inc-btn reject" id="inc-reject"><span>✕</span>Decline</button>
          <button class="inc-btn accept" id="inc-accept"><span>✓</span>Accept</button>
        </div>
      </div>`;
    document.body.appendChild(elIncoming);

    ringAudio = new Audio('/ringtone.mp3');
    ringAudio.preload = 'auto';

    document.getElementById('ctrl-mute').onclick = toggleMute;
    document.getElementById('ctrl-cam').onclick = toggleCamera;
    document.getElementById('ctrl-flip').onclick = switchCamera;
    document.getElementById('ctrl-screen').onclick = toggleScreen;
    document.getElementById('ctrl-end').onclick = () => endCall(true);
    document.getElementById('inc-accept').onclick = acceptIncoming;
    document.getElementById('inc-reject').onclick = rejectIncoming;
  }

  function avatarMarkup(u) {
    if (u && u.avatar_url) return `<img src="${escapeAttr(u.avatar_url)}" alt=""/>`;
    const name = (u && u.name) || '?';
    const init = name.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('');
    return `<span class="ci-letters" style="background:${(u && u.avatar_color) || '#0a66c2'}">${init}</span>`;
  }
  function escapeAttr(s) { return String(s == null ? '' : s).replace(/"/g, '&quot;'); }

  // ---------- Helpers ----------
  function setStatus(t) { const e = document.getElementById('call-status'); if (e) e.textContent = t; }
  function showOverlay() { elOverlay.classList.add('open'); }
  function hideOverlay() { elOverlay.classList.remove('open'); }
  function showIncoming() {
    elIncoming.classList.add('open');
    try { ringAudio.loop = true; ringAudio.currentTime = 0; ringAudio.play().catch(() => {}); } catch (e) {}
    startVibration();
  }
  function hideIncoming() {
    elIncoming.classList.remove('open');
    try { ringAudio.pause(); ringAudio.currentTime = 0; } catch (e) {}
    stopVibration();
  }

  // Vibration patterns don't auto-repeat, so re-fire on an interval while ringing.
  function startVibration() {
    if (!('vibrate' in navigator)) return;
    stopVibration();
    try { navigator.vibrate([500, 500, 500]); } catch (e) {}
    vibrateTimer = setInterval(() => { try { navigator.vibrate([500, 500, 500]); } catch (e) {} }, 1600);
  }
  function stopVibration() {
    if (vibrateTimer) { clearInterval(vibrateTimer); vibrateTimer = null; }
    if ('vibrate' in navigator) { try { navigator.vibrate(0); } catch (e) {} }
  }

  function startTimer() {
    state.startedAt = Date.now();
    const t = document.getElementById('call-timer');
    t.hidden = false;
    state.timer = setInterval(() => {
      const s = Math.floor((Date.now() - state.startedAt) / 1000);
      const mm = String(Math.floor(s / 60)).padStart(2, '0');
      const ss = String(s % 60).padStart(2, '0');
      t.textContent = `${mm}:${ss}`;
    }, 1000);
  }

  async function signal(type, payload) {
    if (!state.call) return;
    try {
      await api(`/api/calls/${state.call.id}/signal`, { method: 'POST', body: { type, payload } });
    } catch (e) { console.error('signal failed', type, e); }
  }

  // ---------- Media + PeerConnection ----------
  async function getMedia(video) {
    const constraints = {
      audio: true,
      video: video
        ? { facingMode: { ideal: state.facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : false,
    };
    return navigator.mediaDevices.getUserMedia(constraints);
  }

  function syncRemoteMedia() {
    const remote = document.getElementById('call-remote');
    const overlay = document.getElementById('call-remote-audio');
    if (!remote || !overlay) return;
    // Decide purely on whether the peer is actually delivering a live video
    // track. Reading the receivers (and live tracks of the remote stream) is
    // immune to ontrack firing order, so the centered avatar can never stay
    // painted over an incoming camera/screen feed.
    let hasVideo = false;
    if (state.pc && typeof state.pc.getReceivers === 'function') {
      state.pc.getReceivers().forEach(r => {
        if (r.track && r.track.kind === 'video' && r.track.readyState === 'live' && !r.track.muted) hasVideo = true;
      });
    }
    if (!hasVideo && state.remoteStream) {
      hasVideo = state.remoteStream.getVideoTracks().some(t => t.readyState === 'live' && !t.muted);
    }
    remote.hidden = !hasVideo;
    overlay.hidden = hasVideo;
    // When the peer avatar card is visible, lift it above the local self-view
    // PiP if that PiP is also on screen so the two don't overlap in the corner.
    const localPip = document.getElementById('call-local');
    const localVisible = localPip && !localPip.hidden;
    overlay.classList.toggle('stacked', !hasVideo && !!localVisible);
  }

  function createPeer() {
    const pc = new RTCPeerConnection(ICE_CONFIG);
    state.remoteStream = new MediaStream();
    pc.ontrack = (ev) => {
      ev.streams[0].getTracks().forEach(tr => state.remoteStream.addTrack(tr));
      document.getElementById('call-remote').srcObject = state.remoteStream;
      const track = ev.track;
      if (track) {
        // A video track often arrives muted and unmutes a beat later; re-sync
        // on every state change so the avatar overlay tracks reality.
        track.onunmute = syncRemoteMedia;
        track.onmute = syncRemoteMedia;
        track.onended = syncRemoteMedia;
      }
      syncRemoteMedia();
    };
    pc.onicecandidate = (ev) => { if (ev.candidate) signal('ice_candidate', ev.candidate); };
    pc.onconnectionstatechange = () => {
      if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
        if (pc.connectionState === 'failed') endCall(true);
      }
      if (pc.connectionState === 'connected') { setStatus('Connected'); syncRemoteMedia(); }
    };
    // local tracks
    state.localStream.getTracks().forEach(tr => pc.addTrack(tr, state.localStream));
    return pc;
  }

  function attachLocalVideo() {
    const lv = document.getElementById('call-local');
    lv.srcObject = state.localStream;
    const hasVideo = state.localStream.getVideoTracks().length > 0;
    lv.hidden = !hasVideo;
  }

  function renderPeerInfo() {
    const u = state.peerUser || {};
    document.getElementById('call-avatar').innerHTML = avatarMarkup(u);
    document.getElementById('call-peer-name').textContent = u.name || '';
  }

  async function flushCandidates() {
    if (!state.haveRemoteDesc) return;
    for (const c of state.pendingCandidates) {
      try { await state.pc.addIceCandidate(c); } catch (e) {}
    }
    state.pendingCandidates = [];
  }

  // ---------- Outgoing ----------
  async function startCall(peerUser, callType) {
    if (state.call) { toast('You are already in a call.'); return; }
    try {
      state.localStream = await getMedia(callType === 'video');
    } catch (e) {
      toast('Could not access ' + (callType === 'video' ? 'camera/microphone' : 'microphone') + '. Check permissions.');
      return;
    }
    let res;
    try {
      res = await api('/api/calls', { method: 'POST', body: { receiver_id: peerUser.id, call_type: callType } });
    } catch (e) {
      stopLocal();
      toast(e.message || 'Could not start the call.');
      return;
    }
    state.call = res.call;
    state.role = 'caller';
    state.peerUser = peerUser;
    setupCallWindow(callType);
    setStatus('Ringing…');
    renderPeerInfo();

    state.ringTimer = setTimeout(() => {
      if (state.call && state.call.status === 'ringing') {
        toast('No answer.');
        cancelOutgoing();
      }
    }, RING_TIMEOUT_MS);
  }

  function setupCallWindow(callType) {
    document.getElementById('call-timer').hidden = true;
    document.getElementById('call-timer').textContent = '00:00';
    state.muted = false; state.camOff = false; state.sharing = false;
    updateCtrlButtons(callType);
    attachLocalVideo();
    // audio-only → hide remote video element, show avatar
    document.getElementById('call-remote').hidden = (callType !== 'video');
    document.getElementById('call-remote-audio').hidden = (callType === 'video');
    showOverlay();
  }

  function updateCtrlButtons(callType) {
    const camBtn = document.getElementById('ctrl-cam');
    const screenBtn = document.getElementById('ctrl-screen');
    const flipBtn = document.getElementById('ctrl-flip');
    const isVideo = callType === 'video';
    camBtn.style.display = isVideo ? '' : 'none';
    // Hide the screen-share button entirely where the browser can't capture a
    // display surface (most phones) so users aren't offered a dead control.
    const canShare = navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function';
    screenBtn.style.display = (isVideo && canShare) ? '' : 'none';
    // Camera flip only makes sense on a video call with more than one camera
    // (i.e. phones with front + back). Hide it until we confirm a 2nd camera.
    flipBtn.style.display = 'none';
    if (isVideo) maybeShowFlip();
    document.getElementById('ctrl-mute').classList.toggle('off', false);
  }

  async function maybeShowFlip() {
    const flipBtn = document.getElementById('ctrl-flip');
    if (!flipBtn) return;
    try {
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== 'function') return;
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter(d => d.kind === 'videoinput');
      // Some browsers only expose a 2nd camera after permission is granted; we
      // call this after getUserMedia so labels/count are reliable here.
      if (cams.length > 1) flipBtn.style.display = '';
    } catch (e) { /* leave hidden */ }
  }

  function cancelOutgoing() {
    if (state.call) api(`/api/calls/${state.call.id}/cancel`, { method: 'POST' }).catch(() => {});
    cleanup();
  }

  // ---------- Incoming ----------
  function onInvite(call) {
    if (state.call) {
      // Already busy → auto-reject.
      api(`/api/calls/${call.id}/reject`, { method: 'POST' }).catch(() => {});
      return;
    }
    state.call = call;
    state.role = 'receiver';
    state.peerUser = call.caller;
    document.getElementById('inc-avatar').innerHTML = avatarMarkup(call.caller);
    document.getElementById('inc-name').textContent = call.caller.name || 'Someone';
    document.getElementById('inc-sub').textContent = (call.call_type === 'video' ? 'Incoming video call…' : 'Incoming audio call…');
    showIncoming();
    state.ringTimer = setTimeout(() => { if (state.role === 'receiver' && state.call && state.call.status === 'ringing') hideIncoming(); }, RING_TIMEOUT_MS + 3000);
  }

  async function acceptIncoming() {
    hideIncoming();
    const callType = state.call.call_type;
    try {
      state.localStream = await getMedia(callType === 'video');
    } catch (e) {
      toast('Could not access your microphone/camera.');
      rejectIncoming();
      return;
    }
    try {
      await api(`/api/calls/${state.call.id}/accept`, { method: 'POST' });
    } catch (e) {
      toast(e.message || 'Could not accept the call.');
      cleanup();
      return;
    }
    setupCallWindow(callType);
    renderPeerInfo();
    setStatus('Connecting…');
    // Receiver waits for the caller's offer; build the peer now.
    state.pc = createPeer();
  }

  function rejectIncoming() {
    hideIncoming();
    if (state.call) api(`/api/calls/${state.call.id}/reject`, { method: 'POST' }).catch(() => {});
    cleanup();
  }

  // ---------- Signaling event handling ----------
  async function onCallEvent({ event, data }) {
    if (event === 'call_invite') { onInvite(data.call); return; }
    if (!state.call) return;
    const cid = data.call ? data.call.id : data.call_id;
    if (cid !== state.call.id) return;

    if (event === 'call_accept') {
      // Caller: peer accepted → create offer.
      clearTimeout(state.ringTimer);
      setStatus('Connecting…');
      state.pc = createPeer();
      const offer = await state.pc.createOffer();
      await state.pc.setLocalDescription(offer);
      signal('webrtc_offer', offer);
      startTimer();
    } else if (event === 'call_reject') {
      toast('Call declined.');
      cleanup();
    } else if (event === 'call_cancel') {
      hideIncoming();
      cleanup();
    } else if (event === 'call_end') {
      cleanup();
    } else if (event === 'call_signal') {
      await onSignal(data);
    }
  }

  async function onSignal(data) {
    const { type, payload, sender_id } = data;
    if (!state.pc && type !== 'webrtc_offer') return;
    if (type === 'webrtc_offer') {
      if (!state.pc) state.pc = createPeer();
      await state.pc.setRemoteDescription(new RTCSessionDescription(payload));
      state.haveRemoteDesc = true;
      await flushCandidates();
      const answer = await state.pc.createAnswer();
      await state.pc.setLocalDescription(answer);
      signal('webrtc_answer', answer);
      if (!state.timer) startTimer();
    } else if (type === 'webrtc_answer') {
      await state.pc.setRemoteDescription(new RTCSessionDescription(payload));
      state.haveRemoteDesc = true;
      await flushCandidates();
    } else if (type === 'ice_candidate') {
      const cand = new RTCIceCandidate(payload);
      if (state.haveRemoteDesc) { try { await state.pc.addIceCandidate(cand); } catch (e) {} }
      else state.pendingCandidates.push(cand);
    } else if (type === 'screen_share_started') {
      setStatus(((state.peerUser && state.peerUser.name) || 'Peer') + ' is sharing screen');
    } else if (type === 'screen_share_stopped') {
      setStatus('Connected');
    }
  }

  // ---------- Controls ----------
  function toggleMute() {
    if (!state.localStream) return;
    state.muted = !state.muted;
    state.localStream.getAudioTracks().forEach(t => t.enabled = !state.muted);
    const b = document.getElementById('ctrl-mute');
    b.classList.toggle('off', state.muted);
    b.querySelector('small').textContent = state.muted ? 'Unmute' : 'Mute';
  }

  function toggleCamera() {
    if (!state.localStream) return;
    const vids = state.localStream.getVideoTracks();
    if (!vids.length) return;
    state.camOff = !state.camOff;
    vids.forEach(t => t.enabled = !state.camOff);
    const b = document.getElementById('ctrl-cam');
    b.classList.toggle('off', state.camOff);
  }

  async function switchCamera() {
    if (!state.localStream) return;
    if (state.sharing) { toast('Stop screen sharing to switch camera.'); return; }
    const curVid = state.localStream.getVideoTracks()[0];
    if (!curVid) { toast('Camera switch needs a video call.'); return; }

    const flipBtn = document.getElementById('ctrl-flip');
    if (flipBtn) { flipBtn.classList.add('off'); flipBtn.disabled = true; }

    const next = state.facingMode === 'user' ? 'environment' : 'user';
    const settings = (curVid.getSettings && curVid.getSettings()) || {};
    const curDeviceId = settings.deviceId;

    // Build an ordered list of constraint sets to try — most reliable first.
    // `facingMode: { ideal }` is too weak on Android (it frequently hands back
    // the SAME lens), so we first target a concrete *different* deviceId, then
    // fall back to an exact facingMode, then a soft one.
    const attempts = [];
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter(d => d.kind === 'videoinput');
      const wantBack = next === 'environment';
      let target = cams.find(c => {
        const l = (c.label || '').toLowerCase();
        return c.deviceId && c.deviceId !== curDeviceId &&
          (wantBack ? /(back|rear|environment)/.test(l) : /(front|user|face)/.test(l));
      });
      if (!target) target = cams.find(c => c.deviceId && c.deviceId !== curDeviceId);
      if (target) attempts.push({ audio: false, video: { deviceId: { exact: target.deviceId } } });
    } catch (e) { /* enumerateDevices unavailable — rely on facingMode */ }
    attempts.push({ audio: false, video: { facingMode: { exact: next } } });
    attempts.push({ audio: false, video: { facingMode: { ideal: next }, width: { ideal: 1280 }, height: { ideal: 720 } } });

    // Release the current camera FIRST — many phones can't open both the front
    // and back lens simultaneously, so acquiring the new one fails otherwise.
    state.localStream.removeTrack(curVid);
    curVid.stop();

    let newStream = null;
    for (const c of attempts) {
      try { newStream = await navigator.mediaDevices.getUserMedia(c); if (newStream) break; }
      catch (e) { newStream = null; }
    }

    const applyTrack = async (track, facing) => {
      track.enabled = !state.camOff;
      const sender = state.pc && state.pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) { try { await sender.replaceTrack(track); } catch (e) {} }
      state.localStream.addTrack(track);
      state.facingMode = facing;
      const lv = document.getElementById('call-local');
      if (lv) lv.srcObject = state.localStream;
    };

    const newTrack = newStream && newStream.getVideoTracks()[0];
    if (!newTrack) {
      // Couldn't get the other camera — restore the original so video continues.
      try {
        const back = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: state.facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        const bt = back.getVideoTracks()[0];
        if (bt) await applyTrack(bt, state.facingMode);
      } catch (e) {}
      if (flipBtn) { flipBtn.classList.remove('off'); flipBtn.disabled = false; }
      toast('Could not switch camera on this device.');
      return;
    }

    await applyTrack(newTrack, next);
    if (flipBtn) { flipBtn.classList.remove('off'); flipBtn.disabled = false; }
  }

  async function toggleScreen() {
    if (!state.pc) return;
    const sender = state.pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if (!sender) { toast('Screen share needs a video call.'); return; }
    if (!state.sharing) {
      // Most mobile browsers (iOS Safari, most Android Chrome) do not expose
      // getDisplayMedia, so screen sharing simply isn't available there.
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
        toast('Screen sharing isn\u2019t supported on this device or browser.');
        return;
      }
      let screen;
      try {
        screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
      } catch (e) {
        // NotAllowedError from a real picker = user cancelled (stay silent).
        // Anything else (NotSupportedError, etc.) = surface a hint.
        if (e && e.name && e.name !== 'NotAllowedError' && e.name !== 'AbortError') {
          toast('Screen sharing isn\u2019t available on this device.');
        }
        return;
      }
      state.screenStream = screen;
      const screenTrack = screen.getVideoTracks()[0];
      state.cameraTrack = sender.track;
      await sender.replaceTrack(screenTrack);
      state.sharing = true;
      document.getElementById('ctrl-screen').classList.add('off');
      signal('screen_share_started', {});
      // Local preview shows the shared screen
      const lv = document.getElementById('call-local');
      lv.srcObject = new MediaStream([screenTrack]);
      screenTrack.onended = () => stopScreen(sender);
    } else {
      stopScreen(sender);
    }
  }

  async function stopScreen(sender) {
    if (!state.sharing) return;
    try {
      if (state.cameraTrack) await sender.replaceTrack(state.cameraTrack);
    } catch (e) {}
    if (state.screenStream) state.screenStream.getTracks().forEach(t => t.stop());
    state.screenStream = null;
    state.sharing = false;
    document.getElementById('ctrl-screen').classList.remove('off');
    signal('screen_share_stopped', {});
    attachLocalVideo();
  }

  // ---------- End / cleanup ----------
  async function endCall(notifyServer) {
    if (state.call && notifyServer) {
      try { await api(`/api/calls/${state.call.id}/end`, { method: 'POST' }); } catch (e) {}
    }
    cleanup();
  }

  function stopLocal() {
    if (state.localStream) state.localStream.getTracks().forEach(t => t.stop());
    if (state.screenStream) state.screenStream.getTracks().forEach(t => t.stop());
  }

  function cleanup() {
    clearTimeout(state.ringTimer);
    clearTimeout(state.timer);
    clearInterval(state.timer);
    if (state.pc) { try { state.pc.ontrack = null; state.pc.onicecandidate = null; state.pc.close(); } catch (e) {} }
    stopLocal();
    hideOverlay();
    hideIncoming();
    const rv = document.getElementById('call-remote'); if (rv) rv.srcObject = null;
    const lv = document.getElementById('call-local'); if (lv) lv.srcObject = null;
    Object.assign(state, {
      call: null, role: null, peerUser: null, pc: null, localStream: null, remoteStream: null,
      cameraTrack: null, screenStream: null, pendingCandidates: [], haveRemoteDesc: false,
      timer: null, ringTimer: null, startedAt: null, muted: false, camOff: false, sharing: false,
      facingMode: 'user',
    });
    // Refresh call logs in any open conversation.
    if (window.__onCallEnded) try { window.__onCallEnded(); } catch (e) {}
  }

  // ---------- Wire up ----------
  function init() {
    buildUI();
    RT.on('call', onCallEvent);
    window.addEventListener('beforeunload', () => { if (state.call) { try { navigator.sendBeacon && endCall(true); } catch (e) {} } });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.CallUI = { startCall };
})();
