const {
  SESSION_SECONDS,
  getClientIp,
  randomToken,
  readJson,
  secureHash,
  sendJson,
  serviceRpc,
  sessionCookie,
  sha256
} = require('../../server/owner-security');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { ok: false, message: '허용되지 않은 요청입니다.' });
  }

  try {
    const body = await readJson(req);
    const storeId = String(body.store_id || '').trim().toLowerCase();
    const pin = String(body.pin || '').trim();

    if (!/^[a-z0-9]+$/.test(storeId) || !/^[0-9]{6}$/.test(pin)) {
      return sendJson(res, 401, { ok: false, message: '매장코드 또는 PIN을 확인해 주세요.' });
    }

    const token = randomToken();
    const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
    const result = await serviceRpc('owner_pin_login', {
      p_store_code: storeId,
      p_pin: pin,
      p_store_key_hash: secureHash(`store:${storeId}`),
      p_ip_hash: secureHash(`ip:${getClientIp(req)}`),
      p_token_hash: sha256(token),
      p_expires_at: expiresAt
    });

    if (!result || result.ok !== true) {
      if (result && result.code === 'RATE_LIMITED') {
        return sendJson(res, 429, {
          ok: false,
          message: '로그인 시도가 너무 많습니다. 15분 후 다시 시도해 주세요.'
        });
      }
      return sendJson(res, 401, { ok: false, message: '매장코드 또는 PIN을 확인해 주세요.' });
    }

    res.setHeader('Set-Cookie', sessionCookie(token));
    return sendJson(res, 200, {
      ok: true,
      store_name: result.store_name,
      expires_at: result.expires_at
    });
  } catch (_) {
    return sendJson(res, 500, { ok: false, message: '로그인을 처리하지 못했습니다.' });
  }
};
