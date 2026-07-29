const {
  readJson,
  sendJson,
  serviceInsert,
  serviceSelect,
  serviceUpdate
} = require('../../../server/owner-security');
const {
  makeAuth,
  providerName,
  resultStatus
} = require('../../../server/message-send-pipeline');

function messageIdFromBody(body) {
  return String(body && body.message_id ? body.message_id : '').trim();
}

function compactText(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { ok: false, message: '허용되지 않은 요청입니다.' });
  }

  try {
    makeAuth(req);
    const body = await readJson(req);
    const messageId = messageIdFromBody(body);
    const status = resultStatus(body.status);
    if (!/^[0-9a-f-]{36}$/i.test(messageId) || !status) {
      return sendJson(res, 400, { ok: false, message: '메시지 결과 정보가 올바르지 않습니다.' });
    }

    const rows = await serviceSelect(
      'messages',
      `select=id,store_id,customer_id,channel,send_status,retry_count&message_type=eq.return_visit&ai_status=eq.generated&id=eq.${encodeURIComponent(messageId)}&limit=1`
    );
    const message = rows[0];
    if (!message) {
      return sendJson(res, 404, { ok: false, message: '메시지를 찾을 수 없습니다.' });
    }
    if (message.send_status !== 'pending') {
      return sendJson(res, 409, {
        ok: false,
        code: 'not_pending',
        message: 'pending 상태 메시지만 발송 결과를 기록할 수 있습니다.'
      });
    }

    const now = new Date().toISOString();
    const provider = providerName(body.provider);
    const providerMessageId = compactText(body.provider_message_id, 200) || null;
    const failedReason = compactText(body.failed_reason || body.error_message, 500) || null;
    const statusCode = Number.isFinite(Number(body.status_code)) ? Number(body.status_code) : null;
    const responsePayload = body.response_payload && typeof body.response_payload === 'object'
      ? body.response_payload
      : null;
    const nextRetryCount = Number(message.retry_count || 0) + (status === 'failed' ? 1 : 0);

    const updateBody = status === 'success'
      ? {
          status: 'sent',
          send_status: 'sent',
          provider,
          provider_message_id: providerMessageId,
          sent_at: now,
          failed_at: null,
          failed_reason: null,
          last_attempt_at: now,
          retry_count: nextRetryCount,
          updated_at: now
        }
      : {
          status: 'failed',
          send_status: 'failed',
          provider,
          provider_message_id: providerMessageId,
          failed_at: now,
          failed_reason: failedReason || '발송 실패',
          last_attempt_at: now,
          retry_count: nextRetryCount,
          updated_at: now
        };

    const updatedRows = await serviceUpdate(
      'messages',
      `id=eq.${encodeURIComponent(message.id)}`,
      updateBody
    );

    const logRows = await serviceInsert('send_logs', {
      store_id: message.store_id,
      message_id: message.id,
      channel: message.channel || 'kakao',
      status,
      provider,
      provider_message_id: providerMessageId,
      status_code: statusCode,
      response_payload: responsePayload,
      error_message: status === 'failed' ? failedReason || '발송 실패' : null,
      attempted_at: now
    });

    return sendJson(res, 200, {
      ok: true,
      message_row: updatedRows[0],
      send_log: logRows[0]
    });
  } catch (error) {
    const status = error && error.status ? error.status : 500;
    const code = error && error.code ? error.code : 'message_result_failed';
    return sendJson(res, status, {
      ok: false,
      code,
      message: error && error.message ? error.message : '발송 결과를 저장하지 못했습니다.'
    });
  }
};
