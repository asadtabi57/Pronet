require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'db.json'), 'utf8'));

  console.log('Wiping existing rows…');
  await c.query('TRUNCATE payments, shares, notifications, messages, connections, comments, likes, posts, users RESTART IDENTITY CASCADE');

  // USERS
  for (const u of db.users) {
    await c.query(
      `INSERT INTO users (id, supabase_id, email, password_hash, name, headline, about, location,
         experience, education, skills, avatar_color, cover_color, avatar_url, subscription, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14,$15::jsonb,$16)`,
      [
        u.id, u.supabase_id || null, u.email, u.password_hash || null, u.name,
        u.headline || null, u.about || null, u.location || null,
        JSON.stringify(u.experience || []), JSON.stringify(u.education || []), JSON.stringify(u.skills || []),
        u.avatar_color || null, u.cover_color || null, u.avatar_url || null,
        u.subscription ? JSON.stringify(u.subscription) : null,
        u.created_at,
      ]
    );
  }
  console.log(`✓ users: ${db.users.length}`);

  // POSTS
  for (const p of db.posts) {
    await c.query(
      `INSERT INTO posts (id, user_id, content, media_type, media_url, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [p.id, p.user_id, p.content, p.media_type || null, p.media_url || null, p.created_at]
    );
  }
  console.log(`✓ posts: ${db.posts.length}`);

  // LIKES (dedupe on (user_id,post_id) to satisfy PK)
  let likeCount = 0;
  const seenLike = new Set();
  for (const l of db.likes) {
    const k = `${l.user_id}:${l.post_id}`;
    if (seenLike.has(k)) continue;
    seenLike.add(k);
    await c.query(
      `INSERT INTO likes (user_id, post_id, type, created_at) VALUES ($1,$2,$3,$4)`,
      [l.user_id, l.post_id, l.type || 'like', l.created_at]
    );
    likeCount++;
  }
  console.log(`✓ likes: ${likeCount}`);

  // COMMENTS
  for (const cm of db.comments) {
    await c.query(
      `INSERT INTO comments (id, user_id, post_id, content, created_at) VALUES ($1,$2,$3,$4,$5)`,
      [cm.id, cm.user_id, cm.post_id, cm.content, cm.created_at]
    );
  }
  console.log(`✓ comments: ${db.comments.length}`);

  // CONNECTIONS (dedupe)
  let connCount = 0;
  const seenConn = new Set();
  for (const cn of db.connections) {
    const k = `${cn.user_a}:${cn.user_b}`;
    if (seenConn.has(k)) continue;
    seenConn.add(k);
    await c.query(
      `INSERT INTO connections (user_a, user_b, created_at) VALUES ($1,$2,$3)`,
      [cn.user_a, cn.user_b, cn.created_at]
    );
    connCount++;
  }
  console.log(`✓ connections: ${connCount}`);

  // MESSAGES
  for (const m of db.messages) {
    await c.query(
      `INSERT INTO messages (id, from_id, to_id, content, created_at, read)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [m.id, m.from_id, m.to_id, m.content, m.created_at, m.read ? 1 : 0]
    );
  }
  console.log(`✓ messages: ${db.messages.length}`);

  // NOTIFICATIONS
  for (const n of db.notifications) {
    await c.query(
      `INSERT INTO notifications (id, user_id, type, actor_id, payload, read, created_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
      [n.id, n.user_id, n.type, n.actor_id || null,
       n.payload ? JSON.stringify(n.payload) : null,
       n.read ? 1 : 0, n.created_at]
    );
  }
  console.log(`✓ notifications: ${db.notifications.length}`);

  // SHARES (id may be missing in old JSON — let serial assign)
  let shareIdx = 0;
  for (const s of db.shares) {
    if (s.id) {
      await c.query(
        `INSERT INTO shares (id, user_id, post_id, created_at) VALUES ($1,$2,$3,$4)`,
        [s.id, s.user_id, s.post_id, s.created_at]
      );
    } else {
      await c.query(
        `INSERT INTO shares (user_id, post_id, created_at) VALUES ($1,$2,$3)`,
        [s.user_id, s.post_id, s.created_at]
      );
    }
    shareIdx++;
  }
  console.log(`✓ shares: ${shareIdx}`);

  // PAYMENTS
  for (const pay of db.payments) {
    await c.query(
      `INSERT INTO payments (id, user_id, plan_id, amount, currency, method, status, brand, last4, gateway, gateway_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [pay.id, pay.user_id, pay.plan_id, pay.amount, pay.currency || 'USD',
       pay.method || null, pay.status, pay.brand || null, pay.last4 || null,
       pay.gateway || null, pay.gateway_id || null, pay.created_at]
    );
  }
  console.log(`✓ payments: ${db.payments.length}`);

  // Fix sequence values so new INSERTs don't collide
  const seqs = [
    ['users', 'id'], ['posts', 'id'], ['comments', 'id'],
    ['messages', 'id'], ['notifications', 'id'], ['shares', 'id'], ['payments', 'id'],
  ];
  for (const [t, col] of seqs) {
    await c.query(`SELECT setval(pg_get_serial_sequence('${t}', '${col}'), COALESCE((SELECT MAX(${col}) FROM ${t}), 1))`);
  }
  console.log('✓ sequences synced');

  await c.end();
  console.log('🎉 Migration complete.');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
