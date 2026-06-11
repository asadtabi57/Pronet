// PWA bootstrap: registers the service worker, offers a custom install prompt,
// and surfaces an "update available" refresh when a new version deploys.
(function () {
  'use strict';
  if (!('serviceWorker' in navigator)) return;

  let deferredPrompt = null;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      // Detect an updated worker waiting to take over.
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateToast(reg);
          }
        });
      });
    }).catch(() => {});
  });

  // Reload once a NEW SW replaces an old one (deploy update). On the very
  // first install there was no previous controller — the live page is already
  // current, so reloading would only abort its in-flight API calls.
  let refreshing = false;
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; }
    if (refreshing) return;
    refreshing = true;
    location.reload();
  });

  function showUpdateToast(reg) {
    const bar = document.createElement('div');
    bar.className = 'pwa-update-bar';
    bar.innerHTML = `<span>A new version of Connectik is available.</span><button>Update</button>`;
    document.body.appendChild(bar);
    requestAnimationFrame(() => bar.classList.add('show'));
    bar.querySelector('button').onclick = () => {
      if (reg.waiting) reg.waiting.postMessage('SKIP_WAITING');
      bar.remove();
    };
    setTimeout(() => bar.classList.remove('show'), 12000);
  }

  // ---- Custom install prompt ----
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    window.__canInstallPWA = true;
    document.dispatchEvent(new CustomEvent('pwa-installable'));
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    window.__canInstallPWA = false;
    try { if (window.toast) toast('Connectik installed 🎉'); } catch (e) {}
  });

  // Exposed so the mobile shell (or a settings menu) can trigger install.
  window.promptInstall = async function () {
    if (!deferredPrompt) {
      // iOS / unsupported: guide the user.
      const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
      if (isIOS) alert('To install Connectik: tap the Share button, then "Add to Home Screen".');
      else if (window.toast) toast('Install isn\'t available right now. Open the browser menu → Install app.');
      return;
    }
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch (e) {}
    deferredPrompt = null;
    window.__canInstallPWA = false;
  };

  // True when running as an installed app (standalone display mode).
  window.isStandalonePWA = function () {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
  };

  // ---- iOS one-time "Add to Home Screen" hint ----
  // iOS has no install prompt, so we coach the user. Shown once per device, only
  // on the actual app pages, and never when already installed.
  function isIOS() {
    const ua = navigator.userAgent || '';
    const iDevice = /iphone|ipad|ipod/i.test(ua);
    const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    return iDevice || iPadOS;
  }
  function showIOSInstallHint() {
    if (document.querySelector('.ios-hint-back')) return;
    const isChrome = /CriOS|EdgiOS|FxiOS/i.test(navigator.userAgent);
    const where = isChrome ? 'in the browser menu (•••)' : 'in the bottom toolbar';
    const logo = '<svg viewBox="0 0 512 512" aria-hidden="true"><defs><linearGradient id="iosMint" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#34d399"/><stop offset="100%" stop-color="#059669"/></linearGradient></defs><rect x="32" y="32" width="448" height="448" rx="128" fill="#4f46e5"/><rect x="136" y="196" width="140" height="120" rx="60" fill="none" stroke="#ffffff" stroke-width="32"/><rect x="236" y="196" width="140" height="120" rx="60" fill="none" stroke="url(#iosMint)" stroke-width="32"/><circle cx="256" cy="256" r="14" fill="#ffffff"/></svg>';
    const back = document.createElement('div');
    back.className = 'ios-hint-back';
    back.innerHTML =
      '<div class="ios-hint-sheet" role="dialog" aria-label="Install Connectik">' +
        '<button class="ios-hint-x" aria-label="Close">×</button>' +
        '<div class="ios-hint-logo">' + logo + '</div>' +
        '<h3>Install Connectik</h3>' +
        '<p>Add Connectik to your Home Screen for a full-screen app with notifications.</p>' +
        '<ol class="ios-hint-steps">' +
          '<li>Tap the <strong>Share</strong> icon ' +
            '<span class="ios-share-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="M8 8l4-4 4 4"/><path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></svg></span> ' + where + '</li>' +
          '<li>Choose <strong>Add to Home Screen</strong></li>' +
          '<li>Tap <strong>Add</strong></li>' +
        '</ol>' +
        '<button class="ios-hint-ok">Got it</button>' +
      '</div>';
    document.body.appendChild(back);
    // Mark as shown for this session immediately — the hint must not re-stack
    // on every page navigation when the user ignores it without dismissing.
    try { sessionStorage.setItem('connectik_ios_hint_shown', '1'); } catch (e) {}
    requestAnimationFrame(() => back.classList.add('show'));
    const close = () => {
      try { localStorage.setItem('connectik_ios_hint', '1'); } catch (e) {}
      back.classList.remove('show');
      setTimeout(() => back.remove(), 300);
    };
    back.querySelector('.ios-hint-x').onclick = close;
    back.querySelector('.ios-hint-ok').onclick = close;
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
  }
  function maybeIOSHint() {
    try {
      if (!isIOS()) return;
      if (window.isStandalonePWA && window.isStandalonePWA()) return;
      if (localStorage.getItem('connectik_ios_hint') === '1') return;
      if (sessionStorage.getItem('connectik_ios_hint_shown') === '1') return;
      const p = location.pathname;
      if (p === '/' || /\/(index|signup|verify-email|install)\.html$/.test(p)) return; // skip public pages
      setTimeout(showIOSInstallHint, 2500);
    } catch (e) {}
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybeIOSHint);
  } else {
    maybeIOSHint();
  }
  // Let other code (e.g. a Settings menu) re-trigger the hint on demand.
  window.showIOSInstallHint = showIOSInstallHint;
})();
