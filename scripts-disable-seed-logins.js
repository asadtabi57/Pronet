require('dotenv').config();
const { Pool } = require('pg');
(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  // Block legacy seeded users from logging in via /api/auth/login:
  // they had bcrypt-hashed "password123" — clear those so only newly-signed-up
  // (real) users or Supabase-authenticated users can log in.
  const r = await pool.query(
    `UPDATE users SET password_hash = '' WHERE supabase_id IS NULL AND password_hash <> '' RETURNING id, email`
  );
  console.log(`Blocked legacy login for ${r.rowCount} seeded user(s):`);
  for (const u of r.rows) console.log(`  - ${u.email}`);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
