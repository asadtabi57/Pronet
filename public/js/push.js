// public/js/push.js — Web Push client. Handles permission + subscription and
// registers the device with the server so it receives OS notifications for
// messages, calls, reactions, etc. (even when the app is closed).
(function () {
  'use strict';

  function supported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  async function getServerKey() {
    try {
      const r = await fetch('/api/push/vapid-public-key');
      const j = await r.json();
      return j.key || null;
    } catch (e) { return null; }
  }

  // Subscribe this device. Returns true on success.
  async function subscribe() {
    if (!supported()) return false;
    const key = await getServerKey();
    if (!key) return false;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
    }
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ subscription: sub.toJSON ? sub.toJSON() : sub }),
    });
    return true;
  }

  // User-initiated enable: asks permission, then subscribes.
  async function enable(buttonEl) {
    if (!supported()) {
      if (window.toast) toast('Notifications are not supported on this browser.');
      return false;
    }
    if (buttonEl) buttonEl.disabled = true;
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        if (window.toast) toast('Enable notifications in your browser settings to get alerts.');
        return false;
      }
      const ok = await subscribe();
      if (ok && window.toast) toast('Notifications on 🔔');
      reflectButton(buttonEl);
      return ok;
    } catch (e) {
      if (window.toast) toast('Could not enable notifications.');
      return false;
    } finally { if (buttonEl) buttonEl.disabled = false; }
  }

  // Show/hide & label a toggle button based on current permission state.
  function reflectButton(buttonEl) {
    if (!buttonEl) return;
    if (!supported()) { buttonEl.hidden = true; return; }
    if (Notification.permission === 'granted') {
      buttonEl.hidden = true; // already on
    } else if (Notification.permission === 'denied') {
      buttonEl.hidden = false;
      buttonEl.textContent = '🔕 Alerts blocked';
      buttonEl.disabled = true;
    } else {
      buttonEl.hidden = false;
      buttonEl.textContent = '🔔 Turn on alerts';
      buttonEl.disabled = false;
    }
  }

  // Auto re-subscribe silently on load if permission was already granted (keeps
  // the server's stored subscription fresh after deploys / token rotation).
  function autoResume() {
    if (!supported()) return;
    if (Notification.permission === 'granted') subscribe().catch(() => {});
    maybeOnboard();
  }

  // ---- First-login onboarding: stay signed in + enable notifications ----
  function onboarded() { try { return localStorage.getItem('pn_onboarded') === '1'; } catch (e) { return false; } }
  function setOnboarded() { try { localStorage.setItem('pn_onboarded', '1'); } catch (e) {} }
  function isAuthed() { try { return window.Session && Session.isAuthed(); } catch (e) { return false; } }
  function appMode() {
    try { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; }
    catch (e) { return false; }
  }
  function maybeOnboard() {
    if (!supported() || !isAuthed() || onboarded()) return;
    // Only on authenticated app pages (avoid landing/auth screens).
    if (!document.getElementById('top-nav')) return;
    // If the user already decided on notifications, don't nag.
    if (Notification.permission !== 'default') { setOnboarded(); return; }
    setTimeout(showOnboard, 1200);
  }
  function showOnboard() {
    if (document.querySelector('.pn-onboard-back')) return;
    const me = (window.getMe && getMe()) || {};
    const name = (me.name || '').split(' ')[0] || 'there';
    const stayLine = appMode()
      ? `<li><span class="pn-ob-ic">🔒</span> You'll <b>stay signed in</b> on this device — no need to log in again.</li>`
      : '';
    const back = document.createElement('div');
    back.className = 'pn-onboard-back';
    back.innerHTML = `
      <div class="pn-onboard">
        <div class="pn-ob-logo"><svg viewBox="0 0 512 512" aria-hidden="true"><defs><linearGradient id="obMintGlow" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#34d399"/><stop offset="100%" stop-color="#059669"/></linearGradient></defs><rect x="32" y="32" width="448" height="448" rx="128" fill="#4f46e5"/><rect x="136" y="196" width="140" height="120" rx="60" fill="none" stroke="#ffffff" stroke-width="32"/><rect x="236" y="196" width="140" height="120" rx="60" fill="none" stroke="url(#obMintGlow)" stroke-width="32"/><circle cx="256" cy="256" r="14" fill="#ffffff"/></svg></div>
        <h3>You're all set, ${escapeHtml(name)}! 🎉</h3>
        <ul class="pn-ob-list">
          ${stayLine}
          <li><span class="pn-ob-ic">🔔</span> Turn on <b>notifications</b> so you never miss a message or call — even when the app is closed.</li>
        </ul>
        <button class="pn-ob-primary" id="pn-ob-enable">Turn on notifications</button>
        <button class="pn-ob-later" id="pn-ob-later">Maybe later</button>
      </div>`;
    document.body.appendChild(back);
    requestAnimationFrame(() => back.classList.add('show'));
    const close = () => { back.classList.remove('show'); setTimeout(() => back.remove(), 220); };
    back.querySelector('#pn-ob-enable').onclick = async () => {
      const btn = back.querySelector('#pn-ob-enable');
      btn.disabled = true; btn.textContent = 'Enabling…';
      await enable();
      setOnboarded(); close();
    };
    back.querySelector('#pn-ob-later').onclick = () => { setOnboarded(); close(); };
  }
  function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoResume);
  else autoResume();

  window.ConnectikPush = { supported, enable, subscribe, reflectButton, showOnboard };
})();
