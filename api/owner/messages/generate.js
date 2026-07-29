const {
  COOKIE_NAME,
  clearSessionCookie,
  parseCookies,
  readJson,
  sendJson,
  serviceInsert,
  serviceRpc,
  serviceSelect,
  serviceUpdate,
  sha256
} = require('../../../server/owner-security');
const {
  generateCustomerMessage,
  hasForbiddenMessageText,
  messageModel
} = require('../../../server/ai-message');

function customerIdFromBody(body) {
  return String(body && body.customer_id ? body.customer_id : '').trim();
}

function messageIdFromBody(body) {
  return String(body && body.message_id ? body.message_id : '').trim();
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

async function insertFailedMessage(storeId, customerId, reason) {
  try {
    const rows = await serviceInsert('messages', {
      store_id: storeId,
      customer_id: customerId,
      message_type: 'return_visit',
      channel: 'kakao',
      body: null,
      status: 'failed',
      ai_status: 'failed',
      send_status: 'draft',
      error_message: String(reason || 'AI 문구 생성 실패').slice(0, 300)
    });
    return rows[0] || null;
  } catch (_) {
    return null;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { ok: false, message: '허용되지 않은 요청입니다.' });
  }

  try {
    const store = await ownerStore(req, res);
    if (!store) return;

    const body = await readJson(req);
    let customerId = customerIdFromBody(body);
    const messageId = messageIdFromBody(body);
    if (messageId) {
      if (!/^[0-9a-f-]{36}$/i.test(messageId)) {
        return sendJson(res, 400, { ok: false, message: '메시지 정보가 올바르지 않습니다.' });
      }
      const messageRows = await serviceSelect(
        'messages',
        `select=id,customer_id,send_status&store_id=eq.${encodeURIComponent(store.id)}&id=eq.${encodeURIComponent(messageId)}&limit=1`
      );
      if (!messageRows.length) {
        return sendJson(res, 404, { ok: false, message: '메시지를 찾을 수 없습니다.' });
      }
      customerId = messageRows[0].customer_id;
    }

    if (!/^[0-9a-f-]{36}$/i.test(customerId)) {
      return sendJson(res, 400, { ok: false, message: '고객 정보가 올바르지 않습니다.' });
    }

    const storeFilter = encodeURIComponent(store.id);
    const customerFilter = encodeURIComponent(customerId);
    const customerRows = await serviceSelect(
      'customers',
      `select=id,name,last_visit_at,visit_count,kakao_agreed,marketing_agreed,consent&store_id=eq.${storeFilter}&id=eq.${customerFilter}&limit=1`
    );
    const customer = customerRows[0];
    if (!customer) {
      return sendJson(res, 404, { ok: false, message: '고객을 찾을 수 없습니다.' });
    }

    const hasConsent = customer.kakao_agreed === true && customer.marketing_agreed === true && customer.consent !== false;
    if (!hasConsent) {
      return sendJson(res, 409, { ok: false, code: 'consent_required', message: '고객 수신 동의가 없어 AI 문구를 생성하지 않았습니다.' });
    }

    const duplicateRows = await serviceSelect(
      'messages',
      `select=id,body,ai_status,send_status,created_at&store_id=eq.${storeFilter}&customer_id=eq.${customerFilter}&message_type=eq.return_visit&send_status=eq.pending&limit=1`
    );
    if (duplicateRows.length) {
      return sendJson(res, 409, {
        ok: false,
        code: 'duplicate_pending',
        message: '이미 발송 대기 중인 AI 메시지가 있습니다.',
        message_row: duplicateRows[0]
      });
    }

    const settingsRows = await serviceSelect(
      'settings',
      `select=reservation_url,revisit_cycle_days&store_id=eq.${storeFilter}&limit=1`
    );
    const settings = settingsRows[0] || {};

    let generated;
    try {
      generated = await generateCustomerMessage({ store, customer, settings });
    } catch (error) {
      await insertFailedMessage(store.id, customer.id, error && error.message ? error.message : 'AI 문구 생성 실패');
      return sendJson(res, 502, {
        ok: false,
        code: 'ai_generation_failed',
        message: 'AI 문구 생성 실패'
      });
    }

    if (hasForbiddenMessageText(generated.body)) {
      await insertFailedMessage(store.id, customer.id, '금지된 테스트/대체 문구 차단');
      return sendJson(res, 422, {
        ok: false,
        code: 'blocked_message_body',
        message: 'AI 문구 생성 실패'
      });
    }

    const insertedRows = await serviceInsert('messages', {
      store_id: store.id,
      customer_id: customer.id,
      message_type: 'return_visit',
      channel: 'kakao',
      body: generated.body,
      status: 'draft',
      ai_status: 'generated',
      send_status: 'draft',
      ai_model: generated.model || messageModel()
    });

    if (messageId) {
      await serviceUpdate(
        'messages',
        `id=eq.${encodeURIComponent(messageId)}&store_id=eq.${storeFilter}`,
        {
          status: 'canceled',
          send_status: 'canceled',
          updated_at: new Date().toISOString()
        }
      );
    }

    return sendJson(res, 201, {
      ok: true,
      message_row: insertedRows[0],
      model: generated.model || messageModel()
    });
  } catch (error) {
    console.error('owner ai message generation failed', error && error.message ? error.message : 'unknown error');
    return sendJson(res, 500, { ok: false, message: 'AI 문구를 생성하지 못했습니다.' });
  }
};
