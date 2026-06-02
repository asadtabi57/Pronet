// Email sender. Supports Brevo (preferred) or Resend; falls back to console log.
const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const MAIL_FROM = process.env.MAIL_FROM || 'Pronet <onboarding@resend.dev>';

function parseFrom(str) {
  const m = str.match(/^\s*(.+?)\s*<\s*(.+?)\s*>\s*$/);
  if (m) return { name: m[1], email: m[2] };
  return { name: 'Pronet', email: str.trim() };
}

async function sendMail({ to, subject, html, text }) {
  // Brevo first (free 300/day, allows single-sender without domain)
  if (BREVO_API_KEY) {
    try {
      const sender = parseFrom(MAIL_FROM);
      const r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': BREVO_API_KEY,
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          sender,
          to: [{ email: to }],
          subject,
          htmlContent: html,
          textContent: text,
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        console.error('[mailer] Brevo failed:', r.status, body);
        return { sent: false, error: body.message || `HTTP ${r.status}` };
      }
      return { sent: true, id: body.messageId };
    } catch (e) {
      console.error('[mailer] Brevo error:', e.message);
      return { sent: false, error: e.message };
    }
  }
  // Resend fallback
  if (RESEND_API_KEY) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + RESEND_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: MAIL_FROM, to: [to], subject, html, text }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        console.error('[mailer] Resend failed:', r.status, body);
        return { sent: false, error: body.message || `HTTP ${r.status}` };
      }
      return { sent: true, id: body.id };
    } catch (e) {
      console.error('[mailer] Resend error:', e.message);
      return { sent: false, error: e.message };
    }
  }
  // Dev fallback
  console.log('\n========== EMAIL (dev mode, no mailer configured) ==========');
  console.log('To:     ', to);
  console.log('Subject:', subject);
  console.log(text || html);
  console.log('==========================================================\n');
  return { sent: false, dev: true };
}

function verifyEmailTemplate({ name, link }) {
  const safeName = (name || 'there').replace(/[<>]/g, '');
  return {
    subject: 'Verify your Pronet email',
    html: `
      <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#222">
        <h2 style="color:#0a66c2;margin:0 0 16px">Welcome to Pronet, ${safeName}!</h2>
        <p>Please confirm your email address to activate your account:</p>
        <p style="margin:24px 0">
          <a href="${link}" style="background:#0a66c2;color:#fff;padding:12px 24px;text-decoration:none;border-radius:24px;font-weight:600;display:inline-block">Verify Email</a>
        </p>
        <p style="font-size:13px;color:#666">Or copy this link: <br><a href="${link}">${link}</a></p>
        <p style="font-size:12px;color:#888;margin-top:32px">If you didn't sign up for Pronet, you can ignore this email.</p>
      </div>`,
    text: `Hi ${safeName},\n\nPlease verify your Pronet email by visiting:\n${link}\n\nIf you didn't sign up, ignore this email.`,
  };
}

module.exports = { sendMail, verifyEmailTemplate, configured: () => Boolean(BREVO_API_KEY || RESEND_API_KEY) };
