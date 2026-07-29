const {
  COOKIE_NAME,
  clearSessionCookie,
  parseCookies,
  sendJson,
  serviceRpc,
  serviceSelect,
  sha256
} = require('../../../server/owner-security');
const { hasBrokenDisplayText } = require('../../../server/ai-message');

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

function publicMessage(row, settings) {
  const customer = row.customers || {};
  const brokenBody = hasBrokenDisplayText(row.body);
  return {
    id: row.id,
    customer_id: row.customer_id,
    customer_name: hasBrokenDisplayText(customer.name) ? '고객명 확인 필요' : customer.name || '',
    last_visit_at: customer.last_visit_at || null,
    visit_count: Number(customer.visit_count || 0),
    expected_revisit_at: customer.last_visit_at
      ? new Date(new Date(customer.last_visit_at).getTime() + Number(settings.revisit_cycle_days || 30) * 86400000).toISOString()
      : null,
    booking_url: settings.reservation_url || '',
    has_booking_link: !!settings.reservation_url,
    body: brokenBody ? 'AI 문구 재생성이 필요합니다.' : row.body || '',
    ai_status: row.ai_status || 'not_started',
    send_status: row.send_status || row.status || 'draft',
    status: row.status || '',
    error_message: row.error_message || '',
    created_at: row.created_at
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { ok: false, message: '허용되지 않은 요청입니다.' });
  }

  try {
    const store = await ownerStore(req, res);
    if (!store) return;
    const storeFilter = encodeURIComponent(store.id);
    const rows = await serviceSelect(
      'messages',
      `select=id,customer_id,message_type,body,status,ai_status,send_status,error_message,created_at,customers(name,last_visit_at,visit_count)&store_id=eq.${storeFilter}&message_type=eq.return_visit&ai_status=eq.generated&send_status=in.(draft,pending)&order=created_at.desc&limit=50`
    );
    const settingsRows = await serviceSelect(
      'settings',
      `select=revisit_cycle_days,reservation_url&store_id=eq.${storeFilter}&limit=1`
    );
    return sendJson(res, 200, { ok: true, messages: rows.map((row) => publicMessage(row, settingsRows[0] || {})) });
  } catch (error) {
    console.error('owner messages failed', error && error.message ? error.message : 'unknown error');
    return sendJson(res, 500, { ok: false, message: 'AI 메시지를 불러오지 못했습니다.' });
  }
};
