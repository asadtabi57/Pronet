// ==========================================================================
// Connectik Gateway engine — landing/login page only. Pure presentation:
// renders the live node canvas, drives the Interactive Link Visualizer state
// machine, routes the landing tabs (SPA panels) and runs the post-auth launch
// transition. It never talks to the API and never touches Session state —
// auth logic lives in the inline page script exactly as before.
// ==========================================================================
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ------------------------------------------------------------------
  // 1) Live network canvas — ~24 drifting nodes, linked under 85px.
  //    rAF loop, resize-safe (DPR aware), paused while the tab is hidden.
  // ------------------------------------------------------------------
  function startCanvas() {
    const canvas = $('#nodes-canvas');
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext('2d');

    const NODE_COUNT = 24;
    const LINK_DIST = 85;
    let W = 0, H = 0, dpr = 1;
    let nodes = [];
    let rafId = 0;
    let running = false;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2); // cap DPR: sharpness vs fill-rate
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function seed() {
      nodes = [];
      for (let i = 0; i < NODE_COUNT; i++) {
        nodes.push({
          x: Math.random() * W,
          y: Math.random() * H,
          vx: (Math.random() - 0.5) * 0.4,
          vy: (Math.random() - 0.5) * 0.4,
          r: Math.random() * 2 + 1,
        });
      }
    }

    function frame() {
      ctx.clearRect(0, 0, W, H);
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        // links first so dots paint on top
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < LINK_DIST * LINK_DIST) {
            const t = 1 - Math.sqrt(d2) / LINK_DIST;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = 'rgba(52, 211, 153, ' + (0.09 * t).toFixed(3) + ')';
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
        a.x += a.vx; a.y += a.vy;
        if (a.x < 0 || a.x > W) a.vx *= -1;
        if (a.y < 0 || a.y > H) a.vy *= -1;
        ctx.beginPath();
        ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(52, 211, 153, 0.4)';
        ctx.fill();
      }
      rafId = requestAnimationFrame(frame);
    }

    function play() { if (!running) { running = true; rafId = requestAnimationFrame(frame); } }
    function pause() { running = false; cancelAnimationFrame(rafId); }

    resize();
    seed();
    if (reducedMotion) { frame(); pause(); return; } // single static paint
    play();

    let resizeT = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeT);
      resizeT = setTimeout(() => { resize(); seed(); }, 150);
    });
    // Battery friendliness: no rendering while the tab is hidden.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') play(); else pause();
    });
  }

  // ------------------------------------------------------------------
  // 2) Interactive Link Visualizer state machine.
  //    idle → email (links approach) → password (nearly touching)
  //    → merged (snap + hub pop, on successful auth). Driven by focus
  //    and input events on the real login fields.
  // ------------------------------------------------------------------
  const viz = {
    el: null,
    state: 'idle',
    set(state) {
      if (!this.el || this.state === state) return;
      this.state = state;
      if (state === 'idle') this.el.removeAttribute('data-state');
      else this.el.setAttribute('data-state', state);
    },
    deny() {
      if (!this.el) return;
      this.el.classList.remove('gw-deny');
      void this.el.offsetWidth; // restart the shake animation
      this.el.classList.add('gw-deny');
      setTimeout(() => this.el && this.el.classList.remove('gw-deny'), 500);
    },
  };

  function wireVisualizer() {
    viz.el = $('#link-visualizer');
    if (!viz.el) return;
    const email = $('#email');
    const password = $('#password');
    if (email) {
      email.addEventListener('focus', () => { if (viz.state !== 'merged') viz.set('email'); });
      email.addEventListener('input', () => {
        if (viz.state === 'merged') return;
        // Progress nudge: a plausible email pulls the links a step closer.
        viz.set(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim()) ? 'password' : 'email');
      });
    }
    if (password) {
      password.addEventListener('focus', () => { if (viz.state !== 'merged') viz.set('password'); });
    }
  }

  // ------------------------------------------------------------------
  // 3) Landing tab router — SPA panel switching for the gateway page.
  //    Buttons carry data-panel="home|about|features|contact"; panes are
  //    #panel-<name>. Active chip + instant pane swap, hash-addressable.
  // ------------------------------------------------------------------
  function wireTabs() {
    const tabs = Array.from(document.querySelectorAll('.gw-tab[data-panel]'));
    if (!tabs.length) return;
    const panels = Array.from(document.querySelectorAll('.gw-panel'));

    function show(name, push) {
      let found = false;
      panels.forEach(p => {
        const on = p.id === 'panel-' + name;
        p.classList.toggle('active', on);
        if (on) found = true;
      });
      if (!found) return; // unknown hash → leave as-is
      tabs.forEach(t => t.classList.toggle('active', t.dataset.panel === name));
      if (push) {
        try { history.replaceState(null, '', name === 'home' ? location.pathname : '#' + name); } catch (e) {}
      }
      window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
    }

    tabs.forEach(t => t.addEventListener('click', (e) => {
      e.preventDefault();
      show(t.dataset.panel, true);
    }));

    // Deep links (/#about etc.) and back/forward.
    const fromHash = () => {
      const h = (location.hash || '').replace('#', '');
      show(h && $('#panel-' + h) ? h : 'home', false);
    };
    window.addEventListener('hashchange', fromHash);
    if (location.hash) fromHash();
  }

  // ------------------------------------------------------------------
  // 4) Launch sequence — called by the page's auth script on success.
  //    Snaps the links together, pops the hub, fades the gateway out and
  //    reveals the #app-shell, then hands off to the real dashboard.
  // ------------------------------------------------------------------
  let launching = false;
  function launch(href) {
    const dest = href || '/feed.html';
    if (launching) return;
    launching = true;
    const shell = $('#app-shell');
    viz.set('merged');
    document.body.classList.add('gw-launching');
    const reveal = () => {
      if (shell) {
        shell.hidden = false;
        requestAnimationFrame(() => shell.classList.add('show'));
      }
      setTimeout(() => { location.href = dest; }, reducedMotion ? 80 : 950);
    };
    // Let the merge + hub pop play before swapping views.
    setTimeout(reveal, reducedMotion ? 0 : 650);
  }

  function init() {
    startCanvas();
    wireVisualizer();
    wireTabs();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Public hooks for the page's auth script.
  window.Gateway = {
    launch,
    deny() { viz.deny(); },
    reset() { viz.set('idle'); },
  };
})();
