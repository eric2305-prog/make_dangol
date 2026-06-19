const {
  COOKIE_NAME,
  clearSessionCookie,
  parseCookies,
  sendJson,
  serviceRpc,
  sha256
} = require('../../server/owner-security');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { ok: false, message: '허용되지 않은 요청입니다.' });
  }

  const token = parseCookies(req)[COOKIE_NAME];
  if (!token || !/^[0-9a-f]{64}$/.test(token)) {
    res.setHeader('Set-Cookie', clearSessionCookie());
    return sendJson(res, 401, { ok: false, message: '로그인이 필요합니다.' });
  }

  try {
    const result = await serviceRpc('owner_session_dashboard', {
      p_token_hash: sha256(token)
    });

    if (!result || result.ok !== true || !result.snapshot) {
      res.setHeader('Set-Cookie', clearSessionCookie());
      return sendJson(res, 401, { ok: false, message: '로그인 시간이 만료됐습니다.' });
    }

    const store = result.snapshot.store || {};
    const storeId = store.store_id || store.store_code;
    if (!storeId || !/^[a-z0-9]+$/.test(storeId)) {
      return sendJson(res, 500, { ok: false, message: '매장 정보를 확인할 수 없습니다.' });
    }

    return sendJson(res, 200, {
      ok: true,
      snapshot: result.snapshot,
      expires_at: result.expires_at,
      registration_url: `https://www.revaro.me/register?store_id=${encodeURIComponent(storeId)}`
    });
  } catch (_) {
    return sendJson(res, 500, { ok: false, message: '고객 데이터를 불러오지 못했습니다.' });
  }
};
