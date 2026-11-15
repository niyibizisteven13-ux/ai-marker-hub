'use strict';
/**
 * A lecturer's link opens MySEB with the code (and the student's name) filled in: myseb://join?code=123456&name=Ann.
 * It carries a 6-digit code and a name, nothing else: the server address always comes from the app's own settings.
 */
function parseJoin(u) {
  try {
    const x = new URL(String(u));
    if (x.protocol !== 'myseb:' || x.hostname !== 'join') return null;
    const code = x.searchParams.get('code') || '';
    if (!/^\d{6}$/.test(code)) return null;
    return { code, name: (x.searchParams.get('name') || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80) };
  } catch { return null; }
}
module.exports = { parseJoin };
