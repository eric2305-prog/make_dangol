const { test, expect } = require('@playwright/test');

const customerHandler = require('../api/owner/customer');

const STORE_ID = '00000000-0000-4000-8000-000000000001';
const CUSTOMER_ID = '10000000-0000-4000-8000-000000000001';
const OTHER_CUSTOMER_ID = '20000000-0000-4000-8000-000000000002';
const TOKEN = 'a'.repeat(64);

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

function request(method, customerId, body, authenticated = true) {
  return {
    method,
    url: `/api/owner/customer?customer_id=${customerId}`,
    query: { customer_id: customerId },
    headers: authenticated ? { cookie: `__Host-owner_session=${TOKEN}` } : {},
    body
  };
}

function sessionResponse() {
  return jsonResponse({
    ok: true,
    snapshot: { store: { id: STORE_ID, store_code: 'test01', name: '테스트 매장' } }
  });
}

function customer(overrides = {}) {
  return {
    id: CUSTOMER_ID,
    name: '테스트 고객',
    phone: '01012345678',
    last_visit_at: '2026-06-23T01:00:00Z',
    visit_count: 2,
    kakao_agreed: true,
    marketing_agreed: false,
    created_at: '2026-06-01T01:00:00Z',
    ...overrides
  };
}

test.describe('owner customer detail security', () => {
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

  test('unauthenticated detail requests are rejected', async () => {
    global.fetch = async () => { throw new Error('fetch must not be called'); };
    const res = createResponse();
    await customerHandler(request('GET', CUSTOMER_ID, null, false), res);
    expect(res.statusCode).toBe(401);
  });

  test('detail returns full phone only after session-store ownership filtering', async () => {
    const calls = [];
    global.fetch = async (url) => {
      calls.push(String(url));
      if (String(url).includes('/rpc/owner_session_dashboard')) return sessionResponse();
      if (String(url).includes('/rest/v1/customers?')) return jsonResponse([customer()]);
      return jsonResponse({}, 404);
    };

    const res = createResponse();
    await customerHandler(request('GET', CUSTOMER_ID), res);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).customer.phone).toBe('01012345678');
    const selectUrl = calls.find((url) => url.includes('/rest/v1/customers?'));
    expect(selectUrl).toContain(`id=eq.${CUSTOMER_ID}`);
    expect(selectUrl).toContain(`store_id=eq.${STORE_ID}`);
  });

  test('a customer outside the session store cannot be read', async () => {
    const calls = [];
    global.fetch = async (url) => {
      calls.push(String(url));
      if (String(url).includes('/rpc/owner_session_dashboard')) return sessionResponse();
      return jsonResponse([]);
    };

    const res = createResponse();
    await customerHandler(request('GET', OTHER_CUSTOMER_ID), res);
    expect(res.statusCode).toBe(404);
    const selectUrl = calls.find((url) => url.includes('/rest/v1/customers?'));
    expect(selectUrl).toContain(`id=eq.${OTHER_CUSTOMER_ID}`);
    expect(selectUrl).toContain(`store_id=eq.${STORE_ID}`);
  });

  test('duplicate phone updates are blocked inside the same store', async () => {
    const calls = [];
    global.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method || 'GET' });
      if (String(url).includes('/rpc/owner_session_dashboard')) return sessionResponse();
      if (String(url).includes(`id=eq.${CUSTOMER_ID}`) && String(url).includes('select=id%2Cname') === false) {
        return jsonResponse([customer()]);
      }
      if (String(url).includes('id=neq.')) return jsonResponse([{ id: OTHER_CUSTOMER_ID }]);
      return jsonResponse([customer()]);
    };

    const res = createResponse();
    await customerHandler(request('PATCH', CUSTOMER_ID, {
      name: '수정 고객', phone: '010-9999-8888', kakao_agreed: true, marketing_agreed: true
    }), res);
    expect(res.statusCode).toBe(409);
    expect(calls.some((call) => call.method === 'PATCH')).toBeFalsy();
  });

  test('owned customer updates normalize phone and persist consent fields', async () => {
    const calls = [];
    global.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('/rpc/owner_session_dashboard')) return sessionResponse();
      if (options.method === 'PATCH') {
        const body = JSON.parse(options.body);
        return jsonResponse([customer({ ...body, phone: body.phone })]);
      }
      if (String(url).includes('id=neq.')) return jsonResponse([]);
      return jsonResponse([customer()]);
    };

    const res = createResponse();
    await customerHandler(request('PATCH', CUSTOMER_ID, {
      name: '수정 고객', phone: '010-9999-8888', kakao_agreed: true, marketing_agreed: true
    }), res);
    expect(res.statusCode).toBe(200);
    const patchCall = calls.find((call) => call.options.method === 'PATCH');
    expect(patchCall.url).toContain(`id=eq.${CUSTOMER_ID}`);
    expect(patchCall.url).toContain(`store_id=eq.${STORE_ID}`);
    expect(JSON.parse(patchCall.options.body)).toEqual(expect.objectContaining({
      name: '수정 고객',
      phone: '01099998888',
      kakao_agreed: true,
      marketing_agreed: true,
      consent: true
    }));
  });
});
