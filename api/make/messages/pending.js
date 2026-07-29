const {
  sendJson,
  serviceSelect
} = require('../../../server/owner-security');
const {
  makeAuth,
  publicSendTarget,
  validatePendingMessage
} = require('../../../server/message-send-pipeline');

function limitFromRequest(req) {
  const value = new URL(req.url || '/', 'http://localhost').searchParams.get('limit');
  const limit = Number(value || 20);
  if (!Number.isFinite(limit)) return 20;
  return Math.max(1, Math.min(50, Math.floor(limit)));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { ok: false, message: '허용되지 않은 요청입니다.' });
  }

  try {
    makeAuth(req);
    const limit = limitFromRequest(req);
    const rows = await serviceSelect(
      'messages',
      `select=id,store_id,customer_id,message_type,channel,body,status,ai_status,send_status,provider,created_at,stores(store_code,name),customers(id,name,phone,kakao_agreed,marketing_agreed,consent)&message_type=eq.return_visit&ai_status=eq.generated&send_status=eq.pending&order=created_at.asc&limit=${limit}`
    );

    const messages = [];
    const skipped = [];
    for (const row of rows) {
      const duplicateRows = await serviceSelect(
        'messages',
        `select=id&store_id=eq.${encodeURIComponent(row.store_id)}&customer_id=eq.${encodeURIComponent(row.customer_id)}&message_type=eq.return_visit&send_status=eq.pending&limit=2`
      );
      const reasons = validatePendingMessage(row, duplicateRows);
      if (reasons.length) {
        skipped.push({ message_id: row.id, reasons });
      } else {
        messages.push(publicSendTarget(row));
      }
    }

    return sendJson(res, 200, {
      ok: true,
      messages,
      skipped_count: skipped.length,
      skipped
    });
  } catch (error) {
    const status = error && error.status ? error.status : 500;
    const code = error && error.code ? error.code : 'pending_messages_failed';
    return sendJson(res, status, {
      ok: false,
      code,
      message: error && error.message ? error.message : '발송 대상 메시지를 불러오지 못했습니다.'
    });
  }
};
