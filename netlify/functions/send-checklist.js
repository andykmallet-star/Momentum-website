// Netlify Function: send-checklist
// Receives the gated-download form, emails the AI Governance Checklist PDF
// to the requester via Resend, and notifies Momentum Advisory of the new lead.
//
// Required environment variable (set in Netlify site settings → Environment variables):
//   RESEND_API_KEY   — API key from https://resend.com
//
// Optional environment variables:
//   FROM_EMAIL    — verified sending address, e.g. "Momentum Advisory <hello@momentumjersey.com>"
//                    (defaults below — must be on a domain verified in Resend)
//   NOTIFY_EMAIL  — where new-lead notifications are sent (defaults to andy@momentumjersey.com)

const fs = require('fs');
const path = require('path');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'andy@momentumjersey.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'Momentum Advisory <hello@momentumjersey.com>';
const PDF_RELATIVE_PATH = 'assets/downloads/Momentum_AI_Governance_Checklist.pdf';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  // Honeypot: bots tend to fill every field, humans never see or fill this one
  if (data.website) {
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  }

  const name = (data.name || '').toString().trim().slice(0, 200);
  const email = (data.email || '').toString().trim().slice(0, 200);
  const company = (data.company || '').toString().trim().slice(0, 200);
  const phone = (data.phone || '').toString().trim().slice(0, 50);

  if (!name || !email || !company || !phone) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'All fields are required' }) };
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Please enter a valid email address' }) };
  }

  if (!RESEND_API_KEY) {
    console.error('send-checklist: RESEND_API_KEY is not set');
    console.error('send-checklist: env keys visible to function:', Object.keys(process.env).filter(k => !k.startsWith('AWS_') && !k.startsWith('LAMBDA_')).join(', '));
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server is not configured yet' }) };
  }

  let pdfBase64;
  try {
    const pdfPath = path.join(process.cwd(), PDF_RELATIVE_PATH);
    pdfBase64 = fs.readFileSync(pdfPath).toString('base64');
  } catch (e) {
    console.error('send-checklist: could not read PDF at', PDF_RELATIVE_PATH, e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server is not configured yet' }) };
  }

  const firstName = name.split(' ')[0] || name;

  try {
    const userSend = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: email,
        subject: 'Your Momentum Advisory AI Governance Checklist',
        html: `<p>Hi ${escapeHtml(firstName)},</p>
<p>Thanks for your interest in Momentum Advisory. Please find attached our AI Governance &amp; Risk Management Assessment Checklist &mdash; a JFSC-aligned framework covering governance, risk management, data protection, and regulatory compliance for business AI deployments.</p>
<p>If it would help to talk through how this applies to your business, just reply to this email or <a href="https://www.momentumjersey.com/contact">get in touch</a>.</p>
<p>Best regards,<br>Andy Mallet<br>Momentum Advisory</p>`,
        attachments: [
          {
            filename: 'Momentum_AI_Governance_Checklist.pdf',
            content: pdfBase64
          }
        ]
      })
    });

    if (!userSend.ok) {
      const errText = await userSend.text();
      console.error('send-checklist: Resend error sending to requester:', errText);
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Could not send the email — please try again shortly' }) };
    }

    // Best-effort lead notification — do not fail the request if this errors
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: NOTIFY_EMAIL,
          reply_to: email,
          subject: `New checklist download — ${name} (${company})`,
          html: `<p>New AI Governance Checklist download:</p>
<ul>
  <li><strong>Name:</strong> ${escapeHtml(name)}</li>
  <li><strong>Email:</strong> ${escapeHtml(email)}</li>
  <li><strong>Company:</strong> ${escapeHtml(company)}</li>
  <li><strong>Phone:</strong> ${escapeHtml(phone)}</li>
</ul>`
        })
      });
    } catch (notifyErr) {
      console.error('send-checklist: failed to send lead notification:', notifyErr);
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (e) {
    console.error('send-checklist: unexpected error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Unexpected server error — please try again shortly' }) };
  }
};
