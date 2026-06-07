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

  // Reload once the new SW takes control.
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    location.reload();
  });

  function showUpdateToast(reg) {
    const bar = document.createElement('div');
    bar.className = 'pwa-update-bar';
    bar.innerHTML = `<span>A new version of Pronet is available.</span><button>Update</button>`;
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
    try { if (window.toast) toast('Pronet installed 🎉'); } catch (e) {}
  });

  // Exposed so the mobile shell (or a settings menu) can trigger install.
  window.promptInstall = async function () {
    if (!deferredPrompt) {
      // iOS / unsupported: guide the user.
      const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
      if (isIOS) alert('To install Pronet: tap the Share button, then "Add to Home Screen".');
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
})();
