const {
  COOKIE_NAME,
  clearSessionCookie,
  parseCookies,
  readJson,
  sendJson,
  serviceRpc,
  serviceSelect,
  serviceUpdate,
  sha256
} = require('../../server/owner-security');

function customerIdFromRequest(req) {
  const value = req.query && req.query.customer_id
    ? req.query.customer_id
    : new URL(req.url || '/', 'http://localhost').searchParams.get('customer_id');
  return String(value || '').trim();
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function publicCustomer(row) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    last_visit_at: row.last_visit_at,
    visit_count: Number(row.visit_count || 0),
    kakao_agreed: row.kakao_agreed === true,
    marketing_agreed: row.marketing_agreed === true,
    created_at: row.created_at
  };
}

async function ownerStore(req, res) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token || !/^[0-9a-f]{64}$/.test(token)) {
    res.setHeader('Set-Cookie', clearSessionCookie());
    sendJson(res, 401, { ok: false, message: '로그인이 필요합니다.' });
    return null;
  }

  const result = await serviceRpc('owner_session_dashboard', {
    p_token_hash: sha256(token)
  });
  const store = result && result.ok === true && result.snapshot
    ? result.snapshot.store || {}
    : {};
  if (!store.id || !/^[0-9a-f-]{36}$/i.test(store.id)) {
    res.setHeader('Set-Cookie', clearSessionCookie());
    sendJson(res, 401, { ok: false, message: '로그인 시간이 만료됐습니다.' });
    return null;
  }
  return store;
}

module.exports = async function handler(req, res) {
  if (!['GET', 'PATCH'].includes(req.method)) {
    res.setHeader('Allow', 'GET, PATCH');
    return sendJson(res, 405, { ok: false, message: '허용되지 않은 요청입니다.' });
  }

  const customerId = customerIdFromRequest(req);
  if (!/^[0-9a-f-]{36}$/i.test(customerId)) {
    return sendJson(res, 400, { ok: false, message: '고객 정보가 올바르지 않습니다.' });
  }

  try {
    const store = await ownerStore(req, res);
    if (!store) return;
    const storeFilter = encodeURIComponent(store.id);
    const customerFilter = encodeURIComponent(customerId);
    const select = 'id,name,phone,last_visit_at,visit_count,kakao_agreed,marketing_agreed,created_at';

    const rows = await serviceSelect(
      'customers',
      `select=${select}&id=eq.${customerFilter}&store_id=eq.${storeFilter}&limit=1`
    );
    if (!rows.length) {
      return sendJson(res, 404, { ok: false, message: '고객을 찾을 수 없습니다.' });
    }

    if (req.method === 'GET') {
      return sendJson(res, 200, { ok: true, customer: publicCustomer(rows[0]) });
    }

    const body = await readJson(req);
    const name = String(body.name || '').trim();
    const phone = normalizePhone(body.phone);
    if (!name || name.length > 50 || ![10, 11].includes(phone.length)) {
      return sendJson(res, 400, { ok: false, message: '이름과 휴대폰 번호를 확인해 주세요.' });
    }
    if (typeof body.kakao_agreed !== 'boolean' || typeof body.marketing_agreed !== 'boolean') {
      return sendJson(res, 400, { ok: false, message: '수신 동의 값을 확인해 주세요.' });
    }

    const duplicates = await serviceSelect(
      'customers',
      `select=id&store_id=eq.${storeFilter}&phone=eq.${encodeURIComponent(phone)}&id=neq.${customerFilter}&limit=1`
    );
    if (duplicates.length) {
      return sendJson(res, 409, { ok: false, code: 'duplicate_phone', message: '같은 휴대폰 번호로 등록된 고객이 있습니다.' });
    }

    const updated = await serviceUpdate(
      'customers',
      `id=eq.${customerFilter}&store_id=eq.${storeFilter}`,
      {
        name,
        phone,
        kakao_agreed: body.kakao_agreed,
        marketing_agreed: body.marketing_agreed,
        consent: body.kakao_agreed && body.marketing_agreed,
        updated_at: new Date().toISOString()
      }
    );
    if (!updated.length) {
      return sendJson(res, 404, { ok: false, message: '고객을 찾을 수 없습니다.' });
    }
    return sendJson(res, 200, { ok: true, customer: publicCustomer(updated[0]) });
  } catch (error) {
    if (error && error.status === 409) {
      return sendJson(res, 409, { ok: false, code: 'duplicate_phone', message: '같은 휴대폰 번호로 등록된 고객이 있습니다.' });
    }
    return sendJson(res, 500, { ok: false, message: '고객 정보를 처리하지 못했습니다.' });
  }
};
