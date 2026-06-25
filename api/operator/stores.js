const {
  clearOperatorSessionCookie,
  getOperatorSession,
  sendJson
} = require('../../server/operator-security');
const { requiredEnv, serviceSelect, supabaseUrl } = require('../../server/owner-security');

const PAGE_SIZE = 1000;

function normalizeStatus(value) {
  const status = String(value || 'active').toLowerCase();
  if (status === 'pending') return 'pending';
  if (['suspended', 'blocked', 'inactive', 'churned', 'hold'].includes(status)) return 'suspended';
  return 'active';
}

function countsByStore(rows) {
  return rows.reduce((counts, row) => {
    if (!row.store_id) return counts;
    counts[row.store_id] = (counts[row.store_id] || 0) + 1;
    return counts;
  }, {});
}

async function serviceSelectAll(resource, query) {
  const url = supabaseUrl();
  const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const response = await fetch(`${url}/rest/v1/${resource}?${query}`, {
      method: 'GET',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Accept: 'application/json',
        Range: `${from}-${to}`
      }
    });
    if (!response.ok) {
      throw new Error(`Supabase select failed: ${resource} (${response.status})`);
    }
    const page = await response.json();
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
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

    const stores = await serviceSelectAll(
      'stores',
      'select=id,store_id,store_code,name,phone,address,industry,status,owner_id,created_at&order=created_at.desc'
    );
    const storeUuids = stores.map((store) => store.id).filter(Boolean);
    const ownerIds = stores.map((store) => store.owner_id).filter(Boolean);

    const owners = ownerIds.length
      ? await serviceSelect(
          'owners',
          `select=id,name,email&id=in.(${ownerIds.map(encodeURIComponent).join(',')})`
        )
      : [];
    const credentials = storeUuids.length
      ? await serviceSelect(
          'owner_credentials',
          `select=store_id,pin_updated_at&store_id=in.(${storeUuids.map(encodeURIComponent).join(',')})`
        )
      : [];
    const customers = storeUuids.length
      ? await serviceSelectAll(
          'customers',
          `select=store_id&store_id=in.(${storeUuids.map(encodeURIComponent).join(',')})`
        )
      : [];

    const ownersById = Object.fromEntries(owners.map((owner) => [owner.id, owner]));
    const credentialsByStore = Object.fromEntries(credentials.map((credential) => [credential.store_id, credential]));
    const customerCounts = countsByStore(customers);

    const resultStores = stores.map((store) => {
      const owner = ownersById[store.owner_id] || {};
      const credential = credentialsByStore[store.id] || null;
      const status = normalizeStatus(store.status);
      return {
        store_uuid: store.id,
        store_id: store.store_id || store.store_code || '',
        store_name: store.name || '',
        owner_name: owner.name || '',
        owner_email: owner.email || '',
        owner_status: status,
        phone: store.phone || '',
        address: store.address || '',
        industry: store.industry || '',
        status,
        raw_status: store.status || 'active',
        customer_count: customerCounts[store.id] || 0,
        created_at: store.created_at,
        pin_configured: !!credential,
        pin_updated_at: credential ? credential.pin_updated_at : null
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
  } catch (_) {
    return sendJson(res, 500, { ok: false, message: '매장 목록을 불러오지 못했습니다.' });
  }
};
