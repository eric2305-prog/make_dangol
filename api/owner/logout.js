const {
  COOKIE_NAME,
  clearSessionCookie,
  parseCookies,
  sendJson,
  serviceRpc,
  sha256
} = require('../../server/owner-security');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { ok: false, message: '허용되지 않은 요청입니다.' });
  }

  const token = parseCookies(req)[COOKIE_NAME];
  try {
    if (token && /^[0-9a-f]{64}$/.test(token)) {
      await serviceRpc('owner_session_logout', { p_token_hash: sha256(token) });
    }
  } catch (_) {
    // The local cookie is cleared even when server-side revocation is unavailable.
  }

  res.setHeader('Set-Cookie', clearSessionCookie());
  return sendJson(res, 200, { ok: true });
};
