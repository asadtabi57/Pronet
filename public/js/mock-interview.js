// public/js/mock-interview.js — AI Mock Interview using the browser's free
// Web Speech API for voice in/out, backed by Gemini for the interview logic.
// Degrades gracefully: hides itself if AI isn't enabled; falls back to typing
// if the browser has no SpeechRecognition.
(function () {
  'use strict';

  const card = document.getElementById('mi-card');
  if (!card || !window.AI) return;

  const setup = document.getElementById('mi-setup');
  const live = document.getElementById('mi-live');
  const scoreBox = document.getElementById('mi-score');
  const roleInput = document.getElementById('mi-role');
  const jdInput = document.getElementById('mi-jd');
  const startBtn = document.getElementById('mi-start');
  const transcriptEl = document.getElementById('mi-transcript');
  const answerEl = document.getElementById('mi-answer');
  const micBtn = document.getElementById('mi-mic');
  const sendBtn = document.getElementById('mi-send');
  const endBtn = document.getElementById('mi-end');
  const ttsToggle = document.getElementById('mi-tts');
  const voiceNote = document.getElementById('mi-voice-note');

  let role = '', jobDescription = '';
  const history = []; // [{ role:'interviewer'|'candidate', text }]
  let busy = false;

  // Hide the whole feature if the mock-interview AI feature is off.
  AI.feature('mock_interview').then(on => {
    if (!on) { const sec = document.getElementById('ai-interview-section'); if (sec) sec.style.display = 'none'; }
  });

  // ---- Speech recognition (STT) ----
  // Continuous dictation: browsers kill recognition sessions on short pauses
  // (and Android ends them after every utterance even with continuous=true),
  // so we accumulate finalized text across sessions and auto-restart in onend
  // until the user explicitly taps the mic off. Nothing stops on its own.
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recog = null, listening = false, finalText = '';
  if (SR) {
    recog = new SR();
    recog.continuous = true;
    recog.interimResults = true;
    recog.lang = 'en-US';
    recog.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          finalText = (finalText + ' ' + t).replace(/\s+/g, ' ').trim();
        } else {
          interim += t;
        }
      }
      answerEl.value = (finalText + ' ' + interim).replace(/\s+/g, ' ').trim();
      autoGrow(answerEl);
    };
    recog.onend = () => {
      // Session ended on its own (silence/timeout) while the user still wants
      // to dictate → seamlessly start a fresh session and keep the text.
      if (listening) {
        try { recog.start(); return; } catch (e) { /* fall through to off */ }
      }
      listening = false; micBtn.classList.remove('listening');
    };
    recog.onerror = (e) => {
      // Transient errors (silence, abort, network blip): onend fires next and
      // restarts us. Only hard permission failures turn the mic off.
      if (listening && ['no-speech', 'aborted', 'network'].includes(e.error)) return;
      listening = false; micBtn.classList.remove('listening');
      if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(e.error) && voiceNote) {
        voiceNote.textContent = 'Microphone is blocked — allow mic access in your browser to dictate answers.';
      }
    };
  } else {
    if (voiceNote) voiceNote.textContent = 'Tip: voice input isn\'t supported in this browser — you can type your answers instead.';
    if (micBtn) micBtn.style.display = 'none';
  }

  // ---- Speech synthesis (TTS) ----
  function speak(text) {
    if (!ttsToggle || !ttsToggle.checked) return;
    if (!('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.02; u.pitch = 1.0;
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; }
  answerEl.addEventListener('input', () => autoGrow(answerEl));

  function addBubble(who, text) {
    const div = document.createElement('div');
    div.className = 'mi-bubble ' + (who === 'interviewer' ? 'from-ai' : 'from-me');
    div.innerHTML = `<span class="mi-who">${who === 'interviewer' ? '🧑‍💼 Interviewer' : '🙋 You'}</span>${escapeHTML(text)}`;
    transcriptEl.appendChild(div);
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }

  function setBusy(b) {
    busy = b;
    sendBtn.disabled = b; if (micBtn) micBtn.disabled = b;
    sendBtn.textContent = b ? '…' : 'Send';
  }

  async function nextQuestion() {
    setBusy(true);
    const thinking = document.createElement('div');
    thinking.className = 'mi-bubble from-ai mi-thinking';
    thinking.innerHTML = '<span class="ai-spinner"></span> thinking…';
    transcriptEl.appendChild(thinking);
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
    try {
      const { question } = await api('/api/ai/interview/turn', {
        method: 'POST', body: { role, jobDescription, history },
      });
      thinking.remove();
      history.push({ role: 'interviewer', text: question });
      addBubble('interviewer', question);
      speak(question);
    } catch (e) {
      thinking.remove();
      addBubble('interviewer', '(Could not get the next question: ' + (e.message || 'error') + ')');
    } finally { setBusy(false); }
  }

  async function submitAnswer() {
    if (busy) return;
    const text = answerEl.value.trim();
    if (!text) { answerEl.focus(); return; }
    if (listening && recog) { listening = false; recog.stop(); micBtn.classList.remove('listening'); }
    history.push({ role: 'candidate', text });
    addBubble('candidate', text);
    answerEl.value = ''; finalText = ''; autoGrow(answerEl);
    await nextQuestion();
  }

  // ---- Wire up ----
  startBtn.onclick = async () => {
    role = (roleInput.value || '').trim();
    jobDescription = (jdInput.value || '').trim();
    if (!role && !jobDescription) { toast('Enter a role or paste a job description.'); roleInput.focus(); return; }
    setup.hidden = true; live.hidden = false; scoreBox.hidden = true;
    history.length = 0; transcriptEl.innerHTML = '';
    await nextQuestion();
  };

  sendBtn.onclick = submitAnswer;
  answerEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitAnswer(); }
  });

  if (micBtn && recog) {
    micBtn.onclick = () => {
      if (listening) { listening = false; recog.stop(); micBtn.classList.remove('listening'); return; }
      // Keep anything already typed and append dictation after it.
      finalText = answerEl.value.replace(/\s+/g, ' ').trim();
      try { recog.start(); listening = true; micBtn.classList.add('listening'); }
      catch (e) { listening = false; }
    };
  }

  endBtn.onclick = async () => {
    if (busy) return;
    if (history.filter(h => h.role === 'candidate').length === 0) { toast('Answer at least one question first.'); return; }
    setBusy(true);
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    scoreBox.hidden = false;
    scoreBox.innerHTML = '<div class="ai-loading"><span class="ai-spinner"></span> Scoring your interview…</div>';
    scoreBox.scrollIntoView({ behavior: 'smooth' });
    try {
      const r = await api('/api/ai/interview/score', { method: 'POST', body: { role, history } });
      const strengths = (r.strengths || []).map(s => `<li>${escapeHTML(s)}</li>`).join('');
      const improvements = (r.improvements || []).map(s => `<li>${escapeHTML(s)}</li>`).join('');
      const score = Math.round(r.overall || 0);
      const ring = score >= 75 ? 'good' : score >= 50 ? 'ok' : 'low';
      scoreBox.innerHTML = `
        <div class="mi-scorecard">
          <div class="mi-score-ring ${ring}"><span>${score}</span><small>/100</small></div>
          <div class="mi-score-body">
            <p class="mi-summary">${escapeHTML(r.summary || '')}</p>
            <div class="mi-score-cols">
              <div><h4>✅ Strengths</h4><ul>${strengths || '<li>—</li>'}</ul></div>
              <div><h4>🎯 Improve</h4><ul>${improvements || '<li>—</li>'}</ul></div>
            </div>
            <button class="btn-tiny" id="mi-restart">Practice again</button>
          </div>
        </div>`;
      const restart = document.getElementById('mi-restart');
      if (restart) restart.onclick = () => { live.hidden = true; scoreBox.hidden = true; setup.hidden = false; };
    } catch (e) {
      scoreBox.innerHTML = `<div class="ai-error">${escapeHTML(e.message || 'Could not score the interview.')}</div>`;
    } finally { setBusy(false); }
  };
})();
