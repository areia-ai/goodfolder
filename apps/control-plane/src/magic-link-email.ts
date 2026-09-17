/** Transactional email: inline styles and tables also work without a stylesheet.
 * Images are decorative; sign-in never depends on loading remote brand assets.
 */
export function magicLinkEmail(link: string, ttlMinutes: number) {
  const href = escapeHtml(link);
  return {
    subject: "Sign in to GoodFolder",
    text: `Your folders are calling.\n\nSign in to GoodFolder:\n${link}\n\nThis link works once and expires in ${ttlMinutes} minutes.\n\nDidn't ask for this? You can safely ignore this email.\n`,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>Sign in to GoodFolder</title>
<style>
  @media only screen and (max-width: 480px) {
    .outer { padding: 24px 12px !important; }
    .content { padding: 28px 24px !important; }
    .headline { font-size: 34px !important; line-height: 38px !important; }
  }
  @media (prefers-color-scheme: dark) {
    .canvas { background-color: #111827 !important; }
    .card, .content { background-color: #1f2937 !important; }
    .headline, .brand { color: #ffffff !important; }
    .copy, .footer { color: #d1d5db !important; }
    .muted { color: #b8c4d6 !important; }
    .eyebrow, .fallback { color: #93bbff !important; }
    .rule { border-color: #475569 !important; }
  }
</style>
</head>
<body class="canvas" style="margin:0;padding:0;background-color:#edf2fa;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
<div style="display:none;font-size:1px;color:#edf2fa;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">Your sign-in link is ready. Open your folders in one click.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="canvas" style="background-color:#edf2fa;">
<tr><td align="center" class="outer" style="padding:40px 20px;">
<!--[if mso]><table role="presentation" width="560" align="center"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
<tr><td class="brand" style="padding:0 0 20px 4px;color:#111827;font-size:23px;font-weight:800;letter-spacing:-1px;">GoodFolder<span style="color:#3b82f6;">.</span></td></tr>
<tr><td class="card" style="background-color:#ffffff;border:2px solid #111827;border-radius:20px;overflow:hidden;box-shadow:6px 6px 0 #111827;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center" bgcolor="#3b82f6" style="padding:24px 24px 20px;background-color:#3b82f6;border-radius:17px 17px 0 0;border-bottom:2px solid #111827;">
<img src="https://trygoodfolder.com/brand/mascot/mascot-wave.png" width="156" height="160" alt="" style="display:block;width:156px;height:160px;border:0;">
</td></tr>
<tr><td class="content" style="padding:34px 40px 32px;background-color:#ffffff;border-radius:0 0 17px 17px;">
<p class="eyebrow" style="margin:0 0 12px;color:#2563eb;font-size:11px;line-height:16px;font-weight:700;letter-spacing:2px;">ONE CLICK. YOU'RE IN.</p>
<h1 class="headline" style="margin:0 0 16px;color:#111827;font-size:42px;line-height:45px;font-weight:800;letter-spacing:-1.8px;">Your folders<br>are calling.</h1>
<p class="copy" style="margin:0 0 26px;color:#475569;font-size:16px;line-height:25px;">Sign in to GoodFolder and pick up where you left off.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="#3b82f6" style="background-color:#3b82f6;border:2px solid #111827;border-radius:10px;box-shadow:3px 3px 0 #111827;mso-padding-alt:17px 26px;">
<a href="${href}" style="display:inline-block;padding:17px 26px;color:#000000;font-size:16px;line-height:20px;font-weight:700;text-decoration:none;border-radius:8px;">Sign in to GoodFolder&nbsp; &#8594;</a>
</td></tr></table>
<p class="muted" style="margin:18px 0 28px;color:#64748b;font-size:12px;line-height:19px;">Just for you. Works once. Expires in ${ttlMinutes} minutes.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="rule" style="border-top:1px solid #e2e8f0;padding-top:22px;">
<p class="muted" style="margin:0 0 8px;color:#64748b;font-size:12px;line-height:19px;">Button not working? Copy this link into your browser:</p>
<p style="margin:0;font-size:11px;line-height:18px;word-break:break-all;overflow-wrap:anywhere;"><a class="fallback" href="${href}" style="color:#2563eb;text-decoration:underline;word-break:break-all;">${href}</a></p>
</td></tr></table>
</td></tr></table>
</td></tr>
<tr><td align="center" class="footer" style="padding:26px 12px 0;color:#64748b;font-size:12px;line-height:20px;">Didn't ask for this? You can safely ignore this email.<br><span style="font-weight:700;">GoodFolder</span> &middot; A little history. A way back.</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body>
</html>`,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}
