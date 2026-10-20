/**
 * Vendor verification-code email.
 * Uses Resend when EMAIL_NOTIFICATIONS_ENABLED=true and RESEND_API_KEY is set.
 * The code is never written to logs.
 */
const { isEmailNotificationsEnabled, getFromAddress } = require('../../email/send-email');

async function deliverVerificationCode({ to, code }) {
  const subject = 'Your SLIOps vendor sign-in code';
  const text = `Your verification code is ${code}. It expires in 5 minutes and can be used once. If you did not request it, ignore this message.`;
  const html = `<p>Your verification code is <strong>${code}</strong>.</p><p>It expires in 5 minutes and can be used once.</p>`;

  if (!to) {
    return { skipped: true, reason: 'no_recipient' };
  }
  if (!isEmailNotificationsEnabled() || !process.env.RESEND_API_KEY) {
    console.log('[vendor-otp] email delivery skipped (provider not configured)');
    return { skipped: true, reason: 'not_configured' };
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
        to: [to],
        subject,
        html,
        text,
      }),
    });
    if (!res.ok) {
      console.error('[vendor-otp] provider rejected delivery', res.status);
      return { ok: false, reason: 'provider_error' };
    }
    const data = await res.json().catch(() => ({}));
    console.log('[vendor-otp] verification email accepted by provider');
    return { ok: true, id: data.id || null };
  } catch (err) {
    console.error('[vendor-otp] delivery failed');
    return { ok: false, reason: 'send_failed', error: err.message };
  }
}

module.exports = { deliverVerificationCode };
