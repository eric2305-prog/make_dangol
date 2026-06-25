const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const storesHandler = require('../api/operator/stores');

const TOKEN = 'c'.repeat(64);
const STORE_A = '00000000-0000-4000-8000-000000000001';
const STORE_B = '00000000-0000-4000-8000-000000000002';
const OWNER_A = '10000000-0000-4000-8000-000000000001';
const OWNER_B = '10000000-0000-4000-8000-000000000002';

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

test.describe('operator store real data API', () => {
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

  test('unauthenticated operator store requests are rejected', async () => {
    global.fetch = async () => { throw new Error('fetch must not be called'); };
    const res = createResponse();
    await storesHandler({ method: 'GET', headers: {} }, res);
    expect(res.statusCode).toBe(401);
  });

  test('authenticated operator sees all stores with customer counts and normalized status', async () => {
    const calls = [];
    global.fetch = async (url) => {
      const textUrl = String(url);
      calls.push(textUrl);
      if (textUrl.includes('/rpc/operator_session_validate')) {
        return jsonResponse({ ok: true, operator_email: 'operator@revaro.me', expires_at: '2026-06-26T10:00:00Z' });
      }
      if (textUrl.includes('/rest/v1/stores?')) {
        return jsonResponse([
          {
            id: STORE_A,
            store_id: 'test01',
            store_code: 'test01',
            name: '테스트 매장',
            phone: '0212345678',
            address: '서울 테스트로 1',
            industry: '헤어샵',
            status: 'active',
            owner_id: OWNER_A,
            created_at: '2026-06-01T00:00:00Z'
          },
          {
            id: STORE_B,
            store_id: 'test02',
            store_code: 'test02',
            name: '중지 매장',
            phone: '0211112222',
            address: '서울 테스트로 2',
            industry: '애견미용',
            status: 'blocked',
            owner_id: OWNER_B,
            created_at: '2026-06-02T00:00:00Z'
          }
        ]);
      }
      if (textUrl.includes('/rest/v1/owners?')) {
        return jsonResponse([
          { id: OWNER_A, name: '김점주', email: 'owner1@example.com' },
          { id: OWNER_B, name: '박점주', email: 'owner2@example.com' }
        ]);
      }
      if (textUrl.includes('/rest/v1/owner_credentials?')) {
        return jsonResponse([{ store_id: STORE_A, pin_updated_at: '2026-06-01T01:00:00Z' }]);
      }
      if (textUrl.includes('/rest/v1/customers?')) {
        return jsonResponse([
          { store_id: STORE_A },
          { store_id: STORE_A },
          { store_id: STORE_B }
        ]);
      }
      return jsonResponse([], 404);
    };

    const res = createResponse();
    await storesHandler({ method: 'GET', headers: { cookie: `__Host-operator_session=${TOKEN}` } }, res);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.metrics).toEqual(expect.objectContaining({
      total_stores: 2,
      active_stores: 1,
      suspended_stores: 1,
      total_customers: 3
    }));
    expect(body.stores).toEqual([
      expect.objectContaining({
        store_id: 'test01',
        owner_name: '김점주',
        status: 'active',
        owner_status: 'active',
        customer_count: 2,
        pin_configured: true
      }),
      expect.objectContaining({
        store_id: 'test02',
        owner_name: '박점주',
        status: 'suspended',
        owner_status: 'suspended',
        customer_count: 1,
        pin_configured: false
      })
    ]);
    expect(res.body).not.toContain('010');
    expect(calls.some((url) => url.includes('/rest/v1/customers?select=store_id'))).toBe(true);
  });

  test('operator console no longer contains sample mock stores or local auth', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'operator', 'index.html'), 'utf8');
    expect(html).not.toContain('demoStores');
    expect(html).not.toContain('라온 헤어 신촌점');
    expect(html).not.toContain('localStorage');
    expect(html).toContain('/api/operator/stores');
    expect(html).toContain('매장별 고객 수');
  });
});
