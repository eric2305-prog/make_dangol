const {
  clearOperatorSessionCookie,
  getOperatorSession,
  sendJson
} = require('../../server/operator-security');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { ok: false });
  }
  try {
    const session = await getOperatorSession(req);
    if (!session) {
      res.setHeader('Set-Cookie', clearOperatorSessionCookie());
      return sendJson(res, 401, { ok: false, message: '운영자 로그인이 필요합니다.' });
    }
    return sendJson(res, 200, {
      ok: true,
      operator_email: session.operator_email,
      expires_at: session.expires_at
    });
  } catch (_) {
    return sendJson(res, 500, { ok: false, message: '운영자 세션을 확인하지 못했습니다.' });
  }
};
