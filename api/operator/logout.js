const {
  clearOperatorSessionCookie,
  hasTrustedOrigin,
  operatorToken,
  sendJson,
  serviceRpc,
  sha256
} = require('../../server/operator-security');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { ok: false });
  }
  if (!hasTrustedOrigin(req)) return sendJson(res, 403, { ok: false });

  const token = operatorToken(req);
  try {
    if (token) {
      await serviceRpc('operator_session_logout', { p_token_hash: sha256(token) });
    }
  } catch (_) {
    // Cookie removal still completes logout if the database is temporarily unavailable.
  }
  res.setHeader('Set-Cookie', clearOperatorSessionCookie());
  return sendJson(res, 200, { ok: true });
};
