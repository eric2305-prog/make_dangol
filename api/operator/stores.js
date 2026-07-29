const {
  clearOperatorSessionCookie,
  getOperatorSession,
  serviceRpc,
  sendJson
} = require('../../server/operator-security');

function normalizeStatus(value) {
  const status = String(value || 'active').toLowerCase();
  if (status === 'pending') return 'pending';
  if (['suspended', 'blocked', 'inactive', 'churned', 'hold'].includes(status)) return 'suspended';
  return 'active';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { ok: false });
  }

  try {
    const session = await getOperatorSession(req);
    if (!session) {
      res.setHeader('Set-Cookie', clearOperatorSessionCookie());
      return sendJson(res, 401, { ok: false, message: '운영관리자 로그인이 필요합니다.' });
    }

    const result = await serviceRpc('operator_list_stores', {
      p_token_hash: session.tokenHash
    });
    if (!result || result.ok !== true) {
      res.setHeader('Set-Cookie', clearOperatorSessionCookie());
      return sendJson(res, 401, { ok: false, message: '운영관리자 권한을 확인하지 못했습니다.' });
    }

    const resultStores = (result.stores || []).map((store) => {
      const status = normalizeStatus(store.status);
      return {
        store_uuid: store.store_uuid || '',
        store_id: store.store_id || '',
        store_name: store.store_name || '',
        owner_name: store.owner_name || '',
        owner_email: store.owner_email || '',
        owner_status: status,
        phone: store.phone || '',
        address: store.address || '',
        industry: store.industry || '',
        status,
        raw_status: store.status || 'active',
        customer_count: Number(store.customer_count || 0),
        created_at: store.created_at,
        pin_configured: !!store.pin_configured,
        pin_updated_at: store.pin_updated_at || null
      };
    });

    const metrics = resultStores.reduce((summary, store) => {
      summary.total_stores += 1;
      summary.total_customers += Number(store.customer_count || 0);
      summary[`${store.status}_stores`] += 1;
      return summary;
    }, {
      total_stores: 0,
      active_stores: 0,
      pending_stores: 0,
      suspended_stores: 0,
      total_customers: 0
    });

    return sendJson(res, 200, {
      ok: true,
      stores: resultStores,
      metrics,
      operator_email: session.operator_email
    });
  } catch (error) {
    console.error('operator stores failed', error && error.message ? error.message : 'unknown error');
    return sendJson(res, 500, { ok: false, message: '매장 목록을 불러오지 못했습니다.' });
  }
};
