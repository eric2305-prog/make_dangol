const { test, expect } = require('@playwright/test');

const settingsHandler = require('../api/owner/settings');
const dashboardHandler = require('../api/owner/dashboard');

const STORE_UUID = '00000000-0000-4000-8000-000000000001';
const TOKEN = 'b'.repeat(64);

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(body); },
    async json() { return body; }
  };
}

function createResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(value) { this.body = value || ''; }
  };
}

function request(method, body, authenticated = true) {
  return {
    method,
    url: '/api/owner/settings',
    query: {},
    headers: authenticated ? { cookie: `__Host-owner_session=${TOKEN}` } : {},
    body
  };
}

function sessionSnapshot() {
  return {
    ok: true,
    expires_at: '2026-06-26T10:00:00Z',
    snapshot: {
      store: {
        id: STORE_UUID,
        store_id: 'test01',
        store_code: 'test01',
        name: '테스트 매장',
        phone: '0212345678',
        address: '서울 테스트로 1'
      },
      metrics: { pending_messages: 0, total_customers: 0, recommended_customers: 0, new_customers_this_month: 0 },
      customers: []
    }
  };
}

test.describe('owner settings security and persistence', () => {
  let originalFetch;

  test.beforeEach(() => {
    originalFetch = global.fetch;
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-service-key';
  });

  test.afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  test('unauthenticated settings requests are rejected', async () => {
    global.fetch = async () => { throw new Error('fetch must not be called'); };
    const res = createResponse();
    await settingsHandler(request('GET', null, false), res);
    expect(res.statusCode).toBe(401);
  });

  test('settings GET uses the session store and returns read-only store info', async () => {
    const calls = [];
    global.fetch = async (url) => {
      calls.push(String(url));
      if (String(url).includes('/rpc/owner_session_dashboard')) return jsonResponse(sessionSnapshot());
      if (String(url).includes('/rest/v1/settings?')) {
        return jsonResponse([{ store_id: STORE_UUID, reservation_url: 'https://booking.example.com', revisit_cycle_days: 21, default_message: '다시 방문 안내드립니다.' }]);
      }
      return jsonResponse([], 404);
    };

    const res = createResponse();
    await settingsHandler(request('GET'), res);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.store).toEqual({
      store_id: 'test01',
      name: '테스트 매장',
      phone: '0212345678',
      address: '서울 테스트로 1'
    });
    expect(body.settings.revisit_cycle_days).toBe(21);
    expect(calls.find((url) => url.includes('/rest/v1/settings?'))).toContain(`store_id=eq.${STORE_UUID}`);
  });

  test('settings PATCH only upserts editable operation fields', async () => {
    const calls = [];
    global.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('/rpc/owner_session_dashboard')) return jsonResponse(sessionSnapshot());
      if (options.method === 'POST') {
        const body = JSON.parse(options.body);
        return jsonResponse([body]);
      }
      if (String(url).includes('/rest/v1/settings?')) return jsonResponse([]);
      return jsonResponse([], 404);
    };

    const res = createResponse();
    await settingsHandler(request('PATCH', {
      name: '바뀌면 안 되는 매장명',
      phone: '01099998888',
      address: '바뀌면 안 되는 주소',
      store_id: 'other01',
      reservation_url: 'https://booking.example.com/path',
      revisit_cycle_days: 45,
      default_message: '방문 시기에 맞춰 안내드릴게요.'
    }), res);

    expect(res.statusCode).toBe(200);
    const upsertCall = calls.find((call) => (
      call.options.method === 'POST' && call.url.includes('/rest/v1/settings?')
    ));
    const body = JSON.parse(upsertCall.options.body);
    expect(body).toEqual(expect.objectContaining({
      store_id: STORE_UUID,
      reservation_url: 'https://booking.example.com/path',
      revisit_cycle_days: 45,
      default_message: '방문 시기에 맞춰 안내드릴게요.'
    }));
    expect(body.name).toBeUndefined();
    expect(body.phone).toBeUndefined();
    expect(body.address).toBeUndefined();
  });

  test('dashboard applies desired cycle to insufficient data and actual average interval to repeat customers', async () => {
    const calls = [];
    global.fetch = async (url) => {
      calls.push(String(url));
      if (String(url).includes('/rpc/owner_session_dashboard')) return jsonResponse(sessionSnapshot());
      if (String(url).includes('/rest/v1/settings?')) {
        return jsonResponse([{ reservation_url: '', revisit_cycle_days: 14, default_message: '기본 문구' }]);
      }
      if (String(url).includes('/rest/v1/customers?')) {
        return jsonResponse([
          {
            id: '10000000-0000-4000-8000-000000000001',
            name: '신규 고객',
            phone: '01011112222',
            created_at: '2026-01-01T00:00:00Z',
            last_visit_at: '2026-01-01T00:00:00Z',
            visit_count: 1
          },
          {
            id: '10000000-0000-4000-8000-000000000002',
            name: '반복 고객',
            phone: '01033334444',
            created_at: '2026-01-01T00:00:00Z',
            last_visit_at: '2026-06-20T00:00:00Z',
            visit_count: 3
          }
        ]);
      }
      if (String(url).includes('/rest/v1/visits?')) {
        return jsonResponse([
          { customer_id: '10000000-0000-4000-8000-000000000001', visit_date: '2026-01-01T00:00:00Z' },
          { customer_id: '10000000-0000-4000-8000-000000000002', visit_date: '2026-01-01T00:00:00Z' },
          { customer_id: '10000000-0000-4000-8000-000000000002', visit_date: '2026-03-01T00:00:00Z' },
          { customer_id: '10000000-0000-4000-8000-000000000002', visit_date: '2026-06-20T00:00:00Z' }
        ]);
      }
      return jsonResponse([], 404);
    };

    const res = createResponse();
    await dashboardHandler({ method: 'GET', url: '/api/owner/dashboard', headers: { cookie: `__Host-owner_session=${TOKEN}` } }, res);
    expect(res.statusCode).toBe(200);
    const customers = JSON.parse(res.body).snapshot.customers;
    expect(customers[0]).toEqual(expect.objectContaining({
      name: '신규 고객',
      revisit_basis: 'desired_cycle',
      revisit_basis_label: '희망 주기',
      status_kind: 'due',
      status_label: '지금 안내'
    }));
    expect(customers[1]).toEqual(expect.objectContaining({
      name: '반복 고객',
      revisit_basis: 'actual_interval',
      revisit_basis_label: '실제 방문 간격',
      status_kind: 'ok',
      status_label: '여유 있음'
    }));
    expect(calls.find((url) => url.includes('/rest/v1/settings?'))).toContain(`store_id=eq.${STORE_UUID}`);
    expect(calls.find((url) => url.includes('/rest/v1/visits?'))).toContain(`store_id=eq.${STORE_UUID}`);
  });
});
