const {
  clearOperatorSessionCookie,
  getOperatorSession,
  sendJson,
  serviceRpc
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
    const result = await serviceRpc('operator_list_stores', {
      p_token_hash: session.tokenHash
    });
    if (!result || result.ok !== true) {
      return sendJson(res, 401, { ok: false, message: '운영자 로그인이 필요합니다.' });
    }
    return sendJson(res, 200, { ok: true, stores: result.stores || [] });
  } catch (_) {
    return sendJson(res, 500, { ok: false, message: '매장 목록을 불러오지 못했습니다.' });
  }
};
