// Backfills the `embedding` vector for every user using the CURRENT provider
// (Gemini if GEMINI_API_KEY is set, otherwise the local lexical fallback).
//
// Run this:
//   * once after enabling pgvector, and
//   * again any time you ADD or CHANGE the Gemini key (so all rows live in the
//     same embedding space — mixing 'local' and 'gemini' vectors is incoherent).
//
//   node backfill-embeddings.js
require('dotenv').config();
const { Client } = require('pg');
const ai = require('./lib/ai');

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    // Bail clearly if the vector column doesn't exist yet.
    const colCheck = await c.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='embedding'`);
    if (!colCheck.rowCount) {
      console.error('❌ users.embedding column missing. Run `node apply-ai-schema.js` first.');
      process.exit(1);
    }

    const provider = ai.embeddingProvider();
    console.log(`Embedding provider: ${provider.toUpperCase()}${provider === 'local' ? ' (no GEMINI_API_KEY — lexical fallback)' : ''}`);

    const { rows } = await c.query(
      `SELECT id, name, headline, about, location, skills, experience FROM users ORDER BY id`);
    console.log(`Backfilling ${rows.length} users…`);

    let done = 0, failed = 0;
    for (const u of rows) {
      try {
        const text = ai.profileEmbedText(u);
        const { vector, provider: usedProvider } = await ai.generateEmbedding(text);
        await c.query(
          `UPDATE users SET embedding = $1::vector, embedding_provider = $2, embedding_updated_at = $3 WHERE id = $4`,
          [ai.toVectorLiteral(vector), usedProvider, Date.now(), u.id]
        );
        done++;
        if (done % 10 === 0) console.log(`  …${done}/${rows.length}`);
        // Gentle pacing to stay well within Gemini's free-tier RPM when used.
        if (provider === 'gemini') await sleep(120);
      } catch (e) {
        failed++;
        console.log(`  ⚠️  user ${u.id} failed: ${e.message.split('\n')[0]}`);
      }
    }
    console.log(`\n✅ Done. ${done} embedded, ${failed} failed (provider=${provider}).`);
  } catch (e) {
    console.error('❌', e.message);
    process.exit(1);
  } finally {
    await c.end();
  }
})();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
