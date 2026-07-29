const {
  clearOperatorSessionCookie,
  getOperatorSession,
  sendJson
} = require('../../server/operator-security');
const { serviceSelect } = require('../../server/owner-security');
const { hasBrokenDisplayText } = require('../../server/ai-message');

function publicMessage(row) {
  const customer = row.customers || {};
  const store = row.stores || {};
  const expectedRevisitAt = customer.last_visit_at
    ? new Date(new Date(customer.last_visit_at).getTime() + 30 * 86400000).toISOString()
    : null;
  return {
    id: row.id,
    store_id: store.store_code || '',
    store_name: store.name || '',
    customer_name: hasBrokenDisplayText(customer.name) ? '고객명 확인 필요' : customer.name || '',
    last_visit_at: customer.last_visit_at || null,
    expected_revisit_at: expectedRevisitAt,
    has_booking_link: !!store.booking_url,
    message_type: row.message_type,
    body: hasBrokenDisplayText(row.body) ? 'AI 문구 재생성이 필요합니다.' : row.body || '',
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
    const session = await getOperatorSession(req);
    if (!session) {
      res.setHeader('Set-Cookie', clearOperatorSessionCookie());
      return sendJson(res, 401, { ok: false, message: '운영관리자 로그인이 필요합니다.' });
    }

    const rows = await serviceSelect(
      'messages',
      'select=id,message_type,body,status,ai_status,send_status,error_message,created_at,stores(store_code,name,booking_url),customers(name,last_visit_at)&order=created_at.desc&limit=50'
    );

    return sendJson(res, 200, {
      ok: true,
      messages: rows.map(publicMessage)
    });
  } catch (error) {
    console.error('operator messages failed', error && error.message ? error.message : 'unknown error');
    return sendJson(res, 500, { ok: false, message: 'AI 메시지 목록을 불러오지 못했습니다.' });
  }
};
