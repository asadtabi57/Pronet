require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await c.connect();
    const r = await c.query('SELECT NOW() AS now, current_database() AS db, version() AS ver');
    console.log('✅ Connected:', r.rows[0].db, '@', r.rows[0].now);
    console.log('   ', r.rows[0].ver.split(',')[0]);
    await c.end();
  } catch (e) {
    console.error('❌ FAIL:', e.message);
    process.exit(1);
  }
})();
