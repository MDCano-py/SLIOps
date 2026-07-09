/**
 * Safe email adapter for hub assignment notifications.
 * Uses Resend when RESEND_API_KEY is set and EMAIL_NOTIFICATIONS_ENABLED=true.
 * Otherwise logs to console (never throws).
 */

function isEmailNotificationsEnabled() {
  return String(process.env.EMAIL_NOTIFICATIONS_ENABLED || '').toLowerCase() === 'true';
}

function getFromAddress() {
  return (
    process.env.EMAIL_FROM ||
    process.env.VENDOR_NOTIFY_FROM ||
    'Streamline Operations Hub <onboarding@resend.dev>'
  );
}

/**
 * @returns {Promise<{ ok?: boolean, skipped?: boolean, reason?: string, id?: string, error?: string, logged?: boolean }>}
 */
async function sendEmail({ to, subject, html, text }) {
  if (!to) {
    console.log('[email] Skipped (no recipient):', subject);
    return { skipped: true, reason: 'no_recipient' };
  }

  if (!isEmailNotificationsEnabled()) {
    console.log('[assignment-email]', subject, '→', to);
    if (text) console.log('[assignment-email] body:', text.slice(0, 500));
    return { skipped: true, reason: 'disabled', logged: true };
  }

  if (!process.env.RESEND_API_KEY) {
    console.log('[assignment-email] EMAIL_NOTIFICATIONS_ENABLED but RESEND_API_KEY unset — logging only:', subject, '→', to);
    if (text) console.log('[assignment-email] body:', text.slice(0, 500));
    return { skipped: true, reason: 'no_provider', logged: true };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: getFromAddress(),
        to: Array.isArray(to) ? to : [to],
        subject,
        html: html || undefined,
        text: text || undefined,
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      console.error('[assignment-email] Resend error:', res.status, err);
      return { ok: false, error: err || `HTTP ${res.status}` };
    }
    const data = await res.json();
    console.log('[assignment-email] Sent:', subject, '→', to, `(id: ${data.id})`);
    return { ok: true, id: data.id };
  } catch (err) {
    console.error('[assignment-email] Send failed:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  isEmailNotificationsEnabled,
  getFromAddress,
  sendEmail,
};
