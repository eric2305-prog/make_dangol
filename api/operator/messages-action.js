const {
  clearOperatorSessionCookie,
  getOperatorSession,
  readJson,
  sendJson
} = require('../../server/operator-security');
const { serviceSelect, serviceUpdate } = require('../../server/owner-security');
const { hasBrokenDisplayText, hasForbiddenMessageText } = require('../../server/ai-message');

async function approveMessage(message) {
  if (message.ai_status !== 'generated' || message.send_status !== 'draft' || !message.body) {
    const error = new Error('승인할 수 없는 메시지 상태입니다.');
    error.code = 'not_approvable';
    throw error;
  }
  if (hasForbiddenMessageText(message.body)) {
    const error = new Error('테스트/대체 문구는 승인할 수 없습니다.');
    error.code = 'blocked_message_body';
    throw error;
  }
  if (hasBrokenDisplayText(message.body)) {
    const error = new Error('고객명 또는 문구가 깨져 승인할 수 없습니다.');
    error.code = 'broken_message_body';
    throw error;
  }

  const customer = message.customers || {};
  if (!(customer.kakao_agreed === true && customer.marketing_agreed === true && customer.consent !== false)) {
    const error = new Error('고객 수신 동의가 없어 승인할 수 없습니다.');
    error.code = 'consent_required';
    throw error;
  }

  const duplicateRows = await serviceSelect(
    'messages',
    `select=id&store_id=eq.${encodeURIComponent(message.store_id)}&customer_id=eq.${encodeURIComponent(message.customer_id)}&message_type=eq.return_visit&send_status=eq.pending&id=neq.${encodeURIComponent(message.id)}&limit=1`
  );
  if (duplicateRows.length) {
    const error = new Error('이미 발송 대기 중인 메시지가 있습니다.');
    error.code = 'duplicate_pending';
    throw error;
  }

  const rows = await serviceUpdate('messages', `id=eq.${encodeURIComponent(message.id)}`, {
    status: 'pending',
    send_status: 'pending',
    updated_at: new Date().toISOString()
  });
  return rows[0];
}

async function cancelMessage(message) {
  const rows = await serviceUpdate('messages', `id=eq.${encodeURIComponent(message.id)}`, {
    status: 'canceled',
    send_status: 'canceled',
    updated_at: new Date().toISOString()
  });
  return rows[0];
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { ok: false, message: '허용되지 않은 요청입니다.' });
  }

  try {
    const session = await getOperatorSession(req);
    if (!session) {
      res.setHeader('Set-Cookie', clearOperatorSessionCookie());
      return sendJson(res, 401, { ok: false, message: '운영관리자 로그인이 필요합니다.' });
    }

    const body = await readJson(req);
    const messageId = String(body.message_id || '').trim();
    const action = String(body.action || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(messageId) || !['approve', 'cancel'].includes(action)) {
      return sendJson(res, 400, { ok: false, message: '요청 정보가 올바르지 않습니다.' });
    }

    const rows = await serviceSelect(
      'messages',
      `select=id,store_id,customer_id,message_type,body,status,ai_status,send_status,customers(kakao_agreed,marketing_agreed,consent)&id=eq.${encodeURIComponent(messageId)}&limit=1`
    );
    const message = rows[0];
    if (!message) {
      return sendJson(res, 404, { ok: false, message: '메시지를 찾을 수 없습니다.' });
    }

    const updated = action === 'approve'
      ? await approveMessage(message)
      : await cancelMessage(message);

    return sendJson(res, 200, { ok: true, message_row: updated });
  } catch (error) {
    const code = error && error.code ? error.code : 'message_action_failed';
    const status = ['not_approvable', 'blocked_message_body', 'broken_message_body', 'consent_required', 'duplicate_pending'].includes(code) ? 409 : 500;
    return sendJson(res, status, { ok: false, code, message: error && error.message ? error.message : '메시지를 처리하지 못했습니다.' });
  }
};
