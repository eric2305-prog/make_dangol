const {
  COOKIE_NAME,
  clearSessionCookie,
  parseCookies,
  sendJson,
  serviceRpc,
  serviceSelect,
  sha256
} = require('../../server/owner-security');

const DEFAULT_REVISIT_DAYS = 30;
const SOON_DAYS = 7;

function maskPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 11) return `${digits.slice(0, 3)}-****-${digits.slice(7)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)}-***-${digits.slice(6)}`;
  return '****';
}

function defaultSettings(row) {
  return {
    reservation_url: row && row.reservation_url ? row.reservation_url : '',
    revisit_cycle_days: Number(row && row.revisit_cycle_days ? row.revisit_cycle_days : DEFAULT_REVISIT_DAYS),
    default_message: row && row.default_message ? row.default_message : '방문 주기에 맞춰 다시 안내드릴게요.'
  };
}

function kstDateOnly(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00.000Z`);
}

function daysBetween(from, to) {
  const start = kstDateOnly(from);
  const end = kstDateOnly(to);
  if (!start || !end) return null;
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

function addDays(value, days) {
  const base = kstDateOnly(value);
  if (!base) return null;
  return new Date(base.getTime() + Number(days || 0) * 86400000);
}

function visitDate(row) {
  return row.visit_date || row.visited_at || row.created_at || null;
}

function expectedLabel(remainingDays) {
  if (remainingDays < 0) return `${Math.abs(remainingDays)}일 지남`;
  if (remainingDays === 0) return '오늘';
  if (remainingDays === 1) return '내일';
  if (remainingDays <= SOON_DAYS) return `${remainingDays}일 뒤`;
  return `${remainingDays}일 뒤`;
}

function averageVisitGapDays(visitRows) {
  const dates = visitRows
    .map(visitDate)
    .filter(Boolean)
    .map((value) => kstDateOnly(value))
    .filter(Boolean)
    .sort((a, b) => a.getTime() - b.getTime());

  if (dates.length < 2) return null;

  const gaps = [];
  for (let index = 1; index < dates.length; index += 1) {
    const gap = Math.max(1, Math.round((dates[index].getTime() - dates[index - 1].getTime()) / 86400000));
    gaps.push(gap);
  }
  if (!gaps.length) return null;
  return Math.max(1, Math.round(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length));
}

function buildRevisitCustomer(customer, visits, settings, now = new Date()) {
  const visitRows = visits[customer.id] || [];
  const visitCount = Number(customer.visit_count || visitRows.length || 0);
  const lastVisitAt = customer.last_visit_at || visitRows.map(visitDate).filter(Boolean).sort().at(-1) || null;
  const lastVisitDays = lastVisitAt ? daysBetween(lastVisitAt, now) : null;

  let basisKind = 'desired_cycle';
  let basisLabel = '희망 주기';
  let cycleDays = Number(settings.revisit_cycle_days || DEFAULT_REVISIT_DAYS);

  if (visitCount >= 2 && visitRows.length >= 2) {
    const averageGap = averageVisitGapDays(visitRows);
    if (averageGap) {
      basisKind = 'actual_interval';
      basisLabel = '실제 방문 간격';
      cycleDays = averageGap;
    }
  }

  const expectedDate = lastVisitAt ? addDays(lastVisitAt, cycleDays) : null;
  const remainingDays = expectedDate ? daysBetween(now, expectedDate) : null;
  let statusKind = 'ok';
  let statusLabel = '여유 있음';
  if (remainingDays !== null && remainingDays <= 0) {
    statusKind = 'due';
    statusLabel = '지금 안내';
  } else if (remainingDays !== null && remainingDays <= SOON_DAYS) {
    statusKind = 'soon';
    statusLabel = '미리 안내';
  }

  return {
    id: customer.id,
    name: customer.name,
    phone_masked: maskPhone(customer.phone),
    visit_count: visitCount,
    last_visit_at: lastVisitAt,
    last_visit_days: lastVisitDays,
    expected_revisit_label: remainingDays === null ? '-' : expectedLabel(remainingDays),
    expected_revisit_at: expectedDate ? expectedDate.toISOString() : null,
    revisit_basis: basisKind,
    revisit_basis_label: basisLabel,
    revisit_cycle_days: cycleDays,
    status_kind: statusKind,
    status_label: statusLabel
  };
}

function sortRevisitCustomers(customers) {
  const group = { due: 0, soon: 1, ok: 2 };
  return customers.sort((a, b) => {
    const g = (group[a.status_kind] ?? 3) - (group[b.status_kind] ?? 3);
    if (g !== 0) return g;
    return Number(b.last_visit_days || 0) - Number(a.last_visit_days || 0);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { ok: false, message: '허용되지 않는 요청입니다.' });
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
      return sendJson(res, 401, { ok: false, message: '로그인 시간이 만료되었습니다.' });
    }

    const store = result.snapshot.store || {};
    const storeId = store.store_id || store.store_code;
    const storeUuid = store.id;
    if (!storeId || !/^[a-z0-9]+$/.test(storeId) || !storeUuid || !/^[0-9a-f-]{36}$/i.test(storeUuid)) {
      return sendJson(res, 500, { ok: false, message: '매장 정보를 확인할 수 없습니다.' });
    }

    const settingsRows = await serviceSelect(
      'settings',
      `select=reservation_url,revisit_cycle_days,default_message&store_id=eq.${encodeURIComponent(storeUuid)}&limit=1`
    );
    const settings = defaultSettings(settingsRows[0] || null);

    const customerRows = await serviceSelect(
      'customers',
      `select=id,name,phone,created_at,last_visit_at,visit_count,kakao_agreed,marketing_agreed&store_id=eq.${encodeURIComponent(storeUuid)}&order=created_at.desc`
    );

    const visitRows = customerRows.length
      ? await serviceSelect(
          'visits',
          `select=customer_id,visit_date,created_at&store_id=eq.${encodeURIComponent(storeUuid)}&order=visit_date.asc`
        )
      : [];

    const visitsByCustomer = visitRows.reduce((groups, visit) => {
      if (!visit.customer_id) return groups;
      groups[visit.customer_id] = groups[visit.customer_id] || [];
      groups[visit.customer_id].push(visit);
      return groups;
    }, {});

    const revisitCustomers = sortRevisitCustomers(
      customerRows.map((customer) => buildRevisitCustomer(customer, visitsByCustomer, settings))
    );

    const recentRows = customerRows.slice(0, 5);
    const recentCustomers = recentRows.map((customer) => ({
      id: customer.id,
      name: customer.name,
      phone_masked: maskPhone(customer.phone),
      created_at: customer.created_at,
      last_visit_at: customer.last_visit_at,
      visit_count: Number(customer.visit_count || (visitsByCustomer[customer.id] || []).length || 0)
    }));
    const customerList = customerRows.map((customer) => ({
      id: customer.id,
      name: customer.name,
      phone_masked: maskPhone(customer.phone),
      last_visit_at: customer.last_visit_at,
      visit_count: Number(customer.visit_count || (visitsByCustomer[customer.id] || []).length || 0),
      kakao_agreed: customer.kakao_agreed === true,
      marketing_agreed: customer.marketing_agreed === true
    }));

    const recommendedCount = revisitCustomers.filter((customer) => (
      customer.status_kind === 'due' || customer.status_kind === 'soon'
    )).length;
    result.snapshot.customers = revisitCustomers;
    result.snapshot.metrics = {
      ...(result.snapshot.metrics || {}),
      total_customers: customerRows.length,
      recommended_customers: recommendedCount
    };

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
