// Thin wrapper around Supabase Storage REST API for avatar files.
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BUCKET = process.env.SUPABASE_AVATAR_BUCKET || 'avatars';

function enabled() {
  return Boolean(SUPABASE_URL && SERVICE_KEY);
}

function publicUrl(filename) {
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${filename}`;
}

// `cacheControl` is the directive Supabase stores for the object. Supabase
// prepends "public, ", so we pass the max-age (+ immutable) part here to get a
// valid header like `public, max-age=31536000, immutable`.
async function uploadObject(filename, buffer, contentType, cacheControl) {
  if (!enabled()) throw new Error('Supabase Storage not configured');
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${filename}`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + SERVICE_KEY,
      apikey: SERVICE_KEY,
      'Content-Type': contentType,
      'x-upsert': 'true',
      'cache-control': cacheControl || 'max-age=3600',
    },
    body: buffer,
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Upload failed (${r.status}): ${text}`);
  }
  return publicUrl(filename);
}

// Avatars reuse the same key (upsert on change), so they keep a short cache.
async function uploadAvatar(filename, buffer, contentType) {
  return uploadObject(filename, buffer, contentType, 'max-age=3600');
}

// Generic uploader for any file (chat attachments). `key` may include a path
// prefix (e.g. "chat/12_8_1700000000.png") and is stored in the same public
// bucket as avatars, so the returned URL is directly viewable/downloadable.
// Chat keys are unique + immutable, so cache them for a year — repeat views
// (and any CDN edge in front) then serve instantly instead of re-downloading.
async function uploadFile(filename, buffer, contentType) {
  return uploadObject(filename, buffer, contentType, 'max-age=31536000, immutable');
}

async function deleteAvatar(filenameOrUrl) {
  if (!enabled()) return false;
  let name = filenameOrUrl;
  const marker = `/public/${BUCKET}/`;
  if (name.includes(marker)) name = name.split(marker)[1];
  else if (name.includes(`/${BUCKET}/`)) name = name.split(`/${BUCKET}/`)[1];
  if (!name) return false;
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${name}`, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + SERVICE_KEY, apikey: SERVICE_KEY },
  });
  return r.ok;
}

function isSupabaseUrl(url) {
  return typeof url === 'string' && SUPABASE_URL && url.startsWith(SUPABASE_URL);
}

module.exports = { enabled, uploadAvatar, uploadFile, deleteAvatar, publicUrl, isSupabaseUrl, BUCKET };
