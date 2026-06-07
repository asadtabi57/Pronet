// ---------------------------------------------------------------------------
// lib/ai.js — Connectik's AI helper layer.
//
// Design goals:
//   * $0 cost. Uses Google Gemini's free tier when GEMINI_API_KEY is set.
//   * Never crashes the app when the key is absent — every function degrades
//     gracefully (generation throws a typed "not configured" error the API
//     layer turns into a clean 503; embeddings fall back to a deterministic,
//     dependency-free local vector so Smart Match / Search still function).
//   * No new npm dependencies — talks to Gemini's REST API via global fetch
//     (Node 18+), so deploys stay light and there's nothing to break on install.
//
// Embedding spaces: a Gemini embedding (semantic) and the local fallback
// (lexical) are NOT comparable. We therefore tag every stored vector with the
// provider that produced it ('gemini' | 'local') and only ever compare vectors
// from the same provider. `embeddingProvider()` reports the current one so the
// DB layer can filter accordingly and the backfill can regenerate on switch.
// ---------------------------------------------------------------------------
'use strict';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
// Candidate generation models, tried in order until one works. A model named in
// GEMINI_MODEL (if set) is tried first. This makes the integration resilient to
// Google renaming/retiring free-tier models — whichever is currently available
// wins, and the choice is cached for the process once discovered.
const GEN_MODEL_CANDIDATES = [
  process.env.GEMINI_MODEL,
  'gemini-2.5-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-2.0-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-flash-latest',
  'gemini-1.5-flash',
].filter(Boolean);
const EMBED_MODEL_CANDIDATES = [
  process.env.GEMINI_EMBED_MODEL,
  'text-embedding-004',
  'gemini-embedding-001',
  'embedding-001',
].filter(Boolean);
const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';
let _genModel = null;     // resolved working generation model (cached)
let _embedModel = null;   // resolved working embedding model (cached)

// Gemini's text-embedding-004 returns 768 dims; our local fallback matches that
// width so the Postgres `vector(768)` column is valid for either provider.
const EMBED_DIM = 768;

function aiEnabled() { return !!GEMINI_API_KEY; }
function embeddingProvider() { return GEMINI_API_KEY ? 'gemini' : 'local'; }

// A typed error so the route layer can map "no key" to a friendly 503 while
// real upstream failures surface as 502.
class AINotConfiguredError extends Error {
  constructor(msg) { super(msg || 'AI is not configured'); this.code = 'AI_NOT_CONFIGURED'; this.status = 503; }
}

// ---------------------------------------------------------------------------
// Text generation
// ---------------------------------------------------------------------------
// Low-level call to Gemini's generateContent. `opts`:
//   system    — optional system instruction
//   maxTokens — output cap (default 512)
//   temperature
//   json      — when true, asks Gemini for application/json output
async function generateText(prompt, opts = {}) {
  if (!GEMINI_API_KEY) throw new AINotConfiguredError('Set GEMINI_API_KEY to enable AI features.');
  const body = {
    contents: [{ role: 'user', parts: [{ text: String(prompt || '') }] }],
    generationConfig: {
      temperature: opts.temperature != null ? opts.temperature : 0.7,
      maxOutputTokens: opts.maxTokens || 512,
    },
  };
  if (opts.system) body.systemInstruction = { parts: [{ text: String(opts.system) }] };
  if (opts.json) body.generationConfig.responseMimeType = 'application/json';

  // Statuses that mean "this model is busy/unavailable right now — try another
  // model or retry shortly" rather than a hard failure.
  const RETRYABLE = new Set([404, 429, 500, 503]);
  // Up to 2 passes over the candidate list, with a short backoff between passes,
  // to ride out transient free-tier 429/503 spikes. A model that actually
  // produces output is cached so subsequent calls skip discovery.
  const PASSES = 2;
  let lastErr = null;
  for (let pass = 0; pass < PASSES; pass++) {
    // After the first pass, ignore any cached model and walk the full list.
    const tryModels = (pass === 0 && _genModel) ? [_genModel] : GEN_MODEL_CANDIDATES;
    let retryableSeen = false;
    for (const model of tryModels) {
      const url = `${API_ROOT}/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      let res;
      try {
        res = await fetchWithTimeout(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }, opts.timeoutMs || 20000);
      } catch (e) {
        lastErr = Object.assign(new Error('AI request failed: ' + (e && e.message)), { status: 502 });
        retryableSeen = true; continue;
      }
      if (RETRYABLE.has(res.status)) {
        lastErr = Object.assign(new Error(`Model ${model} unavailable (${res.status})`),
          { status: res.status === 404 ? 502 : res.status });
        // If our cached model is now rate-limited/exhausted, drop the cache so we
        // re-discover a model that still has quota on the next pass/call.
        if (_genModel === model) _genModel = null;
        retryableSeen = true; continue; // try the next candidate model
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        const err = new Error(`AI request failed (${res.status}). ${txt.slice(0, 200)}`);
        err.status = 502; throw err;
      }
      const data = await res.json();
      const parts = data && data.candidates && data.candidates[0]
        && data.candidates[0].content && data.candidates[0].content.parts;
      const text = Array.isArray(parts) ? parts.map(p => p.text || '').join('').trim() : '';
      if (!text) {
        // Empty/blocked from THIS model — re-discover instead of hard-failing.
        if (_genModel === model) _genModel = null;
        lastErr = Object.assign(new Error('Empty response from ' + model), { status: 502 });
        retryableSeen = true; continue;
      }
      _genModel = model; // cache the winner
      return text;
    }
    // Every candidate was busy this pass — wait briefly, then try once more.
    if (retryableSeen && pass < PASSES - 1) await sleep(1200);
  }
  // Exhausted: surface a friendly, retryable message for rate/capacity limits.
  if (lastErr && (lastErr.status === 429 || lastErr.status === 503)) {
    throw Object.assign(new Error('AI is busy right now. Please try again in a moment.'), { status: lastErr.status });
  }
  throw lastErr || Object.assign(new Error('No usable AI model.'), { status: 502 });
}

// Generate and parse JSON. Tolerates code fences / stray prose around the JSON.
// Retries once with extra token headroom if the first response was truncated /
// unparseable (free-tier responses occasionally cut off mid-object).
async function generateJSON(prompt, opts = {}) {
  const base = opts.maxTokens || 512;
  const raw = await generateText(prompt, { ...opts, json: true, maxTokens: base });
  const parsed = safeParseJSON(raw);
  if (parsed != null) return parsed;
  // Retry once with more room and a hard nudge to keep it compact.
  const raw2 = await generateText(prompt, { ...opts, json: true, maxTokens: Math.max(base, 800), temperature: 0 });
  return safeParseJSON(raw2);
}

function safeParseJSON(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  // Strip ```json fences if the model added them despite responseMimeType.
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(s); } catch (e) { /* fall through */ }
  // Last resort: grab the first {...} or [...] block.
  const m = s.match(/[\[{][\s\S]*[\]}]/);
  if (m) { try { return JSON.parse(m[0]); } catch (e) {} }
  return null;
}

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------
// Returns { vector: number[768], provider: 'gemini'|'local' }. Never throws for
// the "no key" case — it falls back to a local lexical embedding so the vector
// features keep working (just lexically instead of semantically) until a key is
// added and the backfill is run.
async function generateEmbedding(text) {
  const input = String(text || '').slice(0, 8000);
  if (GEMINI_API_KEY) {
    const tryModels = _embedModel ? [_embedModel] : EMBED_MODEL_CANDIDATES;
    for (const model of tryModels) {
      try {
        const url = `${API_ROOT}/models/${model}:embedContent?key=${GEMINI_API_KEY}`;
        const res = await fetchWithTimeout(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: `models/${model}`,
            content: { parts: [{ text: input }] },
            // Force 768 dims so any model matches our vector(768) column.
            // text-embedding-004/embedding-001 return 768 regardless; newer
            // models (gemini-embedding-001) honor this to downsize from 3072.
            outputDimensionality: EMBED_DIM,
          }),
        }, 15000);
        if (res.status === 404) { continue; } // model retired → try next candidate
        if (res.ok) {
          const data = await res.json();
          const values = data && data.embedding && data.embedding.values;
          if (Array.isArray(values) && values.length === EMBED_DIM) {
            _embedModel = model; // cache the winner
            return { vector: values, provider: 'gemini' };
          }
          // Wrong dimensionality → unusable for our column; try the next model.
          continue;
        }
        // Other non-OK (429/5xx) → stop trying remote, fall back to local.
        break;
      } catch (e) { /* network issue → fall back to local */ break; }
    }
  }
  return { vector: localEmbedding(input), provider: 'local' };
}

// Deterministic, dependency-free fallback embedding. Hashes word tokens
// (plus 2-grams of characters for a little fuzziness) into a fixed-width vector
// and L2-normalizes it, so cosine similarity ≈ weighted shared-vocabulary
// overlap. Not semantic, but a reasonable "people who share terms with you"
// signal that requires no API key and no model download.
function localEmbedding(text) {
  const vec = new Array(EMBED_DIM).fill(0);
  const norm = String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const tokens = norm.split(/\s+/).filter(t => t.length > 1 && !STOPWORDS.has(t));
  for (const tok of tokens) {
    bump(vec, hashStr(tok), 1.0);
    // light character bigram smearing so near-spellings overlap a bit
    for (let i = 0; i < tok.length - 1; i++) {
      bump(vec, hashStr('§' + tok.slice(i, i + 2)), 0.3);
    }
  }
  // L2 normalize
  let mag = 0; for (const v of vec) mag += v * v;
  mag = Math.sqrt(mag) || 1;
  for (let i = 0; i < vec.length; i++) vec[i] /= mag;
  return vec;
}
function bump(vec, h, w) {
  const idx = h % EMBED_DIM;
  // sign from a second hash bit to reduce collisions cancelling constructively
  const sign = (h & 1) ? 1 : -1;
  vec[idx] += sign * w;
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0);
}
const STOPWORDS = new Set(('a an and the of to in on at for with from by is are was were be been being i ' +
  'me my we our you your he she it they them his her their as or if then than so such this that these those ' +
  'have has had do does did but not no yes can will just about into over under up down out off again more most ' +
  'other some any all each few who whom which what when where why how').split(/\s+/));

// Serialize a JS number[] as a pgvector literal: '[0.1,0.2,...]'
function toVectorLiteral(arr) { return '[' + arr.map(x => (Number.isFinite(x) ? x : 0)).join(',') + ']'; }

// Build the canonical text we embed for a user profile.
function profileEmbedText(u) {
  if (!u) return '';
  const skills = Array.isArray(u.skills) ? u.skills.join(', ')
    : (typeof u.skills === 'string' ? u.skills : '');
  const exp = Array.isArray(u.experience)
    ? u.experience.map(e => [e.title, e.company].filter(Boolean).join(' at ')).join('; ') : '';
  return [
    u.name && `Name: ${u.name}`,
    u.headline && `Headline: ${u.headline}`,
    u.location && `Location: ${u.location}`,
    skills && `Skills: ${skills}`,
    exp && `Experience: ${exp}`,
    u.about && `About: ${u.about}`,
  ].filter(Boolean).join('\n').slice(0, 4000);
}

// ---------------------------------------------------------------------------
// Lightweight local toxicity pre-filter (saves API calls). Returns true if the
// text is obviously aggressive/abusive so the caller can escalate to an LLM
// check only when this trips.
// ---------------------------------------------------------------------------
const TOXIC_PATTERNS = [
  /\bf+u+c+k+/i, /\bs+h+i+t+/i, /\bb+i+t+c+h+/i, /\ba+s+s+h+o+l+e+/i, /\bc+u+n+t+/i,
  /\bd+i+c+k+h+e+a+d+/i, /\bbastard\b/i, /\bidiot\b/i, /\bstupid\b/i, /\bmoron\b/i,
  /\bshut up\b/i, /\bgo to hell\b/i, /\bkill yourself\b/i, /\bloser\b/i, /\bdumb(ass)?\b/i,
  /\bretard/i, /\bscum\b/i, /\btrash\b/i, /\bpathetic\b/i, /\bworthless\b/i,
];
function localToxicityHit(text) {
  const s = String(text || '');
  return TOXIC_PATTERNS.some(re => re.test(s));
}

// ---------------------------------------------------------------------------
async function fetchWithTimeout(url, options, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || 15000);
  try { return await fetch(url, { ...options, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = {
  aiEnabled, embeddingProvider, EMBED_DIM,
  AINotConfiguredError,
  generateText, generateJSON, safeParseJSON,
  generateEmbedding, localEmbedding, toVectorLiteral, profileEmbedText,
  localToxicityHit,
};
