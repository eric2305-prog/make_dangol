const {
  COOKIE_NAME,
  clearSessionCookie,
  parseCookies,
  sendJson,
  serviceRpc,
  serviceSelect,
  sha256
} = require('../../server/owner-security');

function maskPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 11) return `${digits.slice(0, 3)}-****-${digits.slice(7)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)}-***-${digits.slice(6)}`;
  return '****';
}

function defaultSettings(row) {
  return {
    reservation_url: row && row.reservation_url ? row.reservation_url : '',
    revisit_cycle_days: Number(row && row.revisit_cycle_days ? row.revisit_cycle_days : 30),
    default_message: row && row.default_message ? row.default_message : '방문 주기에 맞춰 다시 안내드릴게요.'
  };
}

function revisitLabel(remainingDays) {
  if (remainingDays <= 0) return '지남';
  if (remainingDays === 1) return '내일';
  if (remainingDays <= 7) return '이번 주';
  return `${remainingDays}일 뒤`;
}

function applyDefaultRevisitCycle(customer, revisitCycleDays) {
  const visitCount = Number(customer.visit_count || 0);
  const lastVisitDays = customer.last_visit_days === null || customer.last_visit_days === undefined
    ? null
    : Number(customer.last_visit_days);
  if (visitCount >= 2 || lastVisitDays === null || Number.isNaN(lastVisitDays)) return customer;

  const days = Number(revisitCycleDays || 30);
  const remainingDays = days - lastVisitDays;
  let statusKind = 'ok';
  let statusLabel = '여유 있음';
  if (remainingDays <= 0) {
    statusKind = 'due';
    statusLabel = '지금 안내';
  } else if (remainingDays <= 7) {
    statusKind = 'soon';
    statusLabel = '미리 안내';
  }

  return {
    ...customer,
    expected_revisit_label: revisitLabel(remainingDays),
    status_kind: statusKind,
    status_label: statusLabel
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { ok: false, message: '허용되지 않은 요청입니다.' });
  }

  const token = parseCookies(req)[COOKIE_NAME];
  if (!token || !/^[0-9a-f]{64}$/.test(token)) {
    res.setHeader('Set-Cookie', clearSessionCookie());
    return sendJson(res, 401, { ok: false, message: '로그인이 필요합니다.' });
  }

  try {
    const result = await serviceRpc('owner_session_dashboard', {
      p_token_hash: sha256(token)
    });

    if (!result || result.ok !== true || !result.snapshot) {
      res.setHeader('Set-Cookie', clearSessionCookie());
      return sendJson(res, 401, { ok: false, message: '로그인 시간이 만료됐습니다.' });
    }

    const store = result.snapshot.store || {};
    const storeId = store.store_id || store.store_code;
    const storeUuid = store.id;
    if (!storeId || !/^[a-z0-9]+$/.test(storeId)) {
      return sendJson(res, 500, { ok: false, message: '매장 정보를 확인할 수 없습니다.' });
    }

    if (!storeUuid || !/^[0-9a-f-]{36}$/i.test(storeUuid)) {
      return sendJson(res, 500, { ok: false, message: '매장 정보를 확인할 수 없습니다.' });
    }

    const settingsRows = await serviceSelect(
      'settings',
      `select=reservation_url,revisit_cycle_days,default_message&store_id=eq.${encodeURIComponent(storeUuid)}&limit=1`
    );
    const settings = defaultSettings(settingsRows[0] || null);
    const snapshotCustomers = Array.isArray(result.snapshot.customers)
      ? result.snapshot.customers.map((customer) => applyDefaultRevisitCycle(customer, settings.revisit_cycle_days))
      : [];
    result.snapshot.customers = snapshotCustomers;
    result.snapshot.metrics = {
      ...(result.snapshot.metrics || {}),
      recommended_customers: snapshotCustomers.filter((customer) => (
        customer.status_kind === 'due' || customer.status_kind === 'soon'
      )).length
    };

    const customerRows = await serviceSelect(
      'customers',
      `select=id,name,phone,created_at,last_visit_at,visit_count,kakao_agreed,marketing_agreed&store_id=eq.${encodeURIComponent(storeUuid)}&order=created_at.desc`
    );
    const recentRows = customerRows.slice(0, 5);
    const customerIds = recentRows.map((customer) => customer.id).filter(Boolean);
    const visitRows = customerIds.length
      ? await serviceSelect(
          'visits',
          `select=customer_id&store_id=eq.${encodeURIComponent(storeUuid)}&customer_id=in.(${customerIds.map(encodeURIComponent).join(',')})`
        )
      : [];
    const visitCounts = visitRows.reduce((counts, visit) => {
      counts[visit.customer_id] = (counts[visit.customer_id] || 0) + 1;
      return counts;
    }, {});
    const recentCustomers = recentRows.map((customer) => ({
      id: customer.id,
      name: customer.name,
      phone_masked: maskPhone(customer.phone),
      created_at: customer.created_at,
      last_visit_at: customer.last_visit_at,
      visit_count: visitCounts[customer.id] || 0
    }));
    const customerList = customerRows.map((customer) => ({
      id: customer.id,
      name: customer.name,
      phone_masked: maskPhone(customer.phone),
      last_visit_at: customer.last_visit_at,
      visit_count: Number(customer.visit_count || 0),
      kakao_agreed: customer.kakao_agreed === true,
      marketing_agreed: customer.marketing_agreed === true
    }));

    return sendJson(res, 200, {
      ok: true,
      snapshot: result.snapshot,
      recent_customers: recentCustomers,
      customer_list: customerList,
      settings,
      expires_at: result.expires_at,
      registration_url: `https://www.revaro.me/register?store_id=${encodeURIComponent(storeId)}`
    });
  } catch (_) {
    return sendJson(res, 500, { ok: false, message: '고객 데이터를 불러오지 못했습니다.' });
  }
};
