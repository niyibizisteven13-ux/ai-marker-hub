const siteUrl = 'https://www.bwenge.space';
const logoUrl = `${siteUrl}/brand/bwenge-telegram-avatar.png`;

export function escapeEmailHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character);
}

export function renderBwengeEmail(content: string): string {
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#0B1420;color:#F4F7FA;font:16px/1.6 Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#0B1420">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#132132;border:1px solid #304257;border-radius:16px;">
        <tr><td style="padding:20px 24px;border-bottom:1px solid #304257;">
          <table role="presentation" cellspacing="0" cellpadding="0"><tr>
            <td><img src="${logoUrl}" width="64" height="64" alt="" style="display:block;border-radius:12px;"></td>
            <td style="padding-left:12px;color:#F6B94A;font-size:23px;font-weight:bold;">Bwenge</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:24px;color:#F4F7FA;">${content}</td></tr>
        <tr><td style="padding:16px 24px;border-top:1px solid #304257;font-size:13px;">
          <a href="${siteUrl}" style="color:#4CE5D6;">bwenge.space</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function renderBwengeCode(code: string): string {
  return `<div style="padding:16px;background:#0B1420;border:1px solid #304257;border-radius:10px;color:#F6B94A;text-align:center;font-size:32px;font-weight:bold;letter-spacing:6px;">${escapeEmailHtml(code)}</div>`;
}
