require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const DOMPurify = require('isomorphic-dompurify');
const multer = require('multer');
const { Pool } = require('pg');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL missing in .env'); process.exit(1); }

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 20,
  // Keep sockets to the Supabase pooler warm. Reconnecting pays a ~1s+ TLS
  // handshake to the (distant) DB region, so we hold idle connections far
  // longer and enable TCP keep-alive to avoid silent drops.
  idleTimeoutMillis: 5 * 60_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  connectionTimeoutMillis: 10_000,
  // Server-side guard: kill any single query that runs longer than 15s so a
  // pathological query can never pin a pooled connection indefinitely.
  statement_timeout: 15_000,
});
pool.on('error', (err) => console.error('PG pool error', err.message));
const q = (text, params) => pool.query(text, params);

// Keep at least one connection hot so the first request after an idle period
// doesn't eat the full cold-connect (TLS) penalty. Cheap heartbeat every 4 min.
setInterval(() => { q('SELECT 1').catch(() => {}); }, 4 * 60_000).unref();
// Warm the pool immediately on boot.
q('SELECT 1').catch(() => {});

// ---------------- Auth helpers ----------------
function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '30d' });
}

// ---------------- Secure session cookie (mitigates token theft via XSS) ----
// The JWT lives in an httpOnly cookie so frontend JS can never read it. `secure`
// is set whenever the request is HTTPS (always true behind Railway's proxy),
// and falls back to false on localhost http so dev still works.
const AUTH_COOKIE = 'pn_token';
// Time windows for editing/deleting user-authored comments & messages.
const EDIT_WINDOW_MS = 2 * 60 * 1000;   // editable for 2 minutes after posting
const DELETE_WINDOW_MS = 5 * 60 * 1000; // deletable for 5 minutes after posting
function isHttps(req) {
  return Boolean(req.secure || req.headers['x-forwarded-proto'] === 'https');
}
function authCookieOptions(req) {
  return {
    httpOnly: true,
    secure: isHttps(req),
    sameSite: 'lax', // 'lax' keeps the cookie working through the OAuth redirect return
    path: '/',
  };
}
function setAuthCookie(req, res, token) {
  res.cookie(AUTH_COOKIE, token, { ...authCookieOptions(req), maxAge: 30 * 24 * 60 * 60 * 1000 });
}
function clearAuthCookie(req, res) {
  res.clearCookie(AUTH_COOKIE, authCookieOptions(req));
}
function tokenFromRequest(req) {
  if (req.cookies && req.cookies[AUTH_COOKIE]) return req.cookies[AUTH_COOKIE];
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

// ---------------- Input sanitization (XSS defense-in-depth) ----------------
// User-authored text (posts, comments, messages) is plain text on render, so we
// strip ALL html before it ever reaches the database. KEEP_CONTENT keeps the
// visible text of any stripped tags (e.g. "<b>hi</b>" -> "hi").
function sanitizeText(s) {
  if (s == null) return s;
  const stripped = DOMPurify.sanitize(String(s), { ALLOWED_TAGS: [], ALLOWED_ATTR: [], KEEP_CONTENT: true });
  // DOMPurify entity-encodes stray < > & " ' from plain text. Decode them back so
  // we store true plain text — the frontend escapes again on render (escapeHTML),
  // so this remains XSS-safe while avoiding double-encoding artifacts.
  return stripped
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

const sbTokenCache = new Map();
async function verifySupabaseToken(token) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const cached = sbTokenCache.get(token);
  if (cached && Date.now() - cached.at < 60_000) return cached.user;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: 'Bearer ' + token, apikey: SUPABASE_KEY },
    });
    if (!r.ok) return null;
    const user = await r.json();
    if (!user || !user.id || !user.email) return null;
    sbTokenCache.set(token, { user, at: Date.now() });
    return user;
  } catch (e) { return null; }
}

const COLORS = ['#0a66c2', '#057642', '#915907', '#b24020', '#7a3eaf', '#0073b1', '#c2410c'];
const COVERS = ['#a0c4ff', '#bdb2ff', '#ffc6ff', '#caffbf', '#ffd6a5', '#9bf6ff'];

async function ensureLocalUserFromSupabase(sbUser) {
  const email = sbUser.email.toLowerCase();
  let r = await q(`SELECT * FROM users WHERE supabase_id = $1 LIMIT 1`, [sbUser.id]);
  if (r.rowCount === 0) {
    r = await q(`SELECT * FROM users WHERE email = $1 LIMIT 1`, [email]);
  }
  const meta = sbUser.user_metadata || {};
  const displayName = meta.full_name || meta.name || email.split('@')[0];
  // Supabase verified the email, so mark verified locally too.
  const sbVerified = Boolean(sbUser.email_confirmed_at || sbUser.confirmed_at);
  if (r.rowCount === 0) {
    const ins = await q(
      `INSERT INTO users (supabase_id, email, password_hash, name, headline, about, location,
         experience, education, skills, avatar_color, cover_color, avatar_url, email_verified, created_at)
       VALUES ($1,$2,'',$3,'','','', '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,$4,$5,$6,$7,$8)
       RETURNING *`,
      [sbUser.id, email, displayName,
       COLORS[Math.floor(Math.random() * COLORS.length)],
       COVERS[Math.floor(Math.random() * COVERS.length)],
       meta.avatar_url || meta.picture || null,
       sbVerified,
       Date.now()]
    );
    return ins.rows[0];
  }
  const user = r.rows[0];
  if (!user.supabase_id || (sbVerified && !user.email_verified)) {
    const avatar = user.avatar_url || meta.avatar_url || meta.picture || null;
    const upd = await q(
      `UPDATE users SET supabase_id = $1, avatar_url = $2,
         email_verified = email_verified OR $3
       WHERE id = $4 RETURNING *`,
      [sbUser.id, avatar, sbVerified, user.id]
    );
    return upd.rows[0];
  }
  return user;
}

async function authRequired(req, res, next) {
  const token = tokenFromRequest(req);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    req.user.id = Number(req.user.id); // BIGINT ids are strings in the JWT; normalize for comparisons
    return next();
  } catch (e) { /* try supabase */ }
  const sbUser = await verifySupabaseToken(token);
  if (!sbUser) return res.status(401).json({ error: 'Invalid token' });
  try {
    const local = await ensureLocalUserFromSupabase(sbUser);
    req.user = { id: Number(local.id), email: local.email, name: local.name };
    next();
  } catch (e) {
    console.error('ensureLocalUserFromSupabase error', e);
    res.status(500).json({ error: 'Auth bridge failed' });
  }
}

// ---------------- DTO helpers ----------------
// Pure DTO builder — given a user row, its total connection count, and the
// viewer's connection row (or null), produce the public user object. Shared by
// publicUser (single) and publicUsersByIds (batch) so the shape never drifts.
function buildUserDTO(u, viewerId, connectionCount, rel) {
  const uid = Number(u.id);
  const isSelf = viewerId != null && Number(viewerId) === uid;
  // Privacy gating: hide presence/last-seen from OTHER viewers when the user has
  // turned those off. The owner always sees their own true state.
  const onlineVisible   = isSelf || u.is_online_visible !== false;
  const lastSeenVisible = isSelf || u.is_last_seen_visible !== false;
  const out = {
    id: uid, name: u.name, email: u.email, headline: u.headline || '',
    about: u.about || '', avatar_color: u.avatar_color,
    avatar_url: u.avatar_url || null,
    location: u.location || '',
    experience: u.experience || [], education: u.education || [], skills: u.skills || [],
    cover_color: u.cover_color || '#a0c4ff',
    subscription: u.subscription || null,
    connection_count: connectionCount || 0,
    online: isSelf ? isUserOnline(uid) : (onlineVisible ? isUserVisibleOnline(uid) : false),
    last_seen: (lastSeenVisible && u.last_seen != null) ? Number(u.last_seen) : null,
    profile_visibility: u.profile_visibility || 'public',
  };
  // Expose the raw privacy switches only to the owner so the Settings menu can
  // render their current state. Never leak them to other viewers.
  if (isSelf) {
    out.is_online_visible    = u.is_online_visible !== false;
    out.is_last_seen_visible = u.is_last_seen_visible !== false;
  }
  if (viewerId != null && viewerId !== uid) {
    out.connected = false;
    out.pending_out = false;  // I sent a request to them
    out.pending_in  = false;  // they sent a request to me
    if (rel) {
      if (rel.accepted === 1) out.connected = true;
      else if (Number(rel.user_a) === Number(viewerId)) out.pending_out = true;
      else out.pending_in = true;
    }
  }
  return out;
}

async function publicUser(u, viewerId) {
  if (!u) return null;
  const uid = Number(u.id);
  const needRel = viewerId != null && viewerId !== uid;
  // Count + relationship lookups are independent → run them concurrently.
  const [ccRes, cn] = await Promise.all([
    q(`SELECT COUNT(*)::int AS c FROM connections WHERE (user_a = $1 OR user_b = $1) AND accepted = 1`, [uid]),
    needRel
      ? q(`SELECT user_a, accepted FROM connections
            WHERE (user_a=$1 AND user_b=$2) OR (user_a=$2 AND user_b=$1) LIMIT 1`, [viewerId, uid])
      : Promise.resolve({ rowCount: 0, rows: [] }),
  ]);
  const rel = cn.rowCount > 0 ? cn.rows[0] : null;
  return buildUserDTO(u, viewerId, ccRes.rows[0].c, rel);
}

// Batch version: resolve many users to public DTOs. The three lookups (user
// rows, connection counts, viewer relationships) are independent, so we fire
// them concurrently — one round-trip's worth of latency instead of three.
// Returns a Map keyed by numeric user id. Use this for any list of users.
async function publicUsersByIds(ids, viewerId) {
  const uniq = [...new Set((ids || []).map(Number).filter(Boolean))];
  const map = new Map();
  if (!uniq.length) return map;

  const [usersRes, ccRes, relRes] = await Promise.all([
    q(`SELECT * FROM users WHERE id = ANY($1::bigint[])`, [uniq]),
    // connection_count for every target in one pass
    q(`SELECT t AS id, COUNT(*)::int AS c FROM (
          SELECT user_a AS t FROM connections WHERE accepted = 1 AND user_a = ANY($1::bigint[])
          UNION ALL
          SELECT user_b AS t FROM connections WHERE accepted = 1 AND user_b = ANY($1::bigint[])
       ) z GROUP BY t`, [uniq]),
    // viewer's relationship to each target in one query
    viewerId != null
      ? q(`SELECT user_a, user_b, accepted FROM connections
            WHERE (user_a = $1 AND user_b = ANY($2::bigint[]))
               OR (user_b = $1 AND user_a = ANY($2::bigint[]))`, [Number(viewerId), uniq])
      : Promise.resolve({ rows: [] }),
  ]);

  const countMap = new Map(ccRes.rows.map(r => [Number(r.id), r.c]));
  const relMap = new Map();
  for (const row of relRes.rows) {
    const other = Number(row.user_a) === Number(viewerId) ? Number(row.user_b) : Number(row.user_a);
    relMap.set(other, row);
  }

  for (const u of usersRes.rows) {
    const uid = Number(u.id);
    map.set(uid, buildUserDTO(u, viewerId, countMap.get(uid) || 0, relMap.get(uid) || null));
  }
  return map;
}

async function findUser(id) {
  const r = await q(`SELECT * FROM users WHERE id = $1`, [id]);
  return r.rows[0] || null;
}
async function findUserByEmail(email) {
  const r = await q(`SELECT * FROM users WHERE email = $1`, [String(email).toLowerCase()]);
  return r.rows[0] || null;
}

async function notify(userId, type, actorId, payload) {
  if (userId === actorId) return;
  const ins = await q(
    `INSERT INTO notifications (user_id, type, actor_id, payload, read, created_at)
     VALUES ($1,$2,$3,$4::jsonb,0,$5) RETURNING id, created_at`,
    [userId, type, actorId, JSON.stringify(payload || {}), Date.now()]
  );
  // Realtime push is best-effort and only matters if the user is connected, so
  // build the actor DTO and emit it without blocking the caller's response.
  (async () => {
    try {
      if (!sseClients.has(Number(userId))) return; // nobody listening; skip the lookups
      let actor = null;
      if (actorId) actor = await publicUser(await findUser(Number(actorId)), Number(userId));
      sseSend(userId, 'notification', {
        id: Number(ins.rows[0].id),
        type, actor_id: actorId ? Number(actorId) : null,
        payload: payload || {}, read: 0,
        created_at: Number(ins.rows[0].created_at),
        actor,
      });
    } catch (e) { /* realtime is best-effort */ }
  })();
}

// ---------------- Realtime (SSE) hub ----------------
// Authenticated Server-Sent-Events. Each logged-in user can have multiple
// connections (tabs/devices). Used for live messages, notifications and
// WebRTC call signaling. Single-instance friendly (Railway hobby = 1 instance).
const sseClients = new Map(); // userId(Number) -> Set<res>

function sseAdd(userId, res) {
  const key = Number(userId);
  if (!sseClients.has(key)) sseClients.set(key, new Set());
  sseClients.get(key).add(res);
}
function sseRemove(userId, res) {
  const key = Number(userId);
  const set = sseClients.get(key);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) sseClients.delete(key);
}
function sseSend(userId, event, data) {
  const set = sseClients.get(Number(userId));
  if (!set || set.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try { res.write(payload); } catch (e) { /* dead connection; cleaned on close */ }
  }
}

// ---------------- Online presence ----------------
// A user is "online" while they hold at least one live SSE connection. We
// broadcast online/offline transitions to every connected client so each
// browser can keep a live set of online user ids (drives the green dot).
//
// Privacy: users who turned OFF "Active status" are tracked here so we never
// advertise their presence — they keep full SSE delivery (messages, calls,
// notifications) but are invisible in the online set and broadcasts.
const presenceHidden = new Set(); // userId(Number) -> online status is hidden
function isPresenceHidden(userId) { return presenceHidden.has(Number(userId)); }
function setPresenceHidden(userId, hidden) {
  const key = Number(userId);
  if (hidden) presenceHidden.add(key); else presenceHidden.delete(key);
}
function onlineUserIds() {
  return [...sseClients.keys()].filter(id => !presenceHidden.has(id));
}
function isUserOnline(userId) {
  const set = sseClients.get(Number(userId));
  return !!(set && set.size > 0);
}
// Online AND allowed to be seen — what other users are permitted to observe.
function isUserVisibleOnline(userId) {
  return isUserOnline(userId) && !presenceHidden.has(Number(userId));
}
function broadcastPresence(userId, online) {
  // Never advertise an "online" transition for a user hiding their status.
  if (online && presenceHidden.has(Number(userId))) return;
  const payload = `event: presence\ndata: ${JSON.stringify({ user_id: Number(userId), online })}\n\n`;
  for (const set of sseClients.values()) {
    for (const res of set) {
      try { res.write(payload); } catch (e) { /* cleaned on close */ }
    }
  }
}

// Resolve a user id from a raw token (JWT first, then Supabase). For SSE the
// token arrives as a query param because EventSource can't set headers.
async function resolveUserFromToken(token) {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return { id: Number(decoded.id), email: decoded.email, name: decoded.name };
  } catch (e) { /* try supabase */ }
  const sbUser = await verifySupabaseToken(token);
  if (!sbUser) return null;
  try {
    const local = await ensureLocalUserFromSupabase(sbUser);
    return { id: Number(local.id), email: local.email, name: local.name };
  } catch (e) { return null; }
}

// Fetch posts as feed DTOs (one query with subselects)
async function fetchPostDTOs({ viewerId, where = 'TRUE', params = [], limit = 100, orderBy = 'p.created_at DESC' }) {
  // viewerId is $1, then user-supplied params follow as $2, $3, ...
  const sql = `
    SELECT p.id, p.user_id, p.content, p.media_type, p.media_url, p.repost_of, p.created_at,
           u.name AS u_name, u.headline AS u_headline, u.avatar_color AS u_avatar_color, u.avatar_url AS u_avatar_url,
           (SELECT COUNT(*)::int FROM likes l WHERE l.post_id = p.id) AS like_count,
           (SELECT COUNT(*)::int FROM comments c WHERE c.post_id = p.id) AS comment_count,
           (SELECT COUNT(*)::int FROM posts r WHERE r.repost_of = p.id) +
           (SELECT COUNT(*)::int FROM shares s WHERE s.post_id = p.id) AS share_count,
           (SELECT type FROM likes l2 WHERE l2.post_id = p.id AND l2.user_id = $1 LIMIT 1) AS my_reaction,
           (SELECT json_object_agg(type, c) FROM (
              SELECT type, COUNT(*)::int AS c FROM likes WHERE post_id = p.id GROUP BY type
            ) t) AS reaction_counts
      FROM posts p
      JOIN users u ON u.id = p.user_id
     WHERE ${where}
     ORDER BY ${orderBy}
     LIMIT ${Number(limit)}`;
  const r = await q(sql, [viewerId, ...params]);
  const rows = r.rows.map(rowToPostDTO);
  // Hydrate repost_of (parent post) recursively (1 level)
  const repostIds = [...new Set(rows.filter(x => x.repost_of_id).map(x => x.repost_of_id))];
  if (repostIds.length) {
    const parentR = await q(
      `SELECT p.id, p.user_id, p.content, p.media_type, p.media_url, p.repost_of, p.created_at,
              u.name AS u_name, u.headline AS u_headline, u.avatar_color AS u_avatar_color, u.avatar_url AS u_avatar_url,
              (SELECT COUNT(*)::int FROM likes l WHERE l.post_id = p.id) AS like_count,
              (SELECT COUNT(*)::int FROM comments c WHERE c.post_id = p.id) AS comment_count,
              0 AS share_count,
              (SELECT type FROM likes l2 WHERE l2.post_id = p.id AND l2.user_id = $1 LIMIT 1) AS my_reaction,
              (SELECT json_object_agg(type, c) FROM (
                 SELECT type, COUNT(*)::int AS c FROM likes WHERE post_id = p.id GROUP BY type
               ) t) AS reaction_counts
         FROM posts p JOIN users u ON u.id = p.user_id
        WHERE p.id = ANY($2::bigint[])`,
      [viewerId, repostIds]
    );
    const map = new Map(parentR.rows.map(rr => [Number(rr.id), rowToPostDTO(rr)]));
    for (const r of rows) {
      r.repost_of = r.repost_of_id ? (map.get(r.repost_of_id) || null) : null;
      delete r.repost_of_id;
    }
  } else {
    for (const r of rows) { r.repost_of = null; delete r.repost_of_id; }
  }
  return rows;
}

function rowToPostDTO(row) {
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    content: row.content,
    media_type: row.media_type,
    media_url: row.media_url,
    created_at: Number(row.created_at),
    name: row.u_name,
    headline: row.u_headline,
    avatar_color: row.u_avatar_color,
    avatar_url: row.u_avatar_url,
    like_count: row.like_count || 0,
    comment_count: row.comment_count || 0,
    share_count: row.share_count || 0,
    liked_by_me: !!row.my_reaction,
    my_reaction: row.my_reaction || null,
    reaction_counts: row.reaction_counts || {},
    repost_of_id: row.repost_of ? Number(row.repost_of) : null,
  };
}

async function fetchOnePostDTO(id, viewerId) {
  const out = await fetchPostDTOs({ viewerId, where: 'p.id = $2', params: [id], limit: 1 });
  return out[0] || null;
}

// ---------------- App ----------------
const app = express();
const compression = require('compression');
// gzip all responses EXCEPT the SSE stream (compression buffers and would
// delay/break real-time events behind proxies like Cloudflare).
app.use(compression({
  filter: (req, res) => {
    if (req.path === '/api/events' || req.headers.accept === 'text/event-stream') return false;
    return compression.filter(req, res);
  },
}));
// --- CORS: allow only known origins (frontend is same-origin in prod) ---
const ALLOWED_ORIGINS = [
  process.env.APP_URL,
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://localhost:3939',
].filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    // Same-origin / curl / server-to-server requests have no Origin header.
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: true,
}));

// --- Baseline security headers (clickjacking, MIME sniffing, HTTPS, etc.) ---
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});
app.use(express.json({ limit: '8mb' })); // headroom for chat attachments (<=5 MB) sent as base64
app.use(cookieParser());

// Long-cache hashed-looking assets; short-cache HTML so deploys appear instantly
const BUILD_ID = Date.now().toString(36);
const fsSync = require('fs');
// Auto-version CSS/JS in HTML so browsers always pick up the latest after deploy
const htmlCache = new Map();
function serveVersionedHtml(req, res, next, fileName) {
  const filePath = path.join(__dirname, 'public', fileName || req.path);
  const cacheKey = filePath + ':' + BUILD_ID;
  let html = htmlCache.get(cacheKey);
  if (!html) {
    try {
      html = fsSync.readFileSync(filePath, 'utf8');
    } catch (e) { return next ? next() : res.status(404).end(); }
    html = html.replace(/(src|href)="(\/[^"]+\.(?:css|js))"/g, `$1="$2?v=${BUILD_ID}"`);
    htmlCache.set(cacheKey, html);
  }
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}
// Entry point: '/' must be versioned too, otherwise its <script src="/js/app.js">
// is loaded unversioned and gets the aggressive 7-day cache — which is exactly
// why returning (non-incognito) browsers kept running stale app.js.
app.get('/', (req, res, next) => serveVersionedHtml(req, res, next, 'index.html'));
app.get(/\.html$/, (req, res, next) => serveVersionedHtml(req, res, next));

app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  maxAge: '7d',
  index: false, // never serve raw, unversioned index.html for '/'
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    } else if (/\.(?:css|js|png|jpe?g|gif|webp|svg|ico|woff2?)$/i.test(filePath)) {
      // Versioned via ?v= in HTML, so cache aggressively
      res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
    }
  },
}));

app.set('trust proxy', 1); // Railway is behind a proxy; needed for accurate req.ip

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------------- Rate limiting ----------------
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const mailer = require('./lib/mailer');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
});
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many signup attempts from this IP. Please try again later.' },
});
const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many verification attempts. Please try again later.' },
});
const forgotLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset attempts. Please try again later.' },
});
// Stricter limiter for OTP code verification (brute-force protection).
const otpVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many code attempts. Please wait a few minutes and try again.' },
});

// Strong password policy: >=8 chars with upper, lower, number and special.
function validatePassword(pw) {
  const s = String(pw || '');
  if (s.length < 8) return 'Password must be at least 8 characters long.';
  if (!/[a-z]/.test(s)) return 'Password must include a lowercase letter.';
  if (!/[A-Z]/.test(s)) return 'Password must include an uppercase letter.';
  if (!/[0-9]/.test(s)) return 'Password must include a number.';
  if (!/[^A-Za-z0-9]/.test(s)) return 'Password must include a special character.';
  return null;
}

const gen6 = () => String(Math.floor(100000 + Math.random() * 900000));

// Issue a fresh signup OTP for an email: invalidates older codes, stores a
// bcrypt hash, emails the 6-digit code. Returns the plain otp (for dev fallback).
async function issueEmailOtp(email, name) {
  const otp = gen6();
  const otpHash = bcrypt.hashSync(otp, 10);
  const expires = Date.now() + 10 * 60 * 1000; // 10 minutes
  await q(`UPDATE email_otps SET used = 1 WHERE email = $1 AND used = 0`, [email]);
  await q(
    `INSERT INTO email_otps (email, otp_hash, purpose, expires_at, used, attempts, created_at)
     VALUES ($1,$2,'signup',$3,0,0,$4)`,
    [email, otpHash, expires, Date.now()]
  );
  const tpl = mailer.signupOtpTemplate({ name, otp });
  await mailer.sendMail({ to: email, subject: tpl.subject, html: tpl.html, text: tpl.text });
  return otp;
}

// Validate the latest signup OTP. Enforces one-time use, expiry and an attempt
// cap. On a wrong code we increment attempts and burn the code after 5 misses.
async function validateEmailOtp(email, otp) {
  const r = await q(
    `SELECT id, otp_hash, expires_at, used, attempts FROM email_otps
      WHERE email = $1 AND purpose = 'signup' ORDER BY created_at DESC LIMIT 1`,
    [email]
  );
  if (r.rowCount === 0) return { ok: false, error: 'No verification code found. Please request a new one.' };
  const row = r.rows[0];
  if (row.used === 1) return { ok: false, error: 'This code was already used. Please request a new one.' };
  if (Number(row.expires_at) < Date.now()) return { ok: false, error: 'This code has expired. Please request a new one.' };
  if (Number(row.attempts) >= 5) {
    await q(`UPDATE email_otps SET used = 1 WHERE id = $1`, [row.id]);
    return { ok: false, error: 'Too many incorrect attempts. Please request a new code.' };
  }
  if (!bcrypt.compareSync(String(otp || ''), row.otp_hash)) {
    await q(`UPDATE email_otps SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
    return { ok: false, error: 'Incorrect code. Please try again.' };
  }
  return { ok: true, id: row.id };
}

app.get('/api/config', (req, res) => {
  res.json({ supabase_url: SUPABASE_URL || null, supabase_key: SUPABASE_KEY || null });
});

// ---------------- Realtime stream (SSE) ----------------
app.get('/api/events', wrap(async (req, res) => {
  // EventSource can't set headers, but it DOES send the httpOnly cookie on
  // same-origin requests. Fall back to the legacy ?token= for compatibility.
  const token = tokenFromRequest(req) || String(req.query.token || '');
  const user = await resolveUserFromToken(token);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable proxy buffering
  res.flushHeaders && res.flushHeaders();
  res.write('retry: 5000\n\n');
  res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);

  // Seed this user's presence-visibility from their saved setting so we never
  // advertise them if they've hidden their active status. (resolveUserFromToken
  // returns a minimal user, so read the flag directly.)
  try {
    const pr = await q(`SELECT is_online_visible FROM users WHERE id = $1`, [user.id]);
    setPresenceHidden(user.id, pr.rows[0] && pr.rows[0].is_online_visible === false);
  } catch (e) { /* default: visible */ }

  // Detect the offline -> online transition (first connection for this user).
  const wasOnline = isUserOnline(user.id);
  sseAdd(user.id, res);
  if (!wasOnline) broadcastPresence(user.id, true);

  // Heartbeat keeps the connection alive through proxies/load balancers.
  const hb = setInterval(() => {
    try { res.write(`: ping\n\n`); } catch (e) { /* ignore */ }
  }, 25000);

  req.on('close', () => {
    clearInterval(hb);
    sseRemove(user.id, res);
    // Last connection closed -> the user just went offline. Stamp last_seen so
    // peers can show "last seen 5m ago" in the chat header.
    if (!isUserOnline(user.id)) {
      broadcastPresence(user.id, false);
      setPresenceHidden(user.id, false); // drop the in-memory flag; reseeded on next connect
      q(`UPDATE users SET last_seen = $1 WHERE id = $2`, [Date.now(), user.id]).catch(() => {});
    }
  });
}));

// Snapshot of everyone currently online — lets a freshly loaded page seed its
// presence set before any realtime transition arrives.
app.get('/api/presence', authRequired, wrap(async (req, res) => {
  res.json({ online: onlineUserIds() });
}));

function appBaseUrl(req) {
  return process.env.APP_URL
      || `${req.protocol}://${req.get('host')}`;
}

// --- Auth ---
// Signup step 1: validate, reject duplicate emails, create an UNVERIFIED user
// and email a 6-digit OTP. No token is returned — the account cannot be used
// until the OTP is verified (step 2), so verification cannot be bypassed.
app.post('/api/auth/signup', signupLimiter, wrap(async (req, res) => {
  const { name, email, password, headline } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  const pwErr = validatePassword(password);
  if (pwErr) return res.status(400).json({ error: pwErr });
  const em = String(email).toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return res.status(400).json({ error: 'Invalid email address' });

  const existing = await findUserByEmail(em);
  if (existing && (existing.email_verified || existing.supabase_id || existing.password_hash)) {
    // A usable account already exists (verified, OAuth, or pending a previous
    // unverified signup with a password). Don't allow silent takeover.
    if (existing.email_verified || existing.supabase_id) {
      return res.status(409).json({ error: 'Email already registered. Please login.' });
    }
  }

  let user;
  if (existing && !existing.email_verified && !existing.supabase_id) {
    // Re-using an unverified account: refresh its details + password.
    const upd = await q(
      `UPDATE users SET name = $1, headline = $2, password_hash = $3 WHERE id = $4 RETURNING *`,
      [name, headline || '', bcrypt.hashSync(password, 10), existing.id]
    );
    user = upd.rows[0];
  } else {
    const ins = await q(
      `INSERT INTO users (email, password_hash, name, headline, about, location,
         experience, education, skills, avatar_color, cover_color, email_verified, created_at)
       VALUES ($1,$2,$3,$4,'','','[]'::jsonb,'[]'::jsonb,'[]'::jsonb,$5,$6,FALSE,$7)
       RETURNING *`,
      [em, bcrypt.hashSync(password, 10), name, headline || '',
       COLORS[Math.floor(Math.random() * COLORS.length)],
       COVERS[Math.floor(Math.random() * COVERS.length)],
       Date.now()]
    );
    user = ins.rows[0];
  }

  const otp = await issueEmailOtp(em, user.name);
  const payload = { needs_otp: true, email: em, message: 'We sent a 6-digit verification code to your email.' };
  if (!mailer.configured()) payload.dev_otp = otp; // dev fallback only
  res.json(payload);
}));

// Signup step 2: verify the OTP, mark the email verified, and log the user in.
app.post('/api/auth/signup/verify-otp', otpVerifyLimiter, wrap(async (req, res) => {
  const em = String((req.body && req.body.email) || '').toLowerCase().trim();
  const otp = String((req.body && req.body.otp) || '').trim();
  if (!em || !otp) return res.status(400).json({ error: 'Email and code are required.' });
  const v = await validateEmailOtp(em, otp);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const user = await findUserByEmail(em);
  if (!user) return res.status(400).json({ error: 'Account not found. Please sign up again.' });
  await q(`UPDATE email_otps SET used = 1 WHERE id = $1`, [v.id]);
  await q(`UPDATE users SET email_verified = TRUE, email_verify_token = NULL, email_verify_expires = NULL WHERE id = $1`, [user.id]);
  const fresh = await findUserByEmail(em);
  const token = signToken(fresh);
  setAuthCookie(req, res, token);
  res.json({ token, user: await publicUser(fresh, fresh.id) });
}));

// Signup step 2b: resend a fresh OTP (rate-limited). Never reveals account state.
app.post('/api/auth/signup/resend-otp', verifyLimiter, wrap(async (req, res) => {
  const em = String((req.body && req.body.email) || '').toLowerCase().trim();
  if (!em) return res.status(400).json({ error: 'Email required' });
  const user = await findUserByEmail(em);
  if (!user || user.email_verified || !user.password_hash) return res.json({ ok: true });
  const otp = await issueEmailOtp(em, user.name);
  const out = { ok: true };
  if (!mailer.configured()) out.dev_otp = otp;
  res.json(out);
}));

app.post('/api/auth/login', loginLimiter, wrap(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  const user = await findUserByEmail(email);
  if (!user || !user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (!user.email_verified) {
    return res.status(403).json({ error: 'Please verify your email before signing in.', needs_verification: true });
  }
  const token = signToken(user);
  setAuthCookie(req, res, token);
  res.json({ token, user: await publicUser(user, user.id) });
}));

// Exchange a Supabase/OAuth session for our own httpOnly JWT cookie. The client
// sends the Supabase access token once (Bearer); authRequired bridges it to a
// local user, then we mint our cookie so every later request is cookie-based.
app.post('/api/auth/session', authRequired, wrap(async (req, res) => {
  const user = await findUser(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  setAuthCookie(req, res, signToken(user));
  res.json({ user: await publicUser(user, user.id) });
}));

// Clear the auth cookie (server-side logout).
app.post('/api/auth/logout', (req, res) => {
  clearAuthCookie(req, res);
  res.json({ ok: true });
});

app.get('/api/auth/verify-email', verifyLimiter, wrap(async (req, res) => {
  const token = String(req.query.token || '');
  if (!token) return res.status(400).json({ error: 'Token required' });
  const r = await q(`SELECT * FROM users WHERE email_verify_token = $1 LIMIT 1`, [token]);
  if (r.rowCount === 0) return res.status(400).json({ error: 'Invalid or already-used verification link' });
  const user = r.rows[0];
  if (user.email_verified) return res.json({ ok: true, already: true });
  if (user.email_verify_expires && Number(user.email_verify_expires) < Date.now()) {
    return res.status(400).json({ error: 'Verification link expired. Please request a new one.', expired: true });
  }
  await q(
    `UPDATE users SET email_verified = TRUE, email_verify_token = NULL, email_verify_expires = NULL WHERE id = $1`,
    [user.id]
  );
  res.json({ ok: true });
}));

app.post('/api/auth/resend-verification', verifyLimiter, wrap(async (req, res) => {
  const em = String((req.body && req.body.email) || '').toLowerCase();
  if (!em) return res.status(400).json({ error: 'Email required' });
  const user = await findUserByEmail(em);
  // Don't leak existence: always 200
  if (!user || user.email_verified || !user.password_hash) return res.json({ ok: true });
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + 24 * 60 * 60 * 1000;
  await q(`UPDATE users SET email_verify_token = $1, email_verify_expires = $2 WHERE id = $3`,
          [token, expires, user.id]);
  const link = `${appBaseUrl(req)}/verify-email.html?token=${token}`;
  const tpl = mailer.verifyEmailTemplate({ name: user.name, link });
  await mailer.sendMail({ to: em, subject: tpl.subject, html: tpl.html, text: tpl.text });
  const out = { ok: true };
  if (!mailer.configured()) out.dev_verify_link = link;
  res.json(out);
}));

// --- Forgot password (OTP) ---
// Step 1: request a code. Always 200 (don't leak which emails exist).
app.post('/api/auth/forgot-password/request', forgotLimiter, wrap(async (req, res) => {
  const em = String((req.body && req.body.email) || '').toLowerCase().trim();
  if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  const user = await findUserByEmail(em);
  // Only send if a password-based account exists. OAuth-only accounts have no password to reset.
  if (user && user.password_hash) {
    const otp = String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
    const otpHash = bcrypt.hashSync(otp, 10);
    const expires = Date.now() + 10 * 60 * 1000; // 10 minutes
    // Invalidate previous unused codes for this email.
    await q(`UPDATE password_reset_otps SET used = 1 WHERE email = $1 AND used = 0`, [em]);
    await q(
      `INSERT INTO password_reset_otps (email, otp_hash, expires_at, used, created_at)
       VALUES ($1,$2,$3,0,$4)`,
      [em, otpHash, expires, Date.now()]
    );
    const tpl = mailer.resetOtpTemplate({ name: user.name, otp });
    const result = await mailer.sendMail({ to: em, subject: tpl.subject, html: tpl.html, text: tpl.text });
    const out = { ok: true };
    if (!mailer.configured()) out.dev_otp = otp; // dev fallback when no mailer configured
    return res.json(out);
  }
  // No account (or OAuth-only): respond OK without sending to avoid account enumeration.
  res.json({ ok: true });
}));

// Internal: validate the latest OTP for an email. Returns the row id if valid.
async function validateResetOtp(email, otp) {
  const r = await q(
    `SELECT id, otp_hash, expires_at, used FROM password_reset_otps
      WHERE email = $1 ORDER BY created_at DESC LIMIT 1`,
    [email]
  );
  if (r.rowCount === 0) return { ok: false, error: 'No reset code found. Please request a new one.' };
  const row = r.rows[0];
  if (row.used === 1) return { ok: false, error: 'This code has already been used. Please request a new one.' };
  if (Number(row.expires_at) < Date.now()) return { ok: false, error: 'This code has expired. Please request a new one.' };
  if (!bcrypt.compareSync(String(otp || ''), row.otp_hash)) return { ok: false, error: 'Incorrect code. Please try again.' };
  return { ok: true, id: row.id };
}

// Step 2: verify the code (does NOT consume it yet — final reset consumes it).
app.post('/api/auth/forgot-password/verify', forgotLimiter, wrap(async (req, res) => {
  const em = String((req.body && req.body.email) || '').toLowerCase().trim();
  const otp = String((req.body && req.body.otp) || '').trim();
  if (!em || !otp) return res.status(400).json({ error: 'Email and code are required.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (!/^\d{6}$/.test(otp)) return res.status(400).json({ error: 'Enter the 6-digit code.' });
  const v = await validateResetOtp(em, otp);
  if (!v.ok) return res.status(400).json({ error: v.error });
  res.json({ ok: true });
}));

// Step 3: reset the password (consumes the code, one-time use).
app.post('/api/auth/forgot-password/reset', forgotLimiter, wrap(async (req, res) => {
  const em = String((req.body && req.body.email) || '').toLowerCase().trim();
  const otp = String((req.body && req.body.otp) || '').trim();
  const newPassword = String((req.body && req.body.password) || '');
  if (!em || !otp || !newPassword) return res.status(400).json({ error: 'Email, code and new password are required.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (!/^\d{6}$/.test(otp)) return res.status(400).json({ error: 'Enter the 6-digit code.' });
  // Enforce the same strong password policy as signup (min 8, upper/lower/number/special).
  const pwErr = validatePassword(newPassword);
  if (pwErr) return res.status(400).json({ error: pwErr });
  const v = await validateResetOtp(em, otp);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const user = await findUserByEmail(em);
  if (!user) return res.status(400).json({ error: 'Account not found.' });
  // Mark code used (one-time) and update the password hash.
  await q(`UPDATE password_reset_otps SET used = 1 WHERE id = $1`, [v.id]);
  await q(`UPDATE users SET password_hash = $1 WHERE id = $2`, [bcrypt.hashSync(newPassword, 10), user.id]);
  res.json({ ok: true });
}));

app.get('/api/me', authRequired, wrap(async (req, res) => {
  // Hot path (runs on every page load): fetch the user row and connection count
  // in a single round-trip instead of two sequential queries.
  const r = await q(
    `SELECT u.*, (SELECT COUNT(*)::int FROM connections c
        WHERE (c.user_a = u.id OR c.user_b = u.id) AND c.accepted = 1) AS connection_count
       FROM users u WHERE u.id = $1`,
    [req.user.id]
  );
  if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  const u = r.rows[0];
  res.json({ user: buildUserDTO(u, u.id, u.connection_count, null) });
}));

app.put('/api/me', authRequired, wrap(async (req, res) => {
  const u = await findUser(req.user.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const fields = ['name', 'headline', 'about', 'location'];
  const jsonFields = ['experience', 'education', 'skills'];
  const sets = [], params = [];
  let i = 1;
  for (const f of fields) if (req.body[f] !== undefined) { sets.push(`${f} = $${i++}`); params.push(req.body[f]); }
  for (const f of jsonFields) if (req.body[f] !== undefined) {
    sets.push(`${f} = $${i++}::jsonb`); params.push(JSON.stringify(req.body[f]));
  }
  if (sets.length) {
    params.push(u.id);
    await q(`UPDATE users SET ${sets.join(', ')} WHERE id = $${i}`, params);
  }
  const fresh = await findUser(u.id);
  res.json({ user: await publicUser(fresh, fresh.id) });
}));

// --- Privacy / account settings (Settings & Privacy menu) ---
// Update any of the three privacy switches. Online-visibility changes are
// reflected live: we flip the in-memory presence flag and broadcast the
// resulting state so peers' green dots update immediately.
app.put('/api/me/settings', authRequired, wrap(async (req, res) => {
  const body = req.body || {};
  const sets = [], params = [];
  let i = 1;
  if (body.is_online_visible !== undefined) {
    sets.push(`is_online_visible = $${i++}`); params.push(!!body.is_online_visible);
  }
  if (body.is_last_seen_visible !== undefined) {
    sets.push(`is_last_seen_visible = $${i++}`); params.push(!!body.is_last_seen_visible);
  }
  if (body.profile_visibility !== undefined) {
    const v = String(body.profile_visibility);
    if (v !== 'public' && v !== 'private') {
      return res.status(400).json({ error: "profile_visibility must be 'public' or 'private'." });
    }
    sets.push(`profile_visibility = $${i++}`); params.push(v);
  }
  if (!sets.length) return res.status(400).json({ error: 'No settings provided.' });

  params.push(req.user.id);
  await q(`UPDATE users SET ${sets.join(', ')} WHERE id = $${i}`, params);

  // Live presence reconciliation when "Active status" was toggled.
  if (body.is_online_visible !== undefined) {
    const hide = !body.is_online_visible;
    setPresenceHidden(req.user.id, hide);
    if (isUserOnline(req.user.id)) {
      // hide -> tell peers we went "offline"; show -> tell peers we're "online".
      if (hide) {
        // broadcastPresence(online=true) would be suppressed now, so send offline.
        broadcastPresence(req.user.id, false);
      } else {
        broadcastPresence(req.user.id, true);
      }
    }
  }

  const fresh = await findUser(req.user.id);
  res.json({ user: await publicUser(fresh, fresh.id) });
}));

// --- Change password (logged-in user) ---
app.post('/api/auth/change-password', authRequired, wrap(async (req, res) => {
  const oldPassword = String((req.body && req.body.oldPassword) || '');
  const newPassword = String((req.body && req.body.newPassword) || '');
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required.' });
  }
  const user = await findUser(req.user.id);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  if (!user.password_hash) {
    return res.status(400).json({ error: 'Your account uses social login, so it has no password to change.' });
  }
  if (!bcrypt.compareSync(oldPassword, user.password_hash)) {
    return res.status(400).json({ error: 'Your current password is incorrect.' });
  }
  const pwErr = validatePassword(newPassword);
  if (pwErr) return res.status(400).json({ error: pwErr });
  if (bcrypt.compareSync(newPassword, user.password_hash)) {
    return res.status(400).json({ error: 'New password must be different from the current one.' });
  }
  await q(`UPDATE users SET password_hash = $1 WHERE id = $2`, [bcrypt.hashSync(newPassword, 10), user.id]);
  res.json({ ok: true });
}));

// --- Delete account (hard delete) ---
// Every user-owned table FKs users(id) ON DELETE CASCADE (posts, comments,
// likes, connections, messages, notifications, shares, payments, calls,
// call_signals), so a single DELETE cascades the whole graph. OTP tables are
// keyed by email (no FK), so we clear those explicitly. Finally drop any live
// SSE connections and clear the auth cookie.
app.delete('/api/users/me', authRequired, wrap(async (req, res) => {
  const uid = Number(req.user.id);
  const user = await findUser(uid);
  if (!user) return res.status(404).json({ error: 'Account not found.' });

  // Close any open realtime streams so we don't keep writing to a deleted user.
  const set = sseClients.get(uid);
  if (set) { for (const r of set) { try { r.end(); } catch (e) {} } sseClients.delete(uid); }
  setPresenceHidden(uid, false);
  broadcastPresence(uid, false); // make sure peers drop the green dot

  await q(`DELETE FROM users WHERE id = $1`, [uid]);
  // Email-keyed rows have no FK to cascade through.
  if (user.email) {
    await q(`DELETE FROM password_reset_otps WHERE email = $1`, [user.email]).catch(() => {});
    await q(`DELETE FROM email_otps WHERE email = $1`, [user.email]).catch(() => {});
  }

  clearAuthCookie(req, res);
  res.json({ ok: true });
}));

// --- Users / Profiles ---
app.get('/api/users/:id', authRequired, wrap(async (req, res) => {
  const targetId = Number(req.params.id);
  const viewerId = req.user.id;
  // Fold the user row, connection_count and viewer-relationship into ONE query
  // (instead of findUser + the two lookups inside publicUser), and run it in
  // parallel with the posts query. Cuts this hot profile endpoint from ~3
  // sequential DB round-trips down to one wave.
  const [userR, posts] = await Promise.all([
    q(
      `SELECT u.*,
              (SELECT COUNT(*)::int FROM connections c
                 WHERE (c.user_a = u.id OR c.user_b = u.id) AND c.accepted = 1) AS connection_count,
              (SELECT c.user_a FROM connections c
                 WHERE (c.user_a = $2 AND c.user_b = u.id)
                    OR (c.user_b = $2 AND c.user_a = u.id) LIMIT 1) AS rel_user_a,
              (SELECT c.accepted FROM connections c
                 WHERE (c.user_a = $2 AND c.user_b = u.id)
                    OR (c.user_b = $2 AND c.user_a = u.id) LIMIT 1) AS rel_accepted,
              (SELECT profile_visibility FROM users WHERE id = $2) AS viewer_visibility
         FROM users u WHERE u.id = $1`,
      [targetId, viewerId]
    ),
    fetchPostDTOs({ viewerId, where: 'p.user_id = $2', params: [targetId], limit: 20 }),
  ]);
  if (userR.rowCount === 0) return res.status(404).json({ error: 'User not found' });
  const u = userR.rows[0];
  const rel = u.rel_user_a != null ? { user_a: u.rel_user_a, accepted: u.rel_accepted } : null;
  const profile = buildUserDTO(u, viewerId, u.connection_count, rel);
  // Respect private activity: hide a private user's posts from non-connections.
  const isConnection = rel && Number(rel.accepted) === 1;
  const canSeeActivity = viewerId === targetId || u.profile_visibility !== 'private' || isConnection;
  profile.posts = canSeeActivity ? posts : [];
  profile.activity_restricted = !canSeeActivity;
  res.json({ user: profile });

  // Profile-view notification (fire-and-forget; never blocks the response).
  // A private VIEWER stays anonymous to the owner; a public viewer is named.
  if (targetId !== viewerId) {
    recordProfileView(targetId, req.user, u.viewer_visibility === 'private').catch(() => {});
  }
}));

// Notify a profile owner that someone viewed them, throttled so a refresh /
// repeat visit doesn't spam. Public viewers are attributed; private viewers
// produce an anonymous "Someone viewed your profile" with no actor attached.
const PROFILE_VIEW_THROTTLE_MS = 6 * 60 * 60 * 1000; // 6 hours
async function recordProfileView(ownerId, viewer, anonymous) {
  const cutoff = Date.now() - PROFILE_VIEW_THROTTLE_MS;
  if (anonymous) {
    // Anonymous: dedupe per-owner within the window (we deliberately store no
    // viewer id so the visit can never be de-anonymised).
    const recent = await q(
      `SELECT 1 FROM notifications
        WHERE user_id = $1 AND type = 'profile_view_anon' AND created_at > $2 LIMIT 1`,
      [ownerId, cutoff]
    );
    if (recent.rowCount > 0) return;
    await notify(ownerId, 'profile_view_anon', null, {});
  } else {
    // Attributed: dedupe per (owner, viewer) pair within the window.
    const recent = await q(
      `SELECT 1 FROM notifications
        WHERE user_id = $1 AND type = 'profile_view' AND actor_id = $2 AND created_at > $3 LIMIT 1`,
      [ownerId, viewer.id, cutoff]
    );
    if (recent.rowCount > 0) return;
    await notify(ownerId, 'profile_view', viewer.id, {});
  }
}

// --- Search ---
app.get('/api/search', authRequired, wrap(async (req, res) => {
  const qstr = String(req.query.q || '').trim();
  if (!qstr) return res.json({ people: [], posts: [] });
  const like = '%' + qstr.toLowerCase() + '%';
  // People (with connection_count + connected flag computed in-query so we
  // don't issue 25 extra round-trips per keystroke).
  const peopleR = await q(
    `SELECT u.id, u.name, u.email, u.headline, u.about, u.location,
            u.avatar_color, u.avatar_url, u.cover_color, u.skills,
            (SELECT COUNT(*)::int FROM connections c
              WHERE (c.user_a = u.id OR c.user_b = u.id) AND c.accepted = 1) AS connection_count,
            EXISTS (SELECT 1 FROM connections c
              WHERE ((c.user_a = $1 AND c.user_b = u.id)
                 OR (c.user_b = $1 AND c.user_a = u.id))
                AND c.accepted = 1) AS connected
       FROM users u
      WHERE u.id <> $1 AND (
        LOWER(u.name) LIKE $2 OR LOWER(COALESCE(u.headline,'')) LIKE $2
        OR LOWER(COALESCE(u.location,'')) LIKE $2
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(u.skills) AS s WHERE LOWER(s) LIKE $2)
      )
      ORDER BY
        (LOWER(u.name) LIKE $2) DESC,
        u.name ASC
      LIMIT 10`,
    [req.user.id, like]
  );
  const people = peopleR.rows.map(u => ({
    id: Number(u.id), name: u.name, email: u.email,
    headline: u.headline || '', about: u.about || '', location: u.location || '',
    avatar_color: u.avatar_color, avatar_url: u.avatar_url || null,
    cover_color: u.cover_color || '#a0c4ff', skills: u.skills || [],
    connection_count: u.connection_count, connected: u.connected,
  }));
  const posts = await fetchPostDTOs({
    viewerId: req.user.id,
    where: 'LOWER(p.content) LIKE $2',
    params: [like], limit: 10
  });
  res.json({ people, posts });
}));

// --- Feed / Posts ---
// Activity scoping: a post from a PRIVATE author is only visible to the author
// themselves or a confirmed (accepted) connection. Public authors are visible
// to everyone. ($1 is the viewer id inside fetchPostDTOs.)
const VISIBLE_AUTHOR_WHERE = `(
  u.profile_visibility = 'public'
  OR p.user_id = $1
  OR EXISTS (
    SELECT 1 FROM connections c
     WHERE c.accepted = 1
       AND ((c.user_a = $1 AND c.user_b = p.user_id)
         OR (c.user_b = $1 AND c.user_a = p.user_id))
  )
)`;

app.get('/api/posts', authRequired, wrap(async (req, res) => {
  const posts = await fetchPostDTOs({ viewerId: req.user.id, where: VISIBLE_AUTHOR_WHERE, limit: 100 });
  res.json({ posts });
}));

app.post('/api/posts', authRequired, wrap(async (req, res) => {
  const { content, media_type, media_url } = req.body || {};
  if ((!content || !content.trim()) && !media_url) return res.status(400).json({ error: 'Content required' });
  const ins = await q(
    `INSERT INTO posts (user_id, content, media_type, media_url, created_at)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [req.user.id, sanitizeText((content || '').trim()), media_type || null, media_url || null, Date.now()]
  );
  const postId = Number(ins.rows[0].id);
  const post = await fetchOnePostDTO(postId, req.user.id);
  // Notify all accepted connections about the new post
  (async () => {
    try {
      const conns = await q(
        `SELECT CASE WHEN user_a = $1 THEN user_b ELSE user_a END AS uid
           FROM connections
          WHERE (user_a = $1 OR user_b = $1) AND accepted = 1`,
        [req.user.id]
      );
      for (const row of conns.rows) {
        await notify(Number(row.uid), 'new_post', req.user.id, { post_id: postId });
      }
    } catch (e) { console.error('new_post fan-out failed:', e.message); }
  })();
  res.json({ post });
}));

app.delete('/api/posts/:id', authRequired, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const r = await q(`SELECT user_id FROM posts WHERE id = $1`, [id]);
  if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  if (Number(r.rows[0].user_id) !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  await q(`DELETE FROM posts WHERE id = $1`, [id]); // cascades to likes/comments/shares
  res.json({ ok: true });
}));

const REACTION_TYPES = ['like', 'heart', 'celebrate', 'support', 'insightful', 'funny', 'sad'];

async function setReaction(userId, postId, type) {
  const postR = await q(`SELECT id, user_id FROM posts WHERE id = $1`, [postId]);
  if (postR.rowCount === 0) return { error: 'Not found' };
  const post = postR.rows[0];
  if (!type) {
    await q(`DELETE FROM likes WHERE user_id=$1 AND post_id=$2`, [userId, postId]);
    return { my_reaction: null };
  }
  if (!REACTION_TYPES.includes(type)) return { error: 'Invalid reaction' };
  const existing = await q(`SELECT 1 FROM likes WHERE user_id=$1 AND post_id=$2`, [userId, postId]);
  if (existing.rowCount > 0) {
    await q(`UPDATE likes SET type=$3 WHERE user_id=$1 AND post_id=$2`, [userId, postId, type]);
  } else {
    await q(
      `INSERT INTO likes (user_id, post_id, type, created_at) VALUES ($1,$2,$3,$4)`,
      [userId, postId, type, Date.now()]
    );
    await notify(Number(post.user_id), 'like', userId, { post_id: postId, reaction: type });
  }
  return { my_reaction: type };
}

app.post('/api/posts/:id/react', authRequired, wrap(async (req, res) => {
  const postId = Number(req.params.id);
  const { type } = req.body || {};
  const r = await setReaction(req.user.id, postId, type === null ? null : type);
  if (r.error) return res.status(400).json(r);
  res.json(r);
}));

app.post('/api/posts/:id/like', authRequired, wrap(async (req, res) => {
  const postId = Number(req.params.id);
  const existing = await q(
    `SELECT 1 FROM likes WHERE user_id=$1 AND post_id=$2`, [req.user.id, postId]
  );
  const r = await setReaction(req.user.id, postId, existing.rowCount ? null : 'like');
  if (r.error) return res.status(400).json(r);
  res.json({ liked: r.my_reaction !== null, my_reaction: r.my_reaction });
}));

app.get('/api/posts/:id/comments', authRequired, wrap(async (req, res) => {
  const postId = Number(req.params.id);
  const r = await q(
    `SELECT c.id, c.content, c.created_at, c.user_id, c.edited,
            u.name, u.avatar_color, u.avatar_url, u.headline
       FROM comments c JOIN users u ON u.id = c.user_id
      WHERE c.post_id = $1
      ORDER BY c.created_at ASC`,
    [postId]
  );
  res.json({ comments: r.rows.map(x => ({
    id: Number(x.id), content: x.content, created_at: Number(x.created_at),
    user_id: Number(x.user_id), name: x.name, avatar_color: x.avatar_color,
    avatar_url: x.avatar_url || null, headline: x.headline, edited: x.edited ? 1 : 0,
  })) });
}));

app.post('/api/posts/:id/comments', authRequired, wrap(async (req, res) => {
  const postId = Number(req.params.id);
  const postR = await q(`SELECT id, user_id FROM posts WHERE id = $1`, [postId]);
  if (postR.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  const { content } = req.body || {};
  if (!content || !content.trim()) return res.status(400).json({ error: 'Content required' });
  const ins = await q(
    `INSERT INTO comments (user_id, post_id, content, created_at) VALUES ($1,$2,$3,$4) RETURNING id`,
    [req.user.id, postId, sanitizeText(content.trim()), Date.now()]
  );
  await notify(Number(postR.rows[0].user_id), 'comment', req.user.id,
    { post_id: postId, comment_id: Number(ins.rows[0].id) });
  res.json({ id: Number(ins.rows[0].id) });
}));

// Edit a comment — author only, within EDIT_WINDOW_MS (2 minutes).
app.put('/api/comments/:id', authRequired, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const { content } = req.body || {};
  if (!content || !content.trim()) return res.status(400).json({ error: 'Content required' });
  const r = await q(`SELECT user_id, created_at FROM comments WHERE id = $1`, [id]);
  if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  if (Number(r.rows[0].user_id) !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  if (Date.now() - Number(r.rows[0].created_at) > EDIT_WINDOW_MS) {
    return res.status(403).json({ error: 'The 2-minute edit window has passed.' });
  }
  const clean = sanitizeText(content.trim()).trim();
  if (!clean) return res.status(400).json({ error: 'Content required' });
  await q(`UPDATE comments SET content = $1, edited = 1 WHERE id = $2`, [clean, id]);
  res.json({ ok: true, content: clean, edited: 1 });
}));

// Delete a comment — author only, within DELETE_WINDOW_MS (5 minutes).
app.delete('/api/comments/:id', authRequired, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const r = await q(`SELECT user_id, created_at FROM comments WHERE id = $1`, [id]);
  if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  if (Number(r.rows[0].user_id) !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  if (Date.now() - Number(r.rows[0].created_at) > DELETE_WINDOW_MS) {
    return res.status(403).json({ error: 'The 5-minute delete window has passed.' });
  }
  await q(`DELETE FROM comments WHERE id = $1`, [id]);
  res.json({ ok: true });
}));

app.post('/api/posts/:id/repost', authRequired, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const origR = await q(`SELECT id, user_id FROM posts WHERE id = $1`, [id]);
  if (origR.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  const ins = await q(
    `INSERT INTO posts (user_id, content, repost_of, created_at) VALUES ($1,$2,$3,$4) RETURNING id`,
    [req.user.id, sanitizeText((req.body && req.body.content) || ''), id, Date.now()]
  );
  await notify(Number(origR.rows[0].user_id), 'repost', req.user.id, { post_id: id });
  const post = await fetchOnePostDTO(ins.rows[0].id, req.user.id);
  res.json({ post });
}));

app.post('/api/posts/:id/share', authRequired, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const postR = await q(`SELECT id, user_id FROM posts WHERE id = $1`, [id]);
  if (postR.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  await q(`INSERT INTO shares (user_id, post_id, created_at) VALUES ($1,$2,$3)`,
    [req.user.id, id, Date.now()]);
  await notify(Number(postR.rows[0].user_id), 'share', req.user.id, { post_id: id });
  res.json({ ok: true });
}));

app.post('/api/posts/:id/send', authRequired, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const { to_user_id, note } = req.body || {};
  const postR = await q(`SELECT id, content FROM posts WHERE id = $1`, [id]);
  const recipient = await findUser(Number(to_user_id));
  if (postR.rowCount === 0 || !recipient) return res.status(404).json({ error: 'Not found' });
  const text = `${note ? sanitizeText(note) + '\n\n' : ''}[Shared post #${id}] ${postR.rows[0].content || ''}`.trim();
  const ins = await q(
    `INSERT INTO messages (from_id, to_id, content, attached_post_id, created_at, read)
     VALUES ($1,$2,$3,$4,$5,0) RETURNING id`,
    [req.user.id, recipient.id, text, id, Date.now()]
  );
  await notify(Number(recipient.id), 'message', req.user.id, { message_id: Number(ins.rows[0].id) });
  res.json({ ok: true });
}));

// --- People / Connections ---
app.get('/api/people', authRequired, wrap(async (req, res) => {
  const r = await q(
    `SELECT * FROM users WHERE id <> $1 ORDER BY RANDOM() LIMIT 20`, [req.user.id]
  );
  const userMap = await publicUsersByIds(r.rows.map(u => u.id), req.user.id);
  const out = r.rows.map(u => userMap.get(Number(u.id))).filter(Boolean);
  res.json({ people: out });
}));

app.post('/api/people/:id/connect', authRequired, wrap(async (req, res) => {
  const other = Number(req.params.id);
  if (other === req.user.id) return res.status(400).json({ error: 'Cannot connect with yourself' });
  const u = await findUser(other);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const exists = await q(
    `SELECT user_a, user_b, accepted FROM connections
      WHERE (user_a=$1 AND user_b=$2) OR (user_a=$2 AND user_b=$1) LIMIT 1`,
    [req.user.id, other]
  );
  if (exists.rowCount === 0) {
    // Send a new request (pending)
    await q(
      `INSERT INTO connections (user_a, user_b, created_at, accepted)
       VALUES ($1,$2,$3,0)`,
      [req.user.id, other, Date.now()]
    );
    await notify(other, 'connection_request', req.user.id, {});
    return res.json({ ok: true, status: 'pending' });
  }
  const row = exists.rows[0];
  if (row.accepted === 1) return res.json({ ok: true, status: 'connected' });
  // Pending exists. If they sent it to me, accept it (mutual click).
  if (Number(row.user_a) === other) {
    await q(
      `UPDATE connections SET accepted = 1
        WHERE user_a = $1 AND user_b = $2`, [other, req.user.id]
    );
    await notify(other, 'connect_accepted', req.user.id, {});
    return res.json({ ok: true, status: 'connected' });
  }
  // I already sent the request — no-op
  res.json({ ok: true, status: 'pending' });
}));

app.post('/api/connections/:id/accept', authRequired, wrap(async (req, res) => {
  const other = Number(req.params.id);
  const upd = await q(
    `UPDATE connections SET accepted = 1
      WHERE user_a = $1 AND user_b = $2 AND accepted = 0 RETURNING 1`,
    [other, req.user.id]
  );
  if (upd.rowCount === 0) return res.status(404).json({ error: 'No pending request' });
  await notify(other, 'connect_accepted', req.user.id, {});
  res.json({ ok: true });
}));

app.post('/api/connections/:id/decline', authRequired, wrap(async (req, res) => {
  const other = Number(req.params.id);
  await q(
    `DELETE FROM connections
      WHERE user_a = $1 AND user_b = $2 AND accepted = 0`,
    [other, req.user.id]
  );
  res.json({ ok: true });
}));

app.post('/api/people/:id/disconnect', authRequired, wrap(async (req, res) => {
  const other = Number(req.params.id);
  await q(
    `DELETE FROM connections WHERE (user_a=$1 AND user_b=$2) OR (user_a=$2 AND user_b=$1)`,
    [req.user.id, other]
  );
  res.json({ ok: true });
}));

app.get('/api/connections', authRequired, wrap(async (req, res) => {
  // Everyone in this list is an accepted connection of the viewer, so we already
  // know the relationship (connected). Fetch the user rows together with their
  // connection_count inline — one query instead of a second publicUsersByIds
  // wave that redundantly re-selected the same user rows.
  const viewerId = req.user.id;
  const r = await q(
    `SELECT u.*,
            (SELECT COUNT(*)::int FROM connections c2
               WHERE (c2.user_a = u.id OR c2.user_b = u.id) AND c2.accepted = 1) AS connection_count
       FROM users u
       JOIN connections c
         ON ((c.user_a = $1 AND c.user_b = u.id)
          OR (c.user_b = $1 AND c.user_a = u.id))
        AND c.accepted = 1`,
    [viewerId]
  );
  const rel = { user_a: viewerId, accepted: 1 };
  const out = r.rows.map(u => buildUserDTO(u, viewerId, u.connection_count, rel));
  res.json({ connections: out });
}));

// Pending connection requests sent TO me
app.get('/api/connections/requests', authRequired, wrap(async (req, res) => {
  const r = await q(
    `SELECT u.*, c.created_at AS requested_at FROM users u
       JOIN connections c ON c.user_a = u.id AND c.user_b = $1 AND c.accepted = 0
      ORDER BY c.created_at DESC`,
    [req.user.id]
  );
  const userMap = await publicUsersByIds(r.rows.map(u => u.id), req.user.id);
  const out = [];
  for (const u of r.rows) {
    const p = userMap.get(Number(u.id));
    if (!p) continue;
    p.requested_at = Number(u.requested_at);
    out.push(p);
  }
  res.json({ requests: out });
}));

// --- Calls (WebRTC signaling + logs) ---
async function areConnected(a, b) {
  const r = await q(
    `SELECT 1 FROM connections
      WHERE ((user_a=$1 AND user_b=$2) OR (user_a=$2 AND user_b=$1)) AND accepted = 1
      LIMIT 1`,
    [Number(a), Number(b)]
  );
  return r.rowCount > 0;
}

async function callDTO(row, viewerId, userMap) {
  const caller = userMap
    ? (userMap.get(Number(row.caller_id)) || null)
    : await publicUser(await findUser(Number(row.caller_id)), viewerId);
  const receiver = userMap
    ? (userMap.get(Number(row.receiver_id)) || null)
    : await publicUser(await findUser(Number(row.receiver_id)), viewerId);
  return {
    id: Number(row.id),
    caller_id: Number(row.caller_id),
    receiver_id: Number(row.receiver_id),
    call_type: row.call_type,
    status: row.status,
    started_at: row.started_at ? Number(row.started_at) : null,
    ended_at: row.ended_at ? Number(row.ended_at) : null,
    duration_seconds: row.duration_seconds != null ? Number(row.duration_seconds) : null,
    created_at: Number(row.created_at),
    caller, receiver,
  };
}

async function getCallParticipant(callId, userId) {
  const r = await q(`SELECT * FROM calls WHERE id = $1 LIMIT 1`, [Number(callId)]);
  if (r.rowCount === 0) return { error: 'Call not found', code: 404 };
  const call = r.rows[0];
  if (Number(call.caller_id) !== Number(userId) && Number(call.receiver_id) !== Number(userId)) {
    return { error: 'Forbidden', code: 403 };
  }
  return { call };
}

// Start a call (caller). Only allowed between accepted connections.
app.post('/api/calls', authRequired, wrap(async (req, res) => {
  const receiverId = Number((req.body && req.body.receiver_id));
  const callType = String((req.body && req.body.call_type) || 'audio');
  if (!receiverId || receiverId === req.user.id) return res.status(400).json({ error: 'Invalid receiver' });
  if (!['audio', 'video'].includes(callType)) return res.status(400).json({ error: 'Invalid call type' });
  const u = await findUser(receiverId);
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (!(await areConnected(req.user.id, receiverId))) {
    return res.status(403).json({ error: 'You can only call connected users.' });
  }
  const ins = await q(
    `INSERT INTO calls (caller_id, receiver_id, call_type, status, created_at)
     VALUES ($1,$2,$3,'ringing',$4) RETURNING *`,
    [req.user.id, receiverId, callType, Date.now()]
  );
  const dto = await callDTO(ins.rows[0], receiverId);
  sseSend(receiverId, 'call_invite', { call: dto });
  res.json({ call: await callDTO(ins.rows[0], req.user.id) });
}));

// Receiver accepts.
app.post('/api/calls/:id/accept', authRequired, wrap(async (req, res) => {
  const { call, error, code } = await getCallParticipant(req.params.id, req.user.id);
  if (error) return res.status(code).json({ error });
  if (Number(call.receiver_id) !== req.user.id) return res.status(403).json({ error: 'Only the receiver can accept' });
  if (call.status !== 'ringing') return res.status(409).json({ error: 'Call no longer ringing' });
  const upd = await q(
    `UPDATE calls SET status='accepted', started_at=$1 WHERE id=$2 RETURNING *`,
    [Date.now(), call.id]
  );
  const dto = await callDTO(upd.rows[0], req.user.id);
  sseSend(Number(call.caller_id), 'call_accept', { call: dto });
  res.json({ call: dto });
}));

// Receiver rejects.
app.post('/api/calls/:id/reject', authRequired, wrap(async (req, res) => {
  const { call, error, code } = await getCallParticipant(req.params.id, req.user.id);
  if (error) return res.status(code).json({ error });
  if (call.status !== 'ringing') return res.json({ ok: true });
  const upd = await q(`UPDATE calls SET status='rejected', ended_at=$1 WHERE id=$2 RETURNING *`, [Date.now(), call.id]);
  sseSend(Number(call.caller_id), 'call_reject', { call: await callDTO(upd.rows[0], Number(call.caller_id)) });
  res.json({ ok: true });
}));

// Caller cancels before it's answered → logged as missed.
app.post('/api/calls/:id/cancel', authRequired, wrap(async (req, res) => {
  const { call, error, code } = await getCallParticipant(req.params.id, req.user.id);
  if (error) return res.status(code).json({ error });
  if (call.status !== 'ringing') return res.json({ ok: true });
  const upd = await q(`UPDATE calls SET status='missed', ended_at=$1 WHERE id=$2 RETURNING *`, [Date.now(), call.id]);
  sseSend(Number(call.receiver_id), 'call_cancel', { call: await callDTO(upd.rows[0], Number(call.receiver_id)) });
  res.json({ ok: true });
}));

// Either party ends an active/ringing call.
app.post('/api/calls/:id/end', authRequired, wrap(async (req, res) => {
  const { call, error, code } = await getCallParticipant(req.params.id, req.user.id);
  if (error) return res.status(code).json({ error });
  if (['ended', 'rejected', 'missed'].includes(call.status)) {
    return res.json({ call: await callDTO(call, req.user.id) });
  }
  const now = Date.now();
  let status = 'ended';
  let duration = null;
  if (call.status === 'accepted' && call.started_at) {
    duration = Math.max(0, Math.round((now - Number(call.started_at)) / 1000));
  } else {
    status = 'missed'; // ended while still ringing
  }
  const upd = await q(
    `UPDATE calls SET status=$1, ended_at=$2, duration_seconds=$3 WHERE id=$4 RETURNING *`,
    [status, now, duration, call.id]
  );
  const other = Number(call.caller_id) === req.user.id ? Number(call.receiver_id) : Number(call.caller_id);
  sseSend(other, 'call_end', { call: await callDTO(upd.rows[0], other) });
  res.json({ call: await callDTO(upd.rows[0], req.user.id) });
}));

// Relay a WebRTC signaling message to the other participant.
app.post('/api/calls/:id/signal', authRequired, wrap(async (req, res) => {
  const { call, error, code } = await getCallParticipant(req.params.id, req.user.id);
  if (error) return res.status(code).json({ error });
  const type = String((req.body && req.body.type) || '');
  const payload = (req.body && req.body.payload) || {};
  const allowed = ['webrtc_offer', 'webrtc_answer', 'ice_candidate', 'screen_share_started', 'screen_share_stopped'];
  if (!allowed.includes(type)) return res.status(400).json({ error: 'Invalid signal type' });
  const other = Number(call.caller_id) === req.user.id ? Number(call.receiver_id) : Number(call.caller_id);
  await q(
    `INSERT INTO call_signals (call_id, sender_id, receiver_id, type, payload, created_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
    [call.id, req.user.id, other, type, JSON.stringify(payload), Date.now()]
  );
  sseSend(other, 'call_signal', { call_id: Number(call.id), type, payload, sender_id: req.user.id });
  res.json({ ok: true });
}));

// Call history with a specific user (last 30 days).
app.get('/api/calls/logs/:userId', authRequired, wrap(async (req, res) => {
  const other = Number(req.params.userId);
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const r = await q(
    `SELECT * FROM calls
      WHERE created_at >= $3
        AND ((caller_id=$1 AND receiver_id=$2) OR (caller_id=$2 AND receiver_id=$1))
      ORDER BY created_at DESC LIMIT 50`,
    [req.user.id, other, cutoff]
  );
  const ids = [];
  for (const row of r.rows) { ids.push(row.caller_id, row.receiver_id); }
  const userMap = await publicUsersByIds(ids, req.user.id);
  const logs = [];
  for (const row of r.rows) logs.push(await callDTO(row, req.user.id, userMap));
  res.json({ logs });
}));

// --- Messaging ---

// Chat attachments: allowlisted MIME types (no SVG/HTML/executables) up to 5 MB.
const ATTACH_MAX_BYTES = 5 * 1024 * 1024;
const ATTACH_MIME_EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'application/pdf': 'pdf', 'text/plain': 'txt',
  'application/zip': 'zip', 'application/x-zip-compressed': 'zip',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/webm': 'weba',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/ogg': 'ogv',
};
function sanitizeFilename(name) {
  if (!name || typeof name !== 'string') return null;
  const clean = name.replace(/[\r\n]/g, ' ').replace(/[^\w.\- ]+/g, '_').trim().slice(0, 120);
  return clean || null;
}
// In-memory multipart parser for chat attachments. memoryStorage keeps the file
// as a Buffer (we forward it straight to Supabase Storage), capped at 5 MB so a
// hostile client can't exhaust memory. Errors are translated to clean JSON.
const attachUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ATTACH_MAX_BYTES, files: 1 },
});
function uploadAttachment(req, res, next) {
  attachUpload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Attachment too large (max 5 MB)' });
      return res.status(400).json({ error: 'Upload failed' });
    }
    next();
  });
}
// Validate type + size, upload the raw bytes to storage, and return
// { url, type, name, size } — or throw an { status, message } shaped error.
async function storeChatBuffer(buf, mime, originalName, fromId, toId) {
  mime = String(mime || '').toLowerCase();
  const ext = ATTACH_MIME_EXT[mime];
  if (!ext) throw { status: 415, message: 'Unsupported file type' };
  if (!buf || !buf.length) throw { status: 400, message: 'Empty attachment' };
  if (buf.length > ATTACH_MAX_BYTES) throw { status: 413, message: 'Attachment too large (max 5 MB)' };
  const name = sanitizeFilename(originalName) || `file.${ext}`;
  const key = `chat/${fromId}_${toId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  let url;
  if (storage.enabled()) {
    url = await storage.uploadFile(key, buf, mime);
  } else {
    const uploads = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(uploads)) fs.mkdirSync(uploads, { recursive: true });
    const local = key.replace(/\//g, '_');
    fs.writeFileSync(path.join(uploads, local), buf);
    url = `/uploads/${local}`;
  }
  return { url, type: mime, name, size: buf.length };
}
// Backwards-compatible base64 data-URL path (clipboard paste fallback / old
// clients). Decodes to a Buffer then reuses storeChatBuffer.
async function storeChatAttachment(att, fromId, toId) {
  const m = String(att.data_url || '').match(/^data:([\w.+-]+\/[\w.+-]+);base64,(.+)$/);
  if (!m) throw { status: 400, message: 'Invalid attachment' };
  return storeChatBuffer(Buffer.from(m[2], 'base64'), m[1], att.name, fromId, toId);
}
function messageDTO(m) {
  return {
    id: Number(m.id), from_id: Number(m.from_id), to_id: Number(m.to_id),
    content: m.content,
    attached_post_id: m.attached_post_id ? Number(m.attached_post_id) : null,
    attachment: m.attachment_url ? {
      url: m.attachment_url, type: m.attachment_type || '',
      name: m.attachment_name || '', size: m.attachment_size != null ? Number(m.attachment_size) : null,
    } : null,
    created_at: Number(m.created_at), read: m.read, edited: m.edited ? 1 : 0,
  };
}

app.get('/api/messages/threads', authRequired, wrap(async (req, res) => {
  const r = await q(
    `WITH mine AS (
       SELECT *, CASE WHEN from_id = $1 THEN to_id ELSE from_id END AS other_id
         FROM messages WHERE from_id = $1 OR to_id = $1
     ),
     latest AS (
       SELECT DISTINCT ON (other_id) other_id, id, from_id, to_id, content, attachment_type, created_at, read
         FROM mine
         ORDER BY other_id, created_at DESC
     )
     SELECT l.*,
            (SELECT COUNT(*)::int FROM messages m WHERE m.from_id = l.other_id AND m.to_id = $1 AND m.read = 0) AS unread
       FROM latest l
       ORDER BY l.created_at DESC`,
    [req.user.id]
  );
  const userMap = await publicUsersByIds(r.rows.map(row => row.other_id), req.user.id);
  const threads = [];
  for (const row of r.rows) {
    threads.push({
      user: userMap.get(Number(row.other_id)) || null,
      last_message: {
        id: Number(row.id), from_id: Number(row.from_id), to_id: Number(row.to_id),
        content: row.content, attachment_type: row.attachment_type || null,
        created_at: Number(row.created_at), read: row.read,
      },
      unread: row.unread,
    });
  }
  res.json({ threads });
}));

app.get('/api/messages/:userId', authRequired, wrap(async (req, res) => {
  const other = Number(req.params.userId);
  // User lookup, thread fetch, and marking-as-read are independent → run them
  // together so the whole endpoint costs ~one round-trip of latency.
  const [u, r, upd] = await Promise.all([
    findUser(other),
    q(`SELECT id, from_id, to_id, content, attached_post_id, attachment_url, attachment_type, attachment_name, attachment_size, created_at, read, edited
         FROM messages
        WHERE (from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1)
        ORDER BY created_at ASC`, [req.user.id, other]),
    q(`UPDATE messages SET read = 1 WHERE from_id = $1 AND to_id = $2 AND read = 0`, [other, req.user.id]),
  ]);
  if (!u) return res.status(404).json({ error: 'User not found' });
  // If we just marked the peer's messages as read, tell the peer live so their
  // outgoing bubbles flip from a grey single tick to a blue double tick.
  if (upd && upd.rowCount > 0) {
    sseSend(other, 'message', { action: 'read', by: req.user.id });
  }
  const messages = r.rows.map(messageDTO);
  res.json({ user: await publicUser(u, req.user.id), messages });
}));

// Lightweight read-marker. The live message handler calls this when a new
// message lands in the open conversation — flipping the peer's messages to
// "read" and pinging them, WITHOUT re-fetching the entire thread (which
// re-ran a full SELECT and re-sent every message + attachment URL each time).
app.post('/api/messages/:userId/read', authRequired, wrap(async (req, res) => {
  const other = Number(req.params.userId);
  const upd = await q(
    `UPDATE messages SET read = 1 WHERE from_id = $1 AND to_id = $2 AND read = 0`,
    [other, req.user.id]
  );
  if (upd.rowCount > 0) sseSend(other, 'message', { action: 'read', by: req.user.id });
  res.json({ ok: true, updated: upd.rowCount });
}));

app.post('/api/messages/:userId', authRequired, uploadAttachment, wrap(async (req, res) => {
  const other = Number(req.params.userId);
  const u = await findUser(other);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const { content, attachment } = req.body || {};
  const text = (content || '').trim();

  let att = null;
  try {
    if (req.file) {
      // Preferred path: raw binary via multipart/form-data (no base64 bloat).
      att = await storeChatBuffer(req.file.buffer, req.file.mimetype, req.file.originalname, req.user.id, other);
    } else if (attachment && attachment.data_url) {
      // Fallback path: base64 data URL (older clients / clipboard paste).
      att = await storeChatAttachment(attachment, req.user.id, other);
    }
  } catch (e) {
    if (e && e.status) return res.status(e.status).json({ error: e.message });
    console.error('Attachment upload failed:', e && e.message);
    return res.status(502).json({ error: 'Upload failed' });
  }
  if (!text && !att) return res.status(400).json({ error: 'Content required' });

  const ins = await q(
    `INSERT INTO messages (from_id, to_id, content, attachment_url, attachment_type, attachment_name, attachment_size, created_at, read)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0) RETURNING *`,
    [req.user.id, other, sanitizeText(text), att ? att.url : null, att ? att.type : null,
     att ? att.name : null, att ? att.size : null, Date.now()]
  );
  const m = ins.rows[0];
  const dto = messageDTO(m);
  // Respond to the sender immediately; the notification + realtime fan-out (for
  // the receiver and other tabs) don't need to block the HTTP response.
  res.json({ message: dto });
  (async () => {
    await notify(other, 'message', req.user.id, { message_id: Number(m.id) });
    const [sender, peer] = await Promise.all([
      publicUser(await findUser(req.user.id), other),
      publicUser(u, req.user.id),
    ]);
    sseSend(other, 'message', { message: dto, peer: sender, action: 'new' });
    sseSend(req.user.id, 'message', { message: dto, peer, action: 'new' });
  })().catch(() => {});
}));

// Edit a message — sender only, within EDIT_WINDOW_MS (2 minutes).
app.put('/api/messages/:id', authRequired, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const { content } = req.body || {};
  if (!content || !content.trim()) return res.status(400).json({ error: 'Content required' });
  const r = await q(`SELECT from_id, to_id, created_at FROM messages WHERE id = $1`, [id]);
  if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  const row = r.rows[0];
  if (Number(row.from_id) !== req.user.id) return res.status(403).json({ error: 'You can only edit your own messages.' });
  if (Date.now() - Number(row.created_at) > EDIT_WINDOW_MS) {
    return res.status(403).json({ error: 'The 2-minute edit window has passed.' });
  }
  const clean = sanitizeText(content.trim()).trim();
  if (!clean) return res.status(400).json({ error: 'Content required' });
  await q(`UPDATE messages SET content = $1, edited = 1 WHERE id = $2`, [clean, id]);
  const other = Number(row.to_id);
  const payload = { message: { id, from_id: Number(row.from_id), to_id: other, content: clean, edited: 1 }, action: 'update' };
  sseSend(other, 'message', payload);
  sseSend(req.user.id, 'message', payload);
  res.json({ ok: true, content: clean, edited: 1 });
}));

// Delete a message — sender only, within DELETE_WINDOW_MS (5 minutes).
app.delete('/api/messages/:id', authRequired, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const r = await q(`SELECT from_id, to_id, created_at FROM messages WHERE id = $1`, [id]);
  if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  const row = r.rows[0];
  if (Number(row.from_id) !== req.user.id) return res.status(403).json({ error: 'You can only delete your own messages.' });
  if (Date.now() - Number(row.created_at) > DELETE_WINDOW_MS) {
    return res.status(403).json({ error: 'The 5-minute delete window has passed.' });
  }
  await q(`DELETE FROM messages WHERE id = $1`, [id]);
  const other = Number(row.to_id);
  const payload = { message: { id, from_id: Number(row.from_id), to_id: other }, action: 'delete' };
  sseSend(other, 'message', payload);
  sseSend(req.user.id, 'message', payload);
  res.json({ ok: true });
}));

// --- Notifications ---
app.get('/api/notifications', authRequired, wrap(async (req, res) => {
  const r = await q(
    `SELECT n.id, n.user_id, n.type, n.actor_id, n.payload, n.read, n.created_at
       FROM notifications n
      WHERE n.user_id = $1
      ORDER BY n.created_at DESC
      LIMIT 100`,
    [req.user.id]
  );
  const userMap = await publicUsersByIds(r.rows.map(n => n.actor_id), req.user.id);
  const items = [];
  for (const n of r.rows) {
    const actor = n.actor_id ? (userMap.get(Number(n.actor_id)) || null) : null;
    items.push({
      id: Number(n.id), user_id: Number(n.user_id), type: n.type,
      actor_id: n.actor_id ? Number(n.actor_id) : null,
      payload: n.payload || {}, read: n.read, created_at: Number(n.created_at),
      actor,
    });
  }
  const unread = items.filter(n => !n.read).length;
  res.json({ notifications: items, unread });
}));

app.post('/api/notifications/read', authRequired, wrap(async (req, res) => {
  await q(`UPDATE notifications SET read = 1 WHERE user_id = $1 AND read = 0`, [req.user.id]);
  res.json({ ok: true });
}));

// --- Avatar upload (base64 data URL → Supabase Storage) ---
const storage = require('./lib/supabase-storage');

app.post('/api/me/avatar', authRequired, wrap(async (req, res) => {
  const { data_url } = req.body || {};
  if (!data_url || typeof data_url !== 'string') return res.status(400).json({ error: 'data_url required' });
  const m = data_url.match(/^data:(image\/(png|jpe?g|gif|webp));base64,(.+)$/i);
  if (!m) return res.status(400).json({ error: 'Invalid image (must be png/jpg/gif/webp data URL)' });
  const mime = m[1].toLowerCase();
  const ext = m[2].toLowerCase() === 'jpeg' ? 'jpg' : m[2].toLowerCase();
  const buf = Buffer.from(m[3], 'base64');
  if (buf.length > 4 * 1024 * 1024) return res.status(413).json({ error: 'Image too large (max 4 MB)' });
  const filename = `avatar_${req.user.id}_${Date.now()}.${ext}`;

  let url;
  try {
    if (storage.enabled()) {
      // Best-effort delete of previous Supabase avatar
      const prev = await findUser(req.user.id);
      if (prev && prev.avatar_url && storage.isSupabaseUrl(prev.avatar_url)) {
        storage.deleteAvatar(prev.avatar_url).catch(() => {});
      }
      url = await storage.uploadAvatar(filename, buf, mime);
    } else {
      // Local fallback (dev only) — Railway filesystem is ephemeral
      const uploads = path.join(__dirname, 'public', 'uploads');
      if (!fs.existsSync(uploads)) fs.mkdirSync(uploads, { recursive: true });
      fs.writeFileSync(path.join(uploads, filename), buf);
      url = `/uploads/${filename}`;
    }
  } catch (e) {
    console.error('Avatar upload failed:', e.message);
    return res.status(502).json({ error: 'Upload failed: ' + e.message });
  }

  await q(`UPDATE users SET avatar_url = $1 WHERE id = $2`, [url, req.user.id]);
  const u = await findUser(req.user.id);
  res.json({ user: await publicUser(u, u.id) });
}));

app.delete('/api/me/avatar', authRequired, wrap(async (req, res) => {
  const u = await findUser(req.user.id);
  if (u && u.avatar_url) {
    if (storage.isSupabaseUrl(u.avatar_url)) {
      storage.deleteAvatar(u.avatar_url).catch(() => {});
    } else if (u.avatar_url.startsWith('/uploads/')) {
      try { fs.unlinkSync(path.join(__dirname, 'public', u.avatar_url.replace(/^\//, ''))); } catch (e) {}
    }
    await q(`UPDATE users SET avatar_url = NULL WHERE id = $1`, [req.user.id]);
  }
  const fresh = await findUser(req.user.id);
  res.json({ user: await publicUser(fresh, fresh.id) });
}));

// --- Payments ---
const PLANS = {
  career:  { id: 'career',  name: 'Career',          price: 9.99,  currency: 'USD', features: ['See who viewed your profile', 'Direct messages to recruiters', 'Career insights'] },
  business:{ id: 'business',name: 'Business',        price: 39.99, currency: 'USD', features: ['Unlimited people search', 'Lead recommendations', 'Business insights', 'All Career features'] },
  premium: { id: 'premium', name: 'Premium Pro',     price: 59.99, currency: 'USD', features: ['Everything in Business', 'Learning courses included', 'Hiring tools', 'Priority support'] },
};

function luhn(num) {
  const digits = String(num).replace(/\D/g, '');
  if (digits.length < 12) return false;
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}
function detectBrand(num) {
  const n = String(num).replace(/\D/g, '');
  if (/^4/.test(n)) return 'Visa';
  if (/^5[1-5]/.test(n) || /^2[2-7]/.test(n)) return 'Mastercard';
  if (/^3[47]/.test(n)) return 'Amex';
  if (/^6/.test(n)) return 'Discover';
  return 'Card';
}

async function chargeWithStripe({ amount, currency, card }) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  const params = new URLSearchParams({
    amount: String(Math.round(amount * 100)),
    currency: currency.toLowerCase(),
    'payment_method_data[type]': 'card',
    'payment_method_data[card][number]': card.number.replace(/\s/g, ''),
    'payment_method_data[card][exp_month]': String(card.exp_month),
    'payment_method_data[card][exp_year]': String(card.exp_year),
    'payment_method_data[card][cvc]': String(card.cvc),
    confirm: 'true',
    'automatic_payment_methods[enabled]': 'true',
    'automatic_payment_methods[allow_redirects]': 'never',
  });
  const r = await fetch('https://api.stripe.com/v1/payment_intents', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const data = await r.json();
  if (!r.ok || data.error) return { ok: false, error: (data.error && data.error.message) || 'Stripe error' };
  return { ok: data.status === 'succeeded', id: data.id, status: data.status };
}

// In-memory OTP store (short-lived, suitable for OTPs)
const otpStore = new Map();

app.get('/api/payments/plans', (req, res) => res.json({ plans: Object.values(PLANS) }));

async function insertPayment(p) {
  const r = await q(
    `INSERT INTO payments (user_id, plan_id, amount, currency, method, status,
        brand, last4, gateway, gateway_id, message, wallet, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)
     RETURNING *`,
    [p.user_id, p.plan_id, p.amount, p.currency, p.method, p.status,
     p.brand || null, p.last4 || null, p.gateway || null, p.gateway_id || null,
     p.message || null, p.wallet ? JSON.stringify(p.wallet) : null, p.created_at]
  );
  return r.rows[0];
}

app.post('/api/payments/charge', authRequired, wrap(async (req, res) => {
  const { plan_id, method, card, wallet } = req.body || {};
  const plan = PLANS[plan_id];
  if (!plan) return res.status(400).json({ error: 'Invalid plan' });
  if (!method) return res.status(400).json({ error: 'Payment method required' });

  const base = {
    user_id: req.user.id, plan_id: plan.id,
    amount: plan.price, currency: plan.currency, method,
    status: 'pending', created_at: Date.now(),
  };

  if (method === 'card') {
    if (!card || !card.number || !card.exp_month || !card.exp_year || !card.cvc) {
      return res.status(400).json({ error: 'Card details incomplete' });
    }
    if (!luhn(card.number)) {
      const txn = await insertPayment({ ...base, status: 'declined', message: 'Invalid card number' });
      return res.status(402).json({ ok: false, error: 'Invalid card number' });
    }
    base.brand = detectBrand(card.number);
    base.last4 = card.number.replace(/\D/g, '').slice(-4);
    const stripe = await chargeWithStripe({ amount: plan.price, currency: plan.currency, card })
      .catch(e => ({ ok: false, error: e.message }));
    if (stripe == null) {
      const n = card.number.replace(/\D/g, '');
      const decline = /^4000\s?0000\s?0000\s?0002/.test(n);
      base.status = decline ? 'declined' : 'succeeded';
      base.gateway = 'sandbox';
      base.gateway_id = 'sb_' + Math.random().toString(36).slice(2, 12);
      if (decline) {
        await insertPayment({ ...base, message: 'Card declined by issuer' });
        return res.status(402).json({ ok: false, error: 'Card declined by issuer' });
      }
    } else if (!stripe.ok) {
      await insertPayment({ ...base, status: 'declined', gateway: 'stripe', message: stripe.error });
      return res.status(402).json({ ok: false, error: stripe.error });
    } else {
      base.status = 'succeeded'; base.gateway = 'stripe'; base.gateway_id = stripe.id;
    }
  } else if (['easypaisa', 'sadapay', 'jazzcash'].includes(method)) {
    if (!wallet || !wallet.phone || !wallet.otp) {
      return res.status(400).json({ error: 'Wallet phone and OTP required (call /api/payments/wallet/initiate first)' });
    }
    const key = `${req.user.id}:${method}:${wallet.phone}`;
    const pending = otpStore.get(key);
    if (!pending || pending.otp !== wallet.otp) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }
    otpStore.delete(key);
    base.wallet = { provider: method, phone: wallet.phone };
    base.status = 'succeeded';
    base.gateway = 'sandbox-wallet';
    base.gateway_id = method.slice(0, 3).toUpperCase() + '_' + Math.random().toString(36).slice(2, 12).toUpperCase();
  } else {
    return res.status(400).json({ error: 'Unsupported method' });
  }

  const txn = await insertPayment(base);
  const subscription = {
    plan_id: plan.id, plan_name: plan.name, price: plan.price,
    started_at: Date.now(),
    current_period_end: Date.now() + 30 * 86400000,
    payment_id: Number(txn.id),
  };
  await q(`UPDATE users SET subscription = $1::jsonb WHERE id = $2`,
    [JSON.stringify(subscription), req.user.id]);
  res.json({ ok: true, transaction: { ...txn, id: Number(txn.id), amount: Number(txn.amount) }, subscription });
}));

app.post('/api/payments/wallet/initiate', authRequired, (req, res) => {
  const { method, phone } = req.body || {};
  if (!['easypaisa', 'sadapay', 'jazzcash'].includes(method)) return res.status(400).json({ error: 'Invalid wallet' });
  if (!phone || !/^\+?\d{10,14}$/.test(String(phone).replace(/\s|-/g, ''))) {
    return res.status(400).json({ error: 'Valid phone number required' });
  }
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  otpStore.set(`${req.user.id}:${method}:${phone}`, { otp, created_at: Date.now() });
  res.json({ ok: true, otp_demo: otp, message: `OTP sent to ${phone} (demo: shown here for testing)` });
});

app.get('/api/payments/history', authRequired, wrap(async (req, res) => {
  const r = await q(
    `SELECT * FROM payments WHERE user_id = $1 ORDER BY created_at DESC`, [req.user.id]
  );
  const payments = r.rows.map(p => ({
    ...p, id: Number(p.id), user_id: Number(p.user_id),
    amount: Number(p.amount), created_at: Number(p.created_at),
  }));
  res.json({ payments });
}));

app.get('/api/subscriptions/me', authRequired, wrap(async (req, res) => {
  const u = await findUser(req.user.id);
  res.json({ subscription: (u && u.subscription) || null });
}));

app.post('/api/subscriptions/cancel', authRequired, wrap(async (req, res) => {
  const u = await findUser(req.user.id);
  if (u && u.subscription) {
    const sub = { ...u.subscription, cancelled_at: Date.now() };
    await q(`UPDATE users SET subscription = $1::jsonb WHERE id = $2`,
      [JSON.stringify(sub), req.user.id]);
  }
  res.json({ ok: true });
}));

// Error handler
app.use((err, req, res, next) => {
  console.error('API error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// SPA fallback
app.get('*', (req, res, next) => serveVersionedHtml(req, res, next, 'index.html'));

(async () => {
  try {
    await pool.query('SELECT 1');
    console.log('✅ Connected to Postgres');
  } catch (e) {
    console.error('❌ Postgres connection failed:', e.message);
    process.exit(1);
  }
  app.listen(PORT, () => {
    console.log(`🚀 Pronet server (Postgres) running at http://localhost:${PORT}`);
  });

  // Retention cleanup: drop stale call signals (>1 day) and old call logs (>30 days).
  async function cleanupCalls() {
    try {
      await q(`DELETE FROM call_signals WHERE created_at < $1`, [Date.now() - 24 * 60 * 60 * 1000]);
      await q(`DELETE FROM calls WHERE created_at < $1`, [Date.now() - 30 * 24 * 60 * 60 * 1000]);
    } catch (e) { /* table may not exist yet before migration */ }
    // Used or expired email/reset OTPs older than a day are useless — purge them.
    try {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      await q(`DELETE FROM email_otps WHERE used = 1 OR expires_at < $1`, [cutoff]);
      await q(`DELETE FROM password_reset_otps WHERE used = 1 OR expires_at < $1`, [cutoff]);
    } catch (e) { /* tables may not exist yet before migration */ }
  }
  cleanupCalls();
  setInterval(cleanupCalls, 6 * 60 * 60 * 1000); // every 6 hours
})();
