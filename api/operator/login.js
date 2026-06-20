const {
  OPERATOR_SESSION_SECONDS,
  hasTrustedOrigin,
  operatorEmail,
  operatorEmailHash,
  operatorIpHash,
  operatorSessionCookie,
  randomToken,
  readJson,
  sendJson,
  serviceRpc,
  sha256,
  verifyOperatorCredentials
} = require('../../server/operator-security');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { ok: false, message: '허용되지 않은 요청입니다.' });
  }
  if (!hasTrustedOrigin(req)) {
    return sendJson(res, 403, { ok: false, message: '요청 출처를 확인할 수 없습니다.' });
  }

  try {
    const body = await readJson(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!email || email.length > 160 || !password || password.length > 200) {
      return sendJson(res, 401, { ok: false, message: '로그인 정보를 확인해 주세요.' });
    }

    const emailHash = operatorEmailHash(email);
    const ipHash = operatorIpHash(req);
    const allowed = await serviceRpc('operator_login_allowed', {
      p_email_hash: emailHash,
      p_ip_hash: ipHash
    });
    if (!allowed || allowed.ok !== true) {
      return sendJson(res, 429, {
        ok: false,
        message: '로그인 시도가 너무 많습니다. 15분 후 다시 시도해 주세요.'
      });
    }

    if (!(await verifyOperatorCredentials(email, password))) {
      await serviceRpc('operator_login_failed', {
        p_email_hash: emailHash,
        p_ip_hash: ipHash
      });
      return sendJson(res, 401, { ok: false, message: '로그인 정보를 확인해 주세요.' });
    }

    const token = randomToken();
    const expiresAt = new Date(Date.now() + OPERATOR_SESSION_SECONDS * 1000).toISOString();
    const result = await serviceRpc('operator_session_create', {
      p_operator_email: operatorEmail(),
      p_token_hash: sha256(token),
      p_expires_at: expiresAt,
      p_email_hash: emailHash,
      p_ip_hash: ipHash
    });
    if (!result || result.ok !== true) {
      return sendJson(res, 500, { ok: false, message: '로그인을 처리하지 못했습니다.' });
    }

    res.setHeader('Set-Cookie', operatorSessionCookie(token));
    return sendJson(res, 200, {
      ok: true,
      operator_email: result.operator_email,
      expires_at: result.expires_at
    });
  } catch (_) {
    return sendJson(res, 500, { ok: false, message: '로그인을 처리하지 못했습니다.' });
  }
};
