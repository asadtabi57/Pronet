// Applies the AI schema to the database.
//   1. Non-vector tables (schema-ai.sql) — always applied.
//   2. pgvector setup — attempted, but tolerated if the extension can't be
//      enabled (the app falls back to keyword matching when there's no vector
//      column). Each vector statement runs independently so one failure doesn't
//      block the rest.
//
// Run:  node apply-ai-schema.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const VECTOR_DIM = 768; // matches Gemini text-embedding-004 and the local fallback

async function tryStmt(c, label, sql) {
  try { await c.query(sql); console.log('   ✅', label); return true; }
  catch (e) { console.log('   ⚠️ ', label, '->', e.message.split('\n')[0]); return false; }
}

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    // 1) Non-vector tables
    const sql = fs.readFileSync(path.join(__dirname, 'schema-ai.sql'), 'utf8');
    await c.query(sql);
    console.log('✅ applied schema-ai.sql (feed_summaries, lead_signals, embedding_provider)');

    // 2) pgvector — best-effort
    console.log('Setting up pgvector (best-effort):');
    const ext = await tryStmt(c, 'CREATE EXTENSION vector', 'CREATE EXTENSION IF NOT EXISTS vector');
    let vectorReady = false;
    if (ext) {
      const col = await tryStmt(c, 'users.embedding column',
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS embedding vector(${VECTOR_DIM})`);
      if (col) {
        // HNSW index for fast cosine NN search. Falls back to IVFFlat, then none.
        const hnsw = await tryStmt(c, 'HNSW cosine index',
          `CREATE INDEX IF NOT EXISTS users_embedding_hnsw_idx ON users USING hnsw (embedding vector_cosine_ops)`);
        if (!hnsw) {
          await tryStmt(c, 'IVFFlat cosine index',
            `CREATE INDEX IF NOT EXISTS users_embedding_ivf_idx ON users USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)`);
        }
        vectorReady = true;
      }
    }

    // Report final capability
    const colCheck = await c.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='embedding'`);
    console.log(`\nVector search: ${colCheck.rowCount ? 'ENABLED ✅ (run backfill-embeddings.js next)' : 'DISABLED — features fall back to keyword matching'}`);

    const tbls = await c.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('feed_summaries','lead_signals') ORDER BY table_name`);
    console.log('AI tables present:', tbls.rows.map(r => r.table_name).join(', ') || '(none)');
  } catch (e) {
    console.error('❌', e.message);
    process.exit(1);
  } finally {
    await c.end();
  }
})();
