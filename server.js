require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL missing in .env'); process.exit(1); }

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});
pool.on('error', (err) => console.error('PG pool error', err.message));
const q = (text, params) => pool.query(text, params);

// ---------------- Auth helpers ----------------
function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '30d' });
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
  if (r.rowCount === 0) {
    const ins = await q(
      `INSERT INTO users (supabase_id, email, password_hash, name, headline, about, location,
         experience, education, skills, avatar_color, cover_color, avatar_url, created_at)
       VALUES ($1,$2,'',$3,'','','', '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,$4,$5,$6,$7)
       RETURNING *`,
      [sbUser.id, email, displayName,
       COLORS[Math.floor(Math.random() * COLORS.length)],
       COVERS[Math.floor(Math.random() * COVERS.length)],
       meta.avatar_url || meta.picture || null,
       Date.now()]
    );
    return ins.rows[0];
  }
  const user = r.rows[0];
  if (!user.supabase_id) {
    const avatar = user.avatar_url || meta.avatar_url || meta.picture || null;
    const upd = await q(
      `UPDATE users SET supabase_id = $1, avatar_url = $2 WHERE id = $3 RETURNING *`,
      [sbUser.id, avatar, user.id]
    );
    return upd.rows[0];
  }
  return user;
}

async function authRequired(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
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
async function publicUser(u, viewerId) {
  if (!u) return null;
  const uid = Number(u.id);
  const ccRes = await q(
    `SELECT COUNT(*)::int AS c FROM connections WHERE user_a = $1 OR user_b = $1`, [uid]
  );
  const out = {
    id: uid, name: u.name, email: u.email, headline: u.headline || '',
    about: u.about || '', avatar_color: u.avatar_color,
    avatar_url: u.avatar_url || null,
    location: u.location || '',
    experience: u.experience || [], education: u.education || [], skills: u.skills || [],
    cover_color: u.cover_color || '#a0c4ff',
    subscription: u.subscription || null,
    connection_count: ccRes.rows[0].c,
  };
  if (viewerId != null && viewerId !== uid) {
    const cn = await q(
      `SELECT 1 FROM connections WHERE (user_a=$1 AND user_b=$2) OR (user_a=$2 AND user_b=$1) LIMIT 1`,
      [viewerId, uid]
    );
    out.connected = cn.rowCount > 0;
  }
  return out;
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
  await q(
    `INSERT INTO notifications (user_id, type, actor_id, payload, read, created_at)
     VALUES ($1,$2,$3,$4::jsonb,0,$5)`,
    [userId, type, actorId, JSON.stringify(payload || {}), Date.now()]
  );
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
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get('/api/config', (req, res) => {
  res.json({ supabase_url: SUPABASE_URL || null, supabase_key: SUPABASE_KEY || null });
});

// --- Auth ---
app.post('/api/auth/signup', wrap(async (req, res) => {
  const { name, email, password, headline } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const em = String(email).toLowerCase();
  const existing = await findUserByEmail(em);
  if (existing) return res.status(409).json({ error: 'Email already registered' });
  const ins = await q(
    `INSERT INTO users (email, password_hash, name, headline, about, location,
       experience, education, skills, avatar_color, cover_color, created_at)
     VALUES ($1,$2,$3,$4,'','','[]'::jsonb,'[]'::jsonb,'[]'::jsonb,$5,$6,$7)
     RETURNING *`,
    [em, bcrypt.hashSync(password, 10), name, headline || '',
     COLORS[Math.floor(Math.random() * COLORS.length)],
     COVERS[Math.floor(Math.random() * COVERS.length)],
     Date.now()]
  );
  const user = ins.rows[0];
  res.json({ token: signToken(user), user: await publicUser(user, user.id) });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  const user = await findUserByEmail(email);
  if (!user || !user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  res.json({ token: signToken(user), user: await publicUser(user, user.id) });
}));

app.get('/api/me', authRequired, wrap(async (req, res) => {
  const u = await findUser(req.user.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  res.json({ user: await publicUser(u, u.id) });
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

// --- Users / Profiles ---
app.get('/api/users/:id', authRequired, wrap(async (req, res) => {
  const u = await findUser(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'User not found' });
  const profile = await publicUser(u, req.user.id);
  profile.posts = await fetchPostDTOs({
    viewerId: req.user.id, where: 'p.user_id = $2', params: [u.id], limit: 20
  });
  res.json({ user: profile });
}));

// --- Search ---
app.get('/api/search', authRequired, wrap(async (req, res) => {
  const qstr = String(req.query.q || '').trim();
  if (!qstr) return res.json({ people: [], posts: [] });
  const like = '%' + qstr.toLowerCase() + '%';
  const peopleR = await q(
    `SELECT * FROM users
      WHERE id <> $1 AND (
        LOWER(name) LIKE $2 OR LOWER(COALESCE(headline,'')) LIKE $2
        OR LOWER(COALESCE(location,'')) LIKE $2
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(skills) AS s WHERE LOWER(s) LIKE $2)
      )
      LIMIT 25`,
    [req.user.id, like]
  );
  const people = [];
  for (const u of peopleR.rows) people.push(await publicUser(u, req.user.id));
  const posts = await fetchPostDTOs({
    viewerId: req.user.id,
    where: 'LOWER(p.content) LIKE $2',
    params: [like], limit: 20
  });
  res.json({ people, posts });
}));

// --- Feed / Posts ---
app.get('/api/posts', authRequired, wrap(async (req, res) => {
  const posts = await fetchPostDTOs({ viewerId: req.user.id, limit: 100 });
  res.json({ posts });
}));

app.post('/api/posts', authRequired, wrap(async (req, res) => {
  const { content, media_type, media_url } = req.body || {};
  if ((!content || !content.trim()) && !media_url) return res.status(400).json({ error: 'Content required' });
  const ins = await q(
    `INSERT INTO posts (user_id, content, media_type, media_url, created_at)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [req.user.id, (content || '').trim(), media_type || null, media_url || null, Date.now()]
  );
  const post = await fetchOnePostDTO(ins.rows[0].id, req.user.id);
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
    `SELECT c.id, c.content, c.created_at, c.user_id,
            u.name, u.avatar_color, u.headline
       FROM comments c JOIN users u ON u.id = c.user_id
      WHERE c.post_id = $1
      ORDER BY c.created_at ASC`,
    [postId]
  );
  res.json({ comments: r.rows.map(x => ({
    id: Number(x.id), content: x.content, created_at: Number(x.created_at),
    user_id: Number(x.user_id), name: x.name, avatar_color: x.avatar_color, headline: x.headline,
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
    [req.user.id, postId, content.trim(), Date.now()]
  );
  await notify(Number(postR.rows[0].user_id), 'comment', req.user.id,
    { post_id: postId, comment_id: Number(ins.rows[0].id) });
  res.json({ id: Number(ins.rows[0].id) });
}));

app.post('/api/posts/:id/repost', authRequired, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const origR = await q(`SELECT id, user_id FROM posts WHERE id = $1`, [id]);
  if (origR.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  const ins = await q(
    `INSERT INTO posts (user_id, content, repost_of, created_at) VALUES ($1,$2,$3,$4) RETURNING id`,
    [req.user.id, (req.body && req.body.content) || '', id, Date.now()]
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
  const text = `${note ? note + '\n\n' : ''}[Shared post #${id}] ${postR.rows[0].content || ''}`.trim();
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
  const out = [];
  for (const u of r.rows) out.push(await publicUser(u, req.user.id));
  res.json({ people: out });
}));

app.post('/api/people/:id/connect', authRequired, wrap(async (req, res) => {
  const other = Number(req.params.id);
  if (other === req.user.id) return res.status(400).json({ error: 'Cannot connect with yourself' });
  const u = await findUser(other);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const exists = await q(
    `SELECT 1 FROM connections WHERE (user_a=$1 AND user_b=$2) OR (user_a=$2 AND user_b=$1) LIMIT 1`,
    [req.user.id, other]
  );
  if (exists.rowCount === 0) {
    await q(
      `INSERT INTO connections (user_a, user_b, created_at) VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [req.user.id, other, Date.now()]
    );
    await notify(other, 'connect', req.user.id, {});
  }
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
  const r = await q(
    `SELECT u.* FROM users u
      JOIN connections c
        ON (c.user_a = $1 AND c.user_b = u.id)
        OR (c.user_b = $1 AND c.user_a = u.id)`,
    [req.user.id]
  );
  const out = [];
  for (const u of r.rows) out.push(await publicUser(u, req.user.id));
  res.json({ connections: out });
}));

// --- Messaging ---
app.get('/api/messages/threads', authRequired, wrap(async (req, res) => {
  const r = await q(
    `WITH mine AS (
       SELECT *, CASE WHEN from_id = $1 THEN to_id ELSE from_id END AS other_id
         FROM messages WHERE from_id = $1 OR to_id = $1
     ),
     latest AS (
       SELECT DISTINCT ON (other_id) other_id, id, from_id, to_id, content, created_at, read
         FROM mine
         ORDER BY other_id, created_at DESC
     )
     SELECT l.*,
            (SELECT COUNT(*)::int FROM messages m WHERE m.from_id = l.other_id AND m.to_id = $1 AND m.read = 0) AS unread
       FROM latest l
       ORDER BY l.created_at DESC`,
    [req.user.id]
  );
  const threads = [];
  for (const row of r.rows) {
    const u = await findUser(Number(row.other_id));
    threads.push({
      user: await publicUser(u, req.user.id),
      last_message: {
        id: Number(row.id), from_id: Number(row.from_id), to_id: Number(row.to_id),
        content: row.content, created_at: Number(row.created_at), read: row.read,
      },
      unread: row.unread,
    });
  }
  res.json({ threads });
}));

app.get('/api/messages/:userId', authRequired, wrap(async (req, res) => {
  const other = Number(req.params.userId);
  const u = await findUser(other);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const r = await q(
    `SELECT id, from_id, to_id, content, attached_post_id, created_at, read
       FROM messages
      WHERE (from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1)
      ORDER BY created_at ASC`,
    [req.user.id, other]
  );
  await q(`UPDATE messages SET read = 1 WHERE from_id = $1 AND to_id = $2 AND read = 0`,
    [other, req.user.id]);
  const messages = r.rows.map(m => ({
    id: Number(m.id), from_id: Number(m.from_id), to_id: Number(m.to_id),
    content: m.content, attached_post_id: m.attached_post_id ? Number(m.attached_post_id) : null,
    created_at: Number(m.created_at), read: m.read,
  }));
  res.json({ user: await publicUser(u, req.user.id), messages });
}));

app.post('/api/messages/:userId', authRequired, wrap(async (req, res) => {
  const other = Number(req.params.userId);
  const u = await findUser(other);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const { content } = req.body || {};
  if (!content || !content.trim()) return res.status(400).json({ error: 'Content required' });
  const ins = await q(
    `INSERT INTO messages (from_id, to_id, content, created_at, read)
     VALUES ($1,$2,$3,$4,0) RETURNING *`,
    [req.user.id, other, content.trim(), Date.now()]
  );
  await notify(other, 'message', req.user.id, { message_id: Number(ins.rows[0].id) });
  const m = ins.rows[0];
  res.json({ message: {
    id: Number(m.id), from_id: Number(m.from_id), to_id: Number(m.to_id),
    content: m.content, created_at: Number(m.created_at), read: m.read,
  }});
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
  const items = [];
  for (const n of r.rows) {
    const actor = n.actor_id ? await publicUser(await findUser(Number(n.actor_id)), req.user.id) : null;
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

// --- Avatar upload (base64 data URL → file) ---
app.post('/api/me/avatar', authRequired, wrap(async (req, res) => {
  const { data_url } = req.body || {};
  if (!data_url || typeof data_url !== 'string') return res.status(400).json({ error: 'data_url required' });
  const m = data_url.match(/^data:(image\/(png|jpe?g|gif|webp));base64,(.+)$/i);
  if (!m) return res.status(400).json({ error: 'Invalid image (must be png/jpg/gif/webp data URL)' });
  const ext = m[2].toLowerCase() === 'jpeg' ? 'jpg' : m[2].toLowerCase();
  const buf = Buffer.from(m[3], 'base64');
  if (buf.length > 4 * 1024 * 1024) return res.status(413).json({ error: 'Image too large (max 4 MB)' });
  const uploads = path.join(__dirname, 'public', 'uploads');
  if (!fs.existsSync(uploads)) fs.mkdirSync(uploads, { recursive: true });
  const filename = `avatar_${req.user.id}_${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(uploads, filename), buf);
  const url = `/uploads/${filename}`;
  await q(`UPDATE users SET avatar_url = $1 WHERE id = $2`, [url, req.user.id]);
  const u = await findUser(req.user.id);
  res.json({ user: await publicUser(u, u.id) });
}));

app.delete('/api/me/avatar', authRequired, wrap(async (req, res) => {
  const u = await findUser(req.user.id);
  if (u && u.avatar_url) {
    try { fs.unlinkSync(path.join(__dirname, 'public', u.avatar_url.replace(/^\//, ''))); } catch (e) {}
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
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

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
})();
