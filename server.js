const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { seed } = require('./seed');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://blycpujwjxlhpxcnlhtd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_0ujr8vfRd4xxwU2_5svIHg_s3voW9wg';

const dataDir = path.join(__dirname, 'data');
const dataFile = path.join(dataDir, 'db.json');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

let db;
function blankDB() {
  return {
    users: [], posts: [], likes: [], comments: [], connections: [],
    messages: [], notifications: [], shares: [], payments: [],
    seq: { users: 0, posts: 0, comments: 0, messages: 0, notifications: 0, payments: 0 },
  };
}
function loadDB() {
  if (fs.existsSync(dataFile)) {
    db = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  } else {
    db = blankDB();
    seed(db);
    saveDBNow();
    console.log(`Seeded ${db.users.length} users, ${db.posts.length} posts, ${db.comments.length} comments.`);
  }
}
let saveTimer;
function saveDB() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDBNow, 60);
}
function saveDBNow() {
  fs.writeFileSync(dataFile, JSON.stringify(db));
}
loadDB();

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '30d' });
}

// Cache verified Supabase tokens for 60s to avoid round-trip on every request
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

function ensureLocalUserFromSupabase(sbUser) {
  // Match by stored supabase_id first, fall back to email
  let user = db.users.find(u => u.supabase_id === sbUser.id)
          || db.users.find(u => u.email === sbUser.email.toLowerCase());
  const meta = sbUser.user_metadata || {};
  const displayName = meta.full_name || meta.name || (sbUser.email.split('@')[0]);
  if (!user) {
    user = {
      id: ++db.seq.users,
      supabase_id: sbUser.id,
      name: displayName,
      email: sbUser.email.toLowerCase(),
      password_hash: '',
      headline: '', about: '', location: '',
      experience: [], education: [], skills: [],
      avatar_url: meta.avatar_url || meta.picture || null,
      avatar_color: COLORS[Math.floor(Math.random() * COLORS.length)],
      cover_color: COVERS[Math.floor(Math.random() * COVERS.length)],
      created_at: Date.now(),
    };
    db.users.push(user); saveDB();
  } else if (!user.supabase_id) {
    user.supabase_id = sbUser.id;
    if (!user.avatar_url && (meta.avatar_url || meta.picture)) user.avatar_url = meta.avatar_url || meta.picture;
    saveDB();
  }
  return user;
}

async function authRequired(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  // 1) Try our own JWT (for seeded/legacy users)
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch (e) { /* fall through */ }

  // 2) Try Supabase token
  const sbUser = await verifySupabaseToken(token);
  if (!sbUser) return res.status(401).json({ error: 'Invalid token' });
  const local = ensureLocalUserFromSupabase(sbUser);
  req.user = { id: local.id, email: local.email, name: local.name };
  next();
}
const findUser = id => db.users.find(u => u.id === id);
const findUserByEmail = e => db.users.find(u => u.email === String(e).toLowerCase());

function publicUser(u, viewerId) {
  if (!u) return null;
  const base = {
    id: u.id, name: u.name, email: u.email, headline: u.headline || '',
    about: u.about || '', avatar_color: u.avatar_color,
    avatar_url: u.avatar_url || null,
    location: u.location || '',
    experience: u.experience || [], education: u.education || [], skills: u.skills || [],
    cover_color: u.cover_color || '#a0c4ff',
    subscription: u.subscription || null,
    connection_count: db.connections.filter(c =>
      c.user_a === u.id || c.user_b === u.id).length,
  };
  if (viewerId != null && viewerId !== u.id) {
    base.connected = db.connections.some(c =>
      (c.user_a === viewerId && c.user_b === u.id) ||
      (c.user_b === viewerId && c.user_a === u.id));
  }
  return base;
}

function notify(userId, type, actorId, payload) {
  if (userId === actorId) return;
  db.notifications.push({
    id: ++db.seq.notifications, user_id: userId, type, actor_id: actorId,
    payload: payload || {}, read: 0, created_at: Date.now(),
  });
  saveDB();
}

function postDTO(p, viewerId) {
  const u = findUser(p.user_id) || {};
  const orig = p.repost_of ? db.posts.find(x => x.id === p.repost_of) : null;
  const myLike = viewerId != null ? db.likes.find(l => l.post_id === p.id && l.user_id === viewerId) : null;
  const reactionCounts = {};
  for (const l of db.likes) {
    if (l.post_id !== p.id) continue;
    const t = l.type || 'like';
    reactionCounts[t] = (reactionCounts[t] || 0) + 1;
  }
  return {
    id: p.id, content: p.content, created_at: p.created_at,
    media_type: p.media_type || null, media_url: p.media_url || null,
    user_id: u.id, name: u.name, headline: u.headline,
    avatar_color: u.avatar_color, avatar_url: u.avatar_url || null,
    like_count: db.likes.filter(l => l.post_id === p.id).length,
    liked_by_me: !!myLike,
    my_reaction: myLike ? (myLike.type || 'like') : null,
    reaction_counts: reactionCounts,
    comment_count: db.comments.filter(c => c.post_id === p.id).length,
    share_count: db.posts.filter(x => x.repost_of === p.id).length + (db.shares || []).filter(s => s.post_id === p.id).length,
    repost_of: orig ? postDTO(orig, viewerId) : null,
  };
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (req, res) => {
  res.json({ supabase_url: SUPABASE_URL || null, supabase_key: SUPABASE_KEY || null });
});

// --- Auth ---
app.post('/api/auth/signup', (req, res) => {
  const { name, email, password, headline } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const em = String(email).toLowerCase();
  if (findUserByEmail(em)) return res.status(409).json({ error: 'Email already registered' });
  const colors = ['#0a66c2', '#057642', '#915907', '#b24020', '#7a3eaf', '#0073b1', '#c2410c'];
  const covers = ['#a0c4ff', '#bdb2ff', '#ffc6ff', '#caffbf', '#ffd6a5', '#9bf6ff'];
  const user = {
    id: ++db.seq.users, name, email: em,
    password_hash: bcrypt.hashSync(password, 10),
    headline: headline || '', about: '', location: '',
    experience: [], education: [], skills: [],
    avatar_color: colors[Math.floor(Math.random() * colors.length)],
    cover_color: covers[Math.floor(Math.random() * covers.length)],
    created_at: Date.now(),
  };
  db.users.push(user); saveDB();
  res.json({ token: signToken(user), user: publicUser(user, user.id) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  const user = findUserByEmail(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  res.json({ token: signToken(user), user: publicUser(user, user.id) });
});

app.get('/api/me', authRequired, (req, res) => {
  const u = findUser(req.user.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  res.json({ user: publicUser(u, u.id) });
});

app.put('/api/me', authRequired, (req, res) => {
  const u = findUser(req.user.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const fields = ['name', 'headline', 'about', 'location', 'experience', 'education', 'skills'];
  for (const f of fields) if (req.body[f] !== undefined) u[f] = req.body[f];
  saveDB();
  res.json({ user: publicUser(u, u.id) });
});

// --- Users / Profiles ---
app.get('/api/users/:id', authRequired, (req, res) => {
  const u = findUser(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'User not found' });
  const profile = publicUser(u, req.user.id);
  profile.posts = db.posts.filter(p => p.user_id === u.id)
    .sort((a, b) => b.created_at - a.created_at).slice(0, 20)
    .map(p => postDTO(p, req.user.id));
  res.json({ user: profile });
});

// --- Search ---
app.get('/api/search', authRequired, (req, res) => {
  const q = String(req.query.q || '').toLowerCase().trim();
  if (!q) return res.json({ people: [], posts: [] });
  const people = db.users
    .filter(u => u.id !== req.user.id && (
      u.name.toLowerCase().includes(q) ||
      (u.headline || '').toLowerCase().includes(q) ||
      (u.skills || []).some(s => s.toLowerCase().includes(q)) ||
      (u.location || '').toLowerCase().includes(q)))
    .slice(0, 25).map(u => publicUser(u, req.user.id));
  const posts = db.posts
    .filter(p => p.content && p.content.toLowerCase().includes(q))
    .sort((a, b) => b.created_at - a.created_at).slice(0, 20)
    .map(p => postDTO(p, req.user.id));
  res.json({ people, posts });
});

// --- Feed / Posts ---
app.get('/api/posts', authRequired, (req, res) => {
  const posts = [...db.posts].sort((a, b) => b.created_at - a.created_at).slice(0, 100)
    .map(p => postDTO(p, req.user.id));
  res.json({ posts });
});

app.post('/api/posts', authRequired, (req, res) => {
  const { content, media_type, media_url } = req.body || {};
  if ((!content || !content.trim()) && !media_url) return res.status(400).json({ error: 'Content required' });
  const post = {
    id: ++db.seq.posts, user_id: req.user.id,
    content: (content || '').trim(),
    media_type: media_type || null, media_url: media_url || null,
    created_at: Date.now(),
  };
  db.posts.push(post); saveDB();
  res.json({ post: postDTO(post, req.user.id) });
});

app.delete('/api/posts/:id', authRequired, (req, res) => {
  const id = Number(req.params.id);
  const p = db.posts.find(x => x.id === id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (p.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  db.posts = db.posts.filter(x => x.id !== id);
  db.likes = db.likes.filter(l => l.post_id !== id);
  db.comments = db.comments.filter(c => c.post_id !== id);
  saveDB();
  res.json({ ok: true });
});

const REACTION_TYPES = ['like', 'heart', 'clap', 'appreciate', 'amazed'];

function setReaction(userId, postId, type) {
  const post = db.posts.find(p => p.id === postId);
  if (!post) return { error: 'Not found' };
  const idx = db.likes.findIndex(l => l.user_id === userId && l.post_id === postId);
  if (!type) {
    if (idx >= 0) db.likes.splice(idx, 1);
    return { my_reaction: null };
  }
  if (!REACTION_TYPES.includes(type)) return { error: 'Invalid reaction' };
  if (idx >= 0) db.likes[idx].type = type;
  else {
    db.likes.push({ user_id: userId, post_id: postId, type, created_at: Date.now() });
    notify(post.user_id, 'like', userId, { post_id: postId, reaction: type });
  }
  return { my_reaction: type };
}

app.post('/api/posts/:id/react', authRequired, (req, res) => {
  const postId = Number(req.params.id);
  const { type } = req.body || {};
  const r = setReaction(req.user.id, postId, type === null ? null : type);
  if (r.error) return res.status(400).json(r);
  saveDB();
  res.json(r);
});

// Back-compat: toggle "like" reaction
app.post('/api/posts/:id/like', authRequired, (req, res) => {
  const postId = Number(req.params.id);
  const existing = db.likes.find(l => l.user_id === req.user.id && l.post_id === postId);
  const r = setReaction(req.user.id, postId, existing ? null : 'like');
  if (r.error) return res.status(400).json(r);
  saveDB();
  res.json({ liked: r.my_reaction !== null, my_reaction: r.my_reaction });
});

app.get('/api/posts/:id/comments', authRequired, (req, res) => {
  const postId = Number(req.params.id);
  const out = db.comments.filter(c => c.post_id === postId)
    .sort((a, b) => a.created_at - b.created_at)
    .map(c => {
      const u = findUser(c.user_id) || {};
      return { id: c.id, content: c.content, created_at: c.created_at,
               user_id: u.id, name: u.name, avatar_color: u.avatar_color, headline: u.headline };
    });
  res.json({ comments: out });
});

app.post('/api/posts/:id/comments', authRequired, (req, res) => {
  const postId = Number(req.params.id);
  const post = db.posts.find(p => p.id === postId);
  if (!post) return res.status(404).json({ error: 'Not found' });
  const { content } = req.body || {};
  if (!content || !content.trim()) return res.status(400).json({ error: 'Content required' });
  const c = { id: ++db.seq.comments, user_id: req.user.id, post_id: postId,
              content: content.trim(), created_at: Date.now() };
  db.comments.push(c);
  notify(post.user_id, 'comment', req.user.id, { post_id: postId, comment_id: c.id });
  saveDB();
  res.json({ id: c.id });
});

// Repost
app.post('/api/posts/:id/repost', authRequired, (req, res) => {
  const id = Number(req.params.id);
  const orig = db.posts.find(p => p.id === id);
  if (!orig) return res.status(404).json({ error: 'Not found' });
  const post = {
    id: ++db.seq.posts, user_id: req.user.id,
    content: (req.body && req.body.content) || '',
    repost_of: id, created_at: Date.now(),
  };
  db.posts.push(post);
  notify(orig.user_id, 'repost', req.user.id, { post_id: id });
  saveDB();
  res.json({ post: postDTO(post, req.user.id) });
});

// Share = lightweight, just records, no content
app.post('/api/posts/:id/share', authRequired, (req, res) => {
  const id = Number(req.params.id);
  const post = db.posts.find(p => p.id === id);
  if (!post) return res.status(404).json({ error: 'Not found' });
  if (!db.shares) db.shares = [];
  db.shares.push({ user_id: req.user.id, post_id: id, created_at: Date.now() });
  notify(post.user_id, 'share', req.user.id, { post_id: id });
  saveDB();
  res.json({ ok: true });
});

// Send a post to a user via DM
app.post('/api/posts/:id/send', authRequired, (req, res) => {
  const id = Number(req.params.id);
  const { to_user_id, note } = req.body || {};
  const post = db.posts.find(p => p.id === id);
  const recipient = findUser(Number(to_user_id));
  if (!post || !recipient) return res.status(404).json({ error: 'Not found' });
  const text = `${note ? note + '\n\n' : ''}[Shared post #${id}] ${post.content || ''}`.trim();
  const msg = { id: ++db.seq.messages, from_id: req.user.id, to_id: recipient.id,
                content: text, attached_post_id: id, created_at: Date.now(), read: 0 };
  db.messages.push(msg);
  notify(recipient.id, 'message', req.user.id, { message_id: msg.id });
  saveDB();
  res.json({ ok: true });
});

// --- People / Connections ---
app.get('/api/people', authRequired, (req, res) => {
  const out = db.users.filter(u => u.id !== req.user.id)
    .sort(() => Math.random() - 0.5).slice(0, 20)
    .map(u => publicUser(u, req.user.id));
  res.json({ people: out });
});

app.post('/api/people/:id/connect', authRequired, (req, res) => {
  const other = Number(req.params.id);
  if (other === req.user.id) return res.status(400).json({ error: 'Cannot connect with yourself' });
  if (!findUser(other)) return res.status(404).json({ error: 'User not found' });
  const exists = db.connections.some(c =>
    (c.user_a === req.user.id && c.user_b === other) ||
    (c.user_b === req.user.id && c.user_a === other));
  if (!exists) {
    db.connections.push({ user_a: req.user.id, user_b: other, created_at: Date.now() });
    notify(other, 'connect', req.user.id, {});
    saveDB();
  }
  res.json({ ok: true });
});

app.post('/api/people/:id/disconnect', authRequired, (req, res) => {
  const other = Number(req.params.id);
  db.connections = db.connections.filter(c =>
    !((c.user_a === req.user.id && c.user_b === other) ||
      (c.user_b === req.user.id && c.user_a === other)));
  saveDB();
  res.json({ ok: true });
});

app.get('/api/connections', authRequired, (req, res) => {
  const ids = new Set();
  for (const c of db.connections) {
    if (c.user_a === req.user.id) ids.add(c.user_b);
    else if (c.user_b === req.user.id) ids.add(c.user_a);
  }
  const out = [...ids].map(id => publicUser(findUser(id), req.user.id)).filter(Boolean);
  res.json({ connections: out });
});

// --- Messaging ---
app.get('/api/messages/threads', authRequired, (req, res) => {
  const mine = db.messages.filter(m => m.from_id === req.user.id || m.to_id === req.user.id);
  const byUser = new Map();
  for (const m of mine) {
    const other = m.from_id === req.user.id ? m.to_id : m.from_id;
    const cur = byUser.get(other);
    if (!cur || cur.created_at < m.created_at) byUser.set(other, m);
  }
  const threads = [...byUser.entries()].map(([uid, last]) => {
    const u = findUser(uid);
    const unread = db.messages.filter(m => m.from_id === uid && m.to_id === req.user.id && !m.read).length;
    return { user: publicUser(u, req.user.id), last_message: last, unread };
  }).sort((a, b) => b.last_message.created_at - a.last_message.created_at);
  res.json({ threads });
});

app.get('/api/messages/:userId', authRequired, (req, res) => {
  const other = Number(req.params.userId);
  const u = findUser(other);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const msgs = db.messages.filter(m =>
    (m.from_id === req.user.id && m.to_id === other) ||
    (m.from_id === other && m.to_id === req.user.id))
    .sort((a, b) => a.created_at - b.created_at);
  // mark as read
  for (const m of db.messages) {
    if (m.from_id === other && m.to_id === req.user.id && !m.read) m.read = 1;
  }
  saveDB();
  res.json({ user: publicUser(u, req.user.id), messages: msgs });
});

app.post('/api/messages/:userId', authRequired, (req, res) => {
  const other = Number(req.params.userId);
  const u = findUser(other);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const { content } = req.body || {};
  if (!content || !content.trim()) return res.status(400).json({ error: 'Content required' });
  const msg = { id: ++db.seq.messages, from_id: req.user.id, to_id: other,
                content: content.trim(), created_at: Date.now(), read: 0 };
  db.messages.push(msg);
  notify(other, 'message', req.user.id, { message_id: msg.id });
  saveDB();
  res.json({ message: msg });
});

// --- Notifications ---
app.get('/api/notifications', authRequired, (req, res) => {
  const items = db.notifications.filter(n => n.user_id === req.user.id)
    .sort((a, b) => b.created_at - a.created_at).slice(0, 100)
    .map(n => ({ ...n, actor: publicUser(findUser(n.actor_id), req.user.id) }));
  const unread = items.filter(n => !n.read).length;
  res.json({ notifications: items, unread });
});

app.post('/api/notifications/read', authRequired, (req, res) => {
  for (const n of db.notifications) if (n.user_id === req.user.id) n.read = 1;
  saveDB();
  res.json({ ok: true });
});

// --- Avatar upload (base64 data URL → file) ---
app.post('/api/me/avatar', authRequired, (req, res) => {
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
  const u = findUser(req.user.id);
  u.avatar_url = `/uploads/${filename}`;
  saveDB();
  res.json({ user: publicUser(u, u.id) });
});

app.delete('/api/me/avatar', authRequired, (req, res) => {
  const u = findUser(req.user.id);
  if (u.avatar_url) {
    try { fs.unlinkSync(path.join(__dirname, 'public', u.avatar_url.replace(/^\//, ''))); } catch (e) {}
    u.avatar_url = null;
    saveDB();
  }
  res.json({ user: publicUser(u, u.id) });
});

// --- Payments ---
const PLANS = {
  career:  { id: 'career',  name: 'Career',          price: 9.99,  currency: 'USD', features: ['See who viewed your profile', 'Direct messages to recruiters', 'Career insights'] },
  business:{ id: 'business',name: 'Business',        price: 39.99, currency: 'USD', features: ['Unlimited people search', 'Lead recommendations', 'Business insights', 'All Career features'] },
  premium: { id: 'premium', name: 'Premium Pro',     price: 59.99, currency: 'USD', features: ['Everything in Business', 'Learning courses included', 'Hiring tools', 'Priority support'] },
};

// Luhn check
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
  if (!key) return null; // sandbox mode
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

app.get('/api/payments/plans', (req, res) => res.json({ plans: Object.values(PLANS) }));

app.post('/api/payments/charge', authRequired, async (req, res) => {
  const { plan_id, method, card, wallet } = req.body || {};
  const plan = PLANS[plan_id];
  if (!plan) return res.status(400).json({ error: 'Invalid plan' });
  if (!method) return res.status(400).json({ error: 'Payment method required' });

  let txn = {
    id: ++db.seq.payments, user_id: req.user.id, plan_id: plan.id,
    amount: plan.price, currency: plan.currency, method,
    status: 'pending', created_at: Date.now(),
  };

  if (method === 'card') {
    if (!card || !card.number || !card.exp_month || !card.exp_year || !card.cvc) {
      return res.status(400).json({ error: 'Card details incomplete' });
    }
    if (!luhn(card.number)) {
      txn.status = 'declined'; txn.message = 'Invalid card number';
      db.payments.push(txn); saveDB();
      return res.status(402).json({ ok: false, error: txn.message });
    }
    txn.brand = detectBrand(card.number);
    txn.last4 = card.number.replace(/\D/g, '').slice(-4);
    const stripe = await chargeWithStripe({ amount: plan.price, currency: plan.currency, card }).catch(e => ({ ok: false, error: e.message }));
    if (stripe == null) {
      // Sandbox: certain test numbers decline
      const n = card.number.replace(/\D/g, '');
      const decline = /^4000\s?0000\s?0000\s?0002/.test(n);
      txn.status = decline ? 'declined' : 'succeeded';
      txn.gateway = 'sandbox';
      txn.gateway_id = 'sb_' + Math.random().toString(36).slice(2, 12);
      if (decline) { txn.message = 'Card declined by issuer'; db.payments.push(txn); saveDB(); return res.status(402).json({ ok: false, error: txn.message }); }
    } else if (!stripe.ok) {
      txn.status = 'declined'; txn.message = stripe.error; txn.gateway = 'stripe';
      db.payments.push(txn); saveDB();
      return res.status(402).json({ ok: false, error: stripe.error });
    } else {
      txn.status = 'succeeded'; txn.gateway = 'stripe'; txn.gateway_id = stripe.id;
    }
  } else if (['easypaisa', 'sadapay', 'jazzcash'].includes(method)) {
    if (!wallet || !wallet.phone || !wallet.otp) {
      return res.status(400).json({ error: 'Wallet phone and OTP required (call /api/payments/wallet/initiate first)' });
    }
    const pending = (db._otps || {})[`${req.user.id}:${method}:${wallet.phone}`];
    if (!pending || pending.otp !== wallet.otp) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }
    delete db._otps[`${req.user.id}:${method}:${wallet.phone}`];
    txn.wallet = { provider: method, phone: wallet.phone };
    txn.status = 'succeeded';
    txn.gateway = 'sandbox-wallet';
    txn.gateway_id = method.slice(0, 3).toUpperCase() + '_' + Math.random().toString(36).slice(2, 12).toUpperCase();
  } else {
    return res.status(400).json({ error: 'Unsupported method' });
  }

  db.payments.push(txn);
  // Activate subscription
  const u = findUser(req.user.id);
  u.subscription = {
    plan_id: plan.id, plan_name: plan.name, price: plan.price,
    started_at: Date.now(),
    current_period_end: Date.now() + 30 * 86400000,
    payment_id: txn.id,
  };
  saveDB();
  res.json({ ok: true, transaction: txn, subscription: u.subscription });
});

app.post('/api/payments/wallet/initiate', authRequired, (req, res) => {
  const { method, phone } = req.body || {};
  if (!['easypaisa', 'sadapay', 'jazzcash'].includes(method)) return res.status(400).json({ error: 'Invalid wallet' });
  if (!phone || !/^\+?\d{10,14}$/.test(String(phone).replace(/\s|-/g, ''))) {
    return res.status(400).json({ error: 'Valid phone number required' });
  }
  if (!db._otps) db._otps = {};
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  db._otps[`${req.user.id}:${method}:${phone}`] = { otp, created_at: Date.now() };
  saveDB();
  // In production this would SMS the OTP. For demo, we return it.
  res.json({ ok: true, otp_demo: otp, message: `OTP sent to ${phone} (demo: shown here for testing)` });
});

app.get('/api/payments/history', authRequired, (req, res) => {
  const items = db.payments.filter(p => p.user_id === req.user.id)
    .sort((a, b) => b.created_at - a.created_at);
  res.json({ payments: items });
});

app.get('/api/subscriptions/me', authRequired, (req, res) => {
  const u = findUser(req.user.id);
  res.json({ subscription: (u && u.subscription) || null });
});

app.post('/api/subscriptions/cancel', authRequired, (req, res) => {
  const u = findUser(req.user.id);
  if (u && u.subscription) { u.subscription.cancelled_at = Date.now(); saveDB(); }
  res.json({ ok: true });
});

// SPA fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`LinkedIn clone running at http://localhost:${PORT}`));
