// Applies the rich-profile schema (schema-profile.sql). Idempotent.
//   node apply-profile-schema.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'schema-profile.sql'), 'utf8');
    await c.query(sql);
    console.log('✅ applied schema-profile.sql');
    const r = await c.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema='public'
          AND table_name IN ('profile_views','endorsements','projects','certifications')
        ORDER BY table_name`);
    console.log('   Tables present:', r.rows.map(x => x.table_name).join(', '));
    const cols = await c.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name='users' AND column_name IN ('cover_url','open_to_work','languages','interests','featured_post_ids')
        ORDER BY column_name`);
    console.log('   New user columns:', cols.rows.map(x => x.column_name).join(', '));
  } catch (e) {
    console.error('❌', e.message);
    process.exit(1);
  } finally {
    await c.end();
  }
})();
