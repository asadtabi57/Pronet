# Connectik

Connectik (repo: Pronet) — human-centric professional network. Node.js + Express + Supabase Postgres.

## Local dev

```bash
npm install
cp .env.example .env    # fill in DATABASE_URL, SUPABASE_*, JWT_SECRET
node apply-schema.js    # one-time: create tables in Supabase
node migrate-data.js    # one-time (optional): seed from data/db.json
node server.js
```

Open http://localhost:3000

## Stack
- **Frontend:** Vanilla HTML/CSS/JS (`public/`)
- **Backend:** Node.js + Express (`server.js`)
- **Database:** Supabase Postgres (9 tables — see `schema.sql`)
- **Auth:** Supabase (email + Google) with legacy JWT fallback
- **Uploads:** Local disk under `public/uploads/`

## Deploy to Render
Blueprint config in `render.yaml`. After first deploy, set `DATABASE_URL` in the
Render dashboard (it's marked `sync: false` so it isn't pulled from this repo).

## Seed credentials (after running `migrate-data.js`)
- Email: any seeded user (e.g. `aarav@pronet.com`)
- Password: `password123`

