// One-time: upload existing public/uploads/*.{jpg,png,...} to Supabase Storage,
// then rewrite users.avatar_url to the new public URL.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const storage = require('./lib/supabase-storage');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

(async () => {
  if (!storage.enabled()) { console.error('Supabase Storage not configured'); process.exit(1); }

  const dir = path.join(__dirname, 'public', 'uploads');
  if (!fs.existsSync(dir)) { console.log('No public/uploads dir, nothing to do.'); process.exit(0); }

  const { rows } = await pool.query(`SELECT id, avatar_url FROM users WHERE avatar_url LIKE '/uploads/%'`);
  console.log(`Found ${rows.length} user(s) with local avatars.`);

  for (const r of rows) {
    const filename = r.avatar_url.replace(/^\/uploads\//, '');
    const full = path.join(dir, filename);
    if (!fs.existsSync(full)) {
      console.log(`  user ${r.id}: file missing (${filename}), clearing avatar_url`);
      await pool.query(`UPDATE users SET avatar_url = NULL WHERE id = $1`, [r.id]);
      continue;
    }
    const ext = (filename.split('.').pop() || 'jpg').toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    const buf = fs.readFileSync(full);
    try {
      const url = await storage.uploadAvatar(filename, buf, mime);
      await pool.query(`UPDATE users SET avatar_url = $1 WHERE id = $2`, [url, r.id]);
      console.log(`  user ${r.id}: uploaded -> ${url}`);
    } catch (e) {
      console.error(`  user ${r.id}: FAILED -`, e.message);
    }
  }

  await pool.end();
  console.log('Done.');
})();
