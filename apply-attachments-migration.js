require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'schema-message-attachments.sql'), 'utf8');
    await c.query(sql);
    console.log('applied schema-message-attachments.sql');
    const r = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name='messages' AND column_name LIKE 'attachment%' ORDER BY column_name`);
    console.log('attachment columns:', r.rows.map(x => x.column_name).join(', '));
  } catch (e) {
    console.error('ERR', e.message);
    process.exit(1);
  } finally {
    await c.end();
  }
})();
