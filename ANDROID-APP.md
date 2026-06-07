# Pronet — Android app (PWA + TWA)

Pronet is now an installable **Progressive Web App**. Users can "Add to Home
Screen" from Chrome and get a standalone, app-like experience (bottom tab bar,
app header, offline shell, app icon). To put it on the **Google Play Store**, we
wrap the PWA in a **Trusted Web Activity (TWA)** using Bubblewrap.

## What's already done (in this repo)
- `public/manifest.webmanifest` — app manifest (name, icons, theme, shortcuts)
- `public/sw.js` — service worker (offline shell + smart caching)
- `public/icons/*` — maskable + any-purpose icons (192/512), apple-touch, favicon
- `public/js/pwa.js` — SW registration, install prompt, update flow
- `public/js/mobile.js` + mobile CSS — the native-style mobile app shell
- `public/offline.html` — offline fallback
- `public/.well-known/assetlinks.json` — Digital Asset Links (needs your cert hash)
- Server routes for `/sw.js`, `/manifest.webmanifest`, `/.well-known/assetlinks.json`

## Install as a PWA (no store, free, works now)
On Android Chrome: open the live site → menu (⋮) → **Install app** / **Add to
Home screen**. It launches fullscreen with the Pronet icon.

## Publish to Google Play (TWA via Bubblewrap)
Prereqs: Node 18+, JDK 17, and Android SDK (Bubblewrap can install these).

```bash
# 1. Install Bubblewrap
npm i -g @bubblewrap/cli

# 2. Initialize from the live manifest
bubblewrap init --manifest https://pronet-production.up.railway.app/manifest.webmanifest
#   - Package name: app.pronet.twa  (must match assetlinks.json)
#   - Host:        pronet-production.up.railway.app
#   - It will generate a signing key — SAVE IT SAFELY (you need it for every update)

# 3. Build the APK/AAB
bubblewrap build
#   -> produces app-release-signed.apk (sideload) and app-release-bundle.aab (Play)
```

### Link the app to the site (removes the browser URL bar)
1. Get your app's **SHA-256 signing fingerprint**:
   ```bash
   bubblewrap fingerprint
   ```
   (or from Play Console → Setup → App signing, after upload)
2. Paste it into `public/.well-known/assetlinks.json`, replacing
   `REPLACE_WITH_YOUR_APP_SIGNING_SHA256_FINGERPRINT`.
3. Commit + deploy so it's live at
   `https://pronet-production.up.railway.app/.well-known/assetlinks.json`.
4. Verify: https://developers.google.com/digital-asset-links/tools/generator

### Upload to Play
- Google Play Console → Create app → upload `app-release-bundle.aab`.
- Fill store listing (icon, screenshots, description), content rating, privacy
  policy URL, and data-safety form.
- One-time **$25** developer registration fee.
- Note: brand-new **personal** developer accounts must run a 14-day closed test
  with ~12 testers before production release (company accounts are exempt).

## Updating the app later
- **PWA content** updates automatically on deploy (service worker).
- **TWA shell** only needs rebuilding/re-uploading if you change the package,
  icons, or Bubblewrap config — normal feature changes ship via the web with no
  Play resubmission.
