# ProNet — LinkedIn Clone

Full-stack LinkedIn-style social network with Supabase auth, reactions, posts, messaging, payments, and more.

## Local dev

```bash
npm install
node server.js
```

Visit http://localhost:3000

## Deploy to Render

This repo includes `render.yaml`. After pushing to GitHub:

1. Go to https://dashboard.render.com → New → Blueprint
2. Connect this repo → Render reads `render.yaml` and provisions the service
3. Wait for first deploy (~3 min)
4. In Supabase dashboard → Authentication → URL Configuration, set Site URL + Redirect URLs to your Render URL

## Stack

- Backend: Node.js + Express, JSON file store
- Auth: Supabase (email + Google OAuth) with legacy JWT fallback
- Frontend: Vanilla HTML/CSS/JS
- Payments: Stripe-ready (sandbox by default)
