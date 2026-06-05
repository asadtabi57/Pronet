// public/js/ats.js — ATS Resume Analyzer.
// Extracts text from the uploaded PDF entirely in the browser using pdf.js
// (loaded on demand from a CDN), then asks the backend (Gemini) for an ATS
// score and an optionally job-tailored, ATS-optimized rewrite. $0 server cost,
// and the raw PDF never leaves the user's machine — only extracted text is sent.
(function () {
  'use strict';

  const card = document.getElementById('ats-card');
  if (!card) return;

  const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const drop = document.getElementById('ats-drop');
  const fileInput = document.getElementById('ats-file');
  const fileNameEl = document.getElementById('ats-filename');
  const jdEl = document.getElementById('ats-jd');
  const analyzeBtn = document.getElementById('ats-analyze');
  const noteEl = document.getElementById('ats-note');
  const setup = document.getElementById('ats-setup');
  const resultEl = document.getElementById('ats-result');

  let resumeText = '';
  let resumeFileName = '';

  // Hide the whole feature if AI is unavailable.
  if (window.AI) AI.feature('ats').then(on => {
    if (!on) { const s = document.getElementById('ats-section'); if (s) noteEl.textContent = 'AI features are not configured yet.'; }
  });

  // ---- pdf.js lazy loader ----
  let pdfjsReady = null;
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pdfjsReady) return pdfjsReady;
    pdfjsReady = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PDFJS_URL;
      s.onload = () => {
        if (window.pdfjsLib) { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; resolve(window.pdfjsLib); }
        else reject(new Error('pdf.js failed to load'));
      };
      s.onerror = () => reject(new Error('Could not load the PDF reader. Check your connection.'));
      document.head.appendChild(s);
    });
    return pdfjsReady;
  }

  async function extractText(file) {
    const pdfjsLib = await loadPdfJs();
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(it => it.str).join(' ') + '\n';
    }
    return text.replace(/\s+\n/g, '\n').trim();
  }

  async function handleFile(file) {
    if (!file) return;
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) { toast('Please upload a PDF file.'); return; }
    if (file.size > 5 * 1024 * 1024) { toast('Resume must be under 5 MB.'); return; }
    resumeFileName = file.name;
    fileNameEl.textContent = file.name;
    noteEl.textContent = 'Reading your resume…';
    analyzeBtn.disabled = true;
    try {
      resumeText = await extractText(file);
      if (resumeText.length < 60) {
        noteEl.textContent = '⚠️ This looks like a scanned/image PDF — we could not read its text. Please upload a text-based PDF.';
        analyzeBtn.disabled = true; return;
      }
      drop.classList.add('has-file');
      noteEl.textContent = `✓ Loaded ${Math.round(resumeText.length / 5)} words. Ready to analyze.`;
      analyzeBtn.disabled = false;
    } catch (e) {
      noteEl.textContent = '⚠️ ' + (e.message || 'Could not read the PDF.');
      analyzeBtn.disabled = true;
    }
  }

  drop.onclick = () => fileInput.click();
  fileInput.onchange = () => handleFile(fileInput.files[0]);
  ['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('drag'); }));
  drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });

  // ---- Analyze ----
  analyzeBtn.onclick = async () => {
    if (!resumeText) { toast('Upload a resume first.'); return; }
    analyzeBtn.disabled = true; analyzeBtn.textContent = 'Analyzing…';
    resultEl.hidden = false;
    resultEl.innerHTML = `<div class="ai-loading"><span class="ai-spinner"></span> Scoring your resume against the job…</div>`;
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    try {
      const r = await api('/api/ai/ats-score', { method: 'POST', body: { resumeText, jobDescription: jdEl.value.trim() } });
      renderScore(r);
    } catch (e) {
      resultEl.innerHTML = `<div class="ai-error">${escapeHTML(e.message || 'Could not analyze the resume.')}</div>`;
    } finally { analyzeBtn.disabled = false; analyzeBtn.textContent = 'Analyze my resume'; }
  };

  function bar(label, val) {
    const cls = val >= 75 ? 'good' : val >= 50 ? 'ok' : 'low';
    return `<div class="ats-bar-row"><span class="ats-bar-label">${label}</span>
      <span class="ats-bar"><span class="ats-bar-fill ${cls}" style="width:${val}%"></span></span>
      <span class="ats-bar-val">${val}</span></div>`;
  }
  function chips(arr, cls) { return (arr || []).map(k => `<span class="ats-chip ${cls}">${escapeHTML(k)}</span>`).join('') || '<span class="muted">—</span>'; }

  function renderScore(r) {
    const ring = r.score >= 75 ? 'good' : r.score >= 50 ? 'ok' : 'low';
    const b = r.breakdown || {};
    resultEl.innerHTML = `
      <div class="ats-scorecard">
        <div class="ats-ring ${ring}" style="--pct:${r.score}"><span>${r.score}</span><small>ATS</small></div>
        <div class="ats-score-body">
          <p class="ats-summary">${escapeHTML(r.summary || '')}</p>
          <div class="ats-bars">
            ${bar('Keywords', b.keywords || 0)}
            ${bar('Skills match', b.skills_match || 0)}
            ${bar('Formatting', b.formatting || 0)}
            ${bar('Experience', b.experience || 0)}
          </div>
        </div>
      </div>
      <div class="ats-cols">
        <div class="ats-col">
          <h4>✅ Matched keywords</h4><div class="ats-chips">${chips(r.matched_keywords, 'match')}</div>
        </div>
        <div class="ats-col">
          <h4>❌ Missing keywords</h4><div class="ats-chips">${chips(r.missing_keywords, 'miss')}</div>
        </div>
      </div>
      ${(r.improvements && r.improvements.length) ? `<div class="ats-tips"><h4>💡 Suggestions</h4><ul>${r.improvements.map(s => `<li>${escapeHTML(s)}</li>`).join('')}</ul></div>` : ''}
      <div class="ats-cta">
        <button class="ai-btn" id="ats-tailor-btn">✨ <span>Generate ATS-tailored resume</span></button>
        <button class="btn-tiny ghost" id="ats-reset">Analyze another</button>
      </div>
      <div id="ats-tailored"></div>`;

    document.getElementById('ats-reset').onclick = () => {
      resultEl.hidden = true; resultEl.innerHTML = '';
      resumeText = ''; resumeFileName = ''; drop.classList.remove('has-file');
      fileNameEl.textContent = 'Upload your resume (PDF)'; noteEl.textContent = ''; fileInput.value = '';
      analyzeBtn.disabled = true; setup.scrollIntoView({ behavior: 'smooth' });
    };
    document.getElementById('ats-tailor-btn').onclick = runTailor;
  }

  async function runTailor() {
    const out = document.getElementById('ats-tailored');
    const btn = document.getElementById('ats-tailor-btn');
    if (btn) btn.disabled = true;
    out.innerHTML = `<div class="ai-loading"><span class="ai-spinner"></span> Rewriting your resume for ATS…</div>`;
    try {
      const r = await api('/api/ai/ats-tailor', { method: 'POST', body: { resumeText, jobDescription: jdEl.value.trim() } });
      out.innerHTML = `
        <div class="ats-tailored-wrap">
          <div class="ats-tailored-head"><h4>✨ Your ATS-tailored resume</h4>
            <div class="ats-tailored-actions">
              <button class="btn-tiny" id="ats-copy">Copy</button>
              <button class="btn-tiny" id="ats-download">Download .txt</button>
            </div>
          </div>
          <textarea class="ats-tailored-text" id="ats-tailored-text" spellcheck="false">${escapeHTML(r.resume)}</textarea>
        </div>`;
      const ta = document.getElementById('ats-tailored-text');
      ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 600) + 'px';
      document.getElementById('ats-copy').onclick = () => {
        navigator.clipboard && navigator.clipboard.writeText(ta.value).then(() => toast('Copied!'), () => {});
      };
      document.getElementById('ats-download').onclick = () => {
        const blob = new Blob([ta.value], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (resumeFileName.replace(/\.pdf$/i, '') || 'resume') + '-ATS.txt';
        a.click(); URL.revokeObjectURL(a.href);
      };
      out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) {
      out.innerHTML = `<div class="ai-error">${escapeHTML(e.message || 'Could not generate the tailored resume.')}</div>`;
    } finally { if (btn) btn.disabled = false; }
  }
})();
