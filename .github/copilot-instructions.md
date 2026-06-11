# Copilot instructions for this repo

LinkedIn-style professional network. The package is `linkedin-clone`, the README
calls it **Pronet**, and the running UI/splash brands itself **Connectik** — all
three refer to this same app, so don't "fix" the naming.

## Stack at a glance
- **Backend:** Node.js ≥ 20 + Express, almost entirely in one file: `server.js`
  (~3200 lines, all routes + helpers). `lib/` holds the few extracted modules.
- **DB:** Supabase-hosted Postgres talked to **directly via `pg`** (raw SQL). The
  Supabase JS client is used **only** for Google OAuth login, never for data.
- **Frontend:** vanilla HTML/CSS/JS in `public/`. One `public/js/<page>.js` per
  page plus a shared `public/js/app.js`. No framework, no bundler, no build step.

## Commands
There is **no test runner, linter, or build** — don't invent one.
- Run the app: `node server.js` (also `npm start` / `npm run dev`). Serves on `PORT` (3000).
- Smoke-test the DB connection: `node test-db.js`.
- Apply base schema (one-time, **drops & recreates** core tables): `node apply-schema.js`.
- Apply incremental migrations: the `apply-*.js` runners read specific `schema-*.sql`
  files (e.g. `node apply-new-schema.js` applies the password-reset/calls/otp/
  privacy/reactions/ai/profile/push set; `node apply-ai-schema.js`, `node apply-profile-schema.js`).
- Seed demo data from `data/db.json`: `node migrate-data.js` (then log in with any
  seeded email, password `password123`).
- Backfill AI vectors after enabling Gemini: `node backfill-embeddings.js`.

`.env` is required (`DATABASE_URL` is mandatory or the server exits on boot). See
`.env.example`; other vars are read lazily and degrade gracefully when absent
(`GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `BREVO_API_KEY`/`MAIL_FROM`,
`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`, `STRIPE_SECRET_KEY`).

## Architecture (the parts that span files)
- **Auth is dual-path.** `authRequired` verifies a custom JWT first (stored in the
  `pn_token` **httpOnly cookie**, bcrypt-hashed passwords in `users.password_hash`),
  then falls back to a Supabase OAuth token, bridging it to a local `users` row via
  `ensureLocalUserFromSupabase`. It sets `req.user = { id, email, name }`.
- **IDs are BIGINT, not UUID.** They arrive as strings in JWTs/JSON, so always
  `Number(...)` before comparing (see `req.user.id = Number(...)`). Tables key off
  numeric ids; `connections` is a `(user_a, user_b, accepted)` pair, not a join table.
- **Realtime is Server-Sent Events, not Supabase Realtime.** Clients open
  `GET /api/events?token=...` (token in query since `EventSource` can't set headers).
  `sseSend` / `broadcastPresence` push messages, notifications, presence, **and
  WebRTC call signaling** over that one stream. Online presence is derived purely
  from who currently holds an SSE connection. This assumes a **single instance**.
- **AI layer (`lib/ai.js`) is provider-optional.** It calls Google Gemini's REST
  API when `GEMINI_API_KEY` is set, walking a list of candidate models and caching
  the first that works. With no key, generation throws a typed `AINotConfiguredError`
  (→ 503) and embeddings fall back to a deterministic **local** vector. Embeddings
  are tagged `'gemini' | 'local'` and only compared within the same provider; the
  Postgres column is `vector(768)` (pgvector). `/api/ai/*` routes use `aiLimiter`.
- **Uploads** go through `lib/supabase-storage.js` (Supabase Storage REST, needs
  `SUPABASE_SERVICE_ROLE_KEY`) with a fallback to local disk under `public/uploads/`.
  Chat attachments and post media use in-memory `multer`; HEIC is converted to JPEG.
- **Email** = `lib/mailer.js` (Brevo). **Web push** = `lib/push.js` (VAPID),
  initialized with `push.init(q)`.

## Conventions to follow
- **Every async route is wrapped:** `app.METHOD(path, authRequired, wrap(async (req,res)=>{...}))`.
  `wrap` funnels rejections to the central error handler — don't add ad-hoc try/catch
  just to send 500s. `q(text, params)` is the query helper; **always parameterize** (`$1,$2`).
- **Never `SELECT *` for user data sent to clients.** Build responses with
  `publicUser` / `publicUsersByIds` / `buildUserDTO` using the explicit
  `USER_DTO_FIELDS` list — this is what keeps `password_hash`, OAuth/reset tokens,
  and `supabase_id` off the wire. DTO shape must stay identical between the single
  and batch builders.
- **XSS defense is two-layered:** sanitize user text on input with `sanitizeText()`
  (stored as plain text) and re-escape on render client-side with `escapeHTML()`.
- **Side-effect notifications** go through `notify(userId, type, actorId, payload)`,
  which fans out to SSE + web push; don't insert into `notifications` directly.
- **Frontend calls the API via `api(path, { method, body })`** in `app.js`. Auth
  rides the httpOnly cookie (`credentials: 'include'`), so never attach tokens
  manually. `Session` tracks a non-sensitive auth marker (localStorage for an
  installed PWA, sessionStorage + idle timeout for a browser tab). Reuse shared
  helpers: `escapeHTML`, `avatar`, `getMe`, `renderNav`.
- **HTML is served through `serveVersionedHtml`**, which injects the PWA/splash glue
  and rewrites `*.css`/`*.js` `src`/`href` with `?v=<BUILD_ID>`. Don't hand-add cache
  busters or `<link rel=manifest>` to page HTML — it's injected. The catch-all route
  serves `index.html` for SPA-style deep links.
- **Schema is incremental.** `schema.sql` is the base; each feature adds a
  `schema-*.sql` written idempotently (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF
  NOT EXISTS`). When adding a column/table, create a new idempotent `schema-*.sql`
  and an `apply-*.js` (or extend `apply-new-schema.js`) rather than editing `schema.sql`.
- Rate limiting is per-concern (`loginLimiter`, `signupLimiter`, `otpVerifyLimiter`,
  `forgotLimiter`, `aiLimiter`); apply the matching limiter to new sensitive routes.
- `[PERF]` request timing logs to the console for `/api/*`; silence with `PERF_LOG=0`.
