// public/js/ai.js — shared client for Pronet's AI features.
// Depends on app.js globals: api(), toast(), escapeHTML(), confirmDialog().
// Exposes window.AI with capability detection + small reusable UI helpers.
(function () {
  'use strict';

  const SPARKLE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 2l1.6 4.6L18 8.2l-4.4 1.6L12 14l-1.6-4.2L6 8.2l4.4-1.6L12 2zm6 10l.9 2.5L21 15.4l-2.1.9L18 19l-.9-2.7-2.1-.9 2.1-.9L18 12zM6 14l.8 2.2L9 17l-2.2.8L6 20l-.8-2.2L3 17l2.2-.8L6 14z"/></svg>';

  let _status = null;       // cached /api/ai/status
  let _statusPromise = null;

  async function status() {
    if (_status) return _status;
    if (_statusPromise) return _statusPromise;
    _statusPromise = api('/api/ai/status')
      .then(s => { _status = s; return s; })
      .catch(() => ({ enabled: false, features: {}, vector_search: false }));
    return _statusPromise;
  }
  async function enabled() { return (await status()).enabled === true; }
  async function feature(name) { const s = await status(); return !!(s.features && s.features[name]); }

  // A small "✨ AI" button element (consistent styling via .ai-btn).
  function sparkleButton(label, opts = {}) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ai-btn' + (opts.tiny ? ' ai-btn-tiny' : '') + (opts.className ? ' ' + opts.className : '');
    b.innerHTML = SPARKLE + (label ? `<span>${escapeHTML(label)}</span>` : '');
    if (opts.title) b.title = opts.title;
    return b;
  }

  // Generic AI assistant popover, built on the app modal system but bespoke so
  // it can show loading → result with Insert / Regenerate / Copy actions.
  // config: { title, run: async () => text, onInsert: (text)=>void, insertLabel }
  function assistant(config) {
    const { title = 'AI Assistant', run, onInsert, insertLabel = 'Use this', allowEdit = true } = config;
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop ai-modal-backdrop';
    wrap.innerHTML = `
      <div class="modal ai-modal" role="dialog" aria-modal="true">
        <div class="modal-head"><h3>${SPARKLE} ${escapeHTML(title)}</h3><button class="ai-x" aria-label="Close">×</button></div>
        <div class="modal-body ai-modal-body">
          <div class="ai-loading"><span class="ai-spinner"></span> Thinking…</div>
          <textarea class="ai-result" hidden></textarea>
          <div class="ai-error" hidden></div>
        </div>
        <div class="modal-foot ai-modal-foot" hidden>
          <button type="button" class="btn-tiny ghost ai-regenerate">↻ Regenerate</button>
          <span style="flex:1"></span>
          <button type="button" class="btn-tiny ai-copy">Copy</button>
          <button type="button" class="btn-fill ai-insert">${escapeHTML(insertLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    const loading = wrap.querySelector('.ai-loading');
    const result = wrap.querySelector('.ai-result');
    const errBox = wrap.querySelector('.ai-error');
    const foot = wrap.querySelector('.ai-modal-foot');
    const close = () => wrap.remove();
    wrap.querySelector('.ai-x').onclick = close;
    wrap.addEventListener('click', e => { if (e.target === wrap) close(); });

    result.readOnly = !allowEdit;

    async function go() {
      loading.hidden = false; result.hidden = true; errBox.hidden = true; foot.hidden = true;
      try {
        const text = await run();
        loading.hidden = true;
        if (!text) throw new Error('No suggestion was generated.');
        result.value = text; result.hidden = false; foot.hidden = false;
        autoGrow(result);
      } catch (e) {
        loading.hidden = true; errBox.hidden = false;
        errBox.textContent = (e && e.message) || 'AI request failed.';
      }
    }
    wrap.querySelector('.ai-regenerate').onclick = go;
    wrap.querySelector('.ai-copy').onclick = () => {
      navigator.clipboard && navigator.clipboard.writeText(result.value).then(() => toast('Copied'), () => {});
    };
    wrap.querySelector('.ai-insert').onclick = () => {
      const v = result.value.trim();
      if (onInsert) onInsert(v);
      close();
    };
    result.addEventListener('input', () => autoGrow(result));
    go();
    return { close };
  }

  function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 320) + 'px'; }

  // Tone Guardian helper: returns true if it's OK to proceed (either clean, or
  // the user chose to post anyway). Never blocks if AI is unavailable.
  async function tonePrecheck(text) {
    try {
      const r = await api('/api/ai/check-tone', { method: 'POST', body: { text } });
      if (!r || !r.flagged) return true;
      return await confirmDialog({
        title: 'Keep it professional?',
        message: (r.reason ? r.reason + ' ' : '') + 'Pronet is a professional space. Post anyway?',
        confirmText: 'Post anyway', cancelText: 'Let me edit',
      });
    } catch (e) { return true; }
  }

  window.AI = { SPARKLE, status, enabled, feature, sparkleButton, assistant, tonePrecheck };
})();
