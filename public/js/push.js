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
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoResume);
  else autoResume();

  window.PronetPush = { supported, enable, subscribe, reflectButton };
})();
