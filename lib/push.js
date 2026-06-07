// lib/push.js — Web Push (VAPID) helper. No-ops cleanly when VAPID keys aren't
// configured, so the app runs fine without them. Stores subscriptions in
// Postgres (push_subscriptions) and prunes dead endpoints on 404/410.
'use strict';

const webpush = require('web-push');

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@pronet.app';

let configured = false;
if (PUBLIC_KEY && PRIVATE_KEY) {
  try { webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY); configured = true; }
  catch (e) { console.error('VAPID config failed:', e.message); }
}

function enabled() { return configured; }
function publicKey() { return PUBLIC_KEY; }

// `q` is injected from server.js so we share the one pg pool.
let q = null;
function init(queryFn) { q = queryFn; }

async function saveSubscription(userId, sub, userAgent) {
  if (!q || !sub || !sub.endpoint || !sub.keys) return;
  await q(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, created_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, (userAgent || '').slice(0, 300), Date.now()]
  );
}

async function removeSubscription(endpoint) {
  if (!q || !endpoint) return;
  await q(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
}

// Send a notification payload to every device a user has subscribed.
// payload: { title, body, url, tag, icon, requireInteraction }
async function sendToUser(userId, payload) {
  if (!configured || !q) return;
  let rows;
  try { rows = (await q(`SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`, [userId])).rows; }
  catch (e) { return; }
  if (!rows.length) return;
  const body = JSON.stringify({
    title: payload.title || 'Pronet',
    body: payload.body || '',
    url: payload.url || '/notifications.html',
    tag: payload.tag || 'pronet',
    icon: payload.icon || '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    requireInteraction: !!payload.requireInteraction,
    type: payload.type || 'generic',
    callId: payload.callId || null,
  });
  await Promise.all(rows.map(async (r) => {
    const sub = { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } };
    try {
      await webpush.sendNotification(sub, body, { TTL: 60 });
    } catch (err) {
      // 404/410 = subscription expired/gone → prune it.
      if (err && (err.statusCode === 404 || err.statusCode === 410)) {
        removeSubscription(r.endpoint).catch(() => {});
      }
    }
  }));
}

module.exports = { init, enabled, publicKey, saveSubscription, removeSubscription, sendToUser };
