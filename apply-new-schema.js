require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

(async () => {
  const files = ['schema-password-reset.sql', 'schema-calls.sql', 'schema-email-otp.sql'];
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    for (const f of files) {
      const sql = fs.readFileSync(path.join(__dirname, f), 'utf8');
      await c.query(sql);
      console.log('✅ applied', f);
    }
    const r = await c.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('password_reset_otps','calls','call_signals','email_otps') ORDER BY table_name`);
    console.log('   New tables present:', r.rows.map(x => x.table_name).join(', '));
  } catch (e) {
    console.error('❌', e.message);
    process.exit(1);
  } finally {
    await c.end();
  }
})();
