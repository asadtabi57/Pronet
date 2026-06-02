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

async function uploadAvatar(filename, buffer, contentType) {
  if (!enabled()) throw new Error('Supabase Storage not configured');
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${filename}`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + SERVICE_KEY,
      apikey: SERVICE_KEY,
      'Content-Type': contentType,
      'x-upsert': 'true',
      'cache-control': '3600',
    },
    body: buffer,
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Upload failed (${r.status}): ${text}`);
  }
  return publicUrl(filename);
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

module.exports = { enabled, uploadAvatar, deleteAvatar, publicUrl, isSupabaseUrl, BUCKET };
