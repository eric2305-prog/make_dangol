const crypto = require('node:crypto');
const {
  clearOperatorSessionCookie,
  getOperatorSession,
  hasTrustedOrigin,
  readJson,
  sendJson,
  serviceRpc
} = require('../../../server/operator-security');

const REASONS = new Set(['initial_issue', 'reissue']);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { ok: false, message: '허용되지 않은 요청입니다.' });
  }
  if (!hasTrustedOrigin(req)) {
    return sendJson(res, 403, { ok: false, message: '요청 출처를 확인할 수 없습니다.' });
  }

  try {
    const session = await getOperatorSession(req);
    if (!session) {
      res.setHeader('Set-Cookie', clearOperatorSessionCookie());
      return sendJson(res, 401, { ok: false, message: '운영자 로그인이 필요합니다.' });
    }

    const body = await readJson(req);
    const storeId = String(body.store_id || '').trim().toLowerCase();
    const reason = String(body.reason || '');
    if (!/^[a-z0-9]+$/.test(storeId) || !REASONS.has(reason)) {
      return sendJson(res, 400, { ok: false, message: '매장과 발급 사유를 확인해 주세요.' });
    }

    const pin = String(crypto.randomInt(100000, 1000000));
    const result = await serviceRpc('operator_issue_owner_pin', {
      p_token_hash: session.tokenHash,
      p_store_code: storeId,
      p_pin: pin,
      p_reason: reason
    });
    if (!result || result.ok !== true) {
      const status = result && result.code === 'STORE_NOT_FOUND' ? 404 : 400;
      return sendJson(res, status, { ok: false, message: 'PIN을 발급하지 못했습니다.' });
    }

    return sendJson(res, 200, {
      ok: true,
      action: result.action,
      store_id: result.store_id,
      store_name: result.store_name,
      pin
    });
  } catch (_) {
    return sendJson(res, 500, { ok: false, message: 'PIN을 발급하지 못했습니다.' });
  }
};
