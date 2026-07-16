const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const storesHandler = require('../api/operator/stores');

const TOKEN = 'c'.repeat(64);

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

  test('authenticated operator sees all stores from the operator RPC', async () => {
    const calls = [];
    global.fetch = async (url) => {
      const textUrl = String(url);
      calls.push(textUrl);
      if (textUrl.includes('/rpc/operator_session_validate')) {
        return jsonResponse({
          ok: true,
          operator_email: 'operator@revaro.me',
          expires_at: '2026-06-26T10:00:00Z'
        });
      }
      if (textUrl.includes('/rpc/operator_list_stores')) {
        return jsonResponse({
          ok: true,
          stores: [
            {
              store_uuid: '00000000-0000-4000-8000-000000000001',
              store_id: 'test01',
              store_name: 'Test Store',
              owner_name: 'Owner One',
              owner_email: 'owner1@example.com',
              phone: '0212345678',
              address: 'Seoul Test Road 1',
              industry: 'hair',
              status: 'active',
              customer_count: 2,
              created_at: '2026-06-01T00:00:00Z',
              pin_configured: true,
              pin_updated_at: '2026-06-01T01:00:00Z'
            },
            {
              store_uuid: '00000000-0000-4000-8000-000000000002',
              store_id: 'test02',
              store_name: 'Blocked Store',
              owner_name: 'Owner Two',
              owner_email: 'owner2@example.com',
              phone: '0211112222',
              address: 'Seoul Test Road 2',
              industry: 'pet',
              status: 'blocked',
              customer_count: 1,
              created_at: '2026-06-02T00:00:00Z',
              pin_configured: false
            }
          ]
        });
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
        owner_name: 'Owner One',
        status: 'active',
        owner_status: 'active',
        customer_count: 2,
        pin_configured: true
      }),
      expect.objectContaining({
        store_id: 'test02',
        owner_name: 'Owner Two',
        status: 'suspended',
        owner_status: 'suspended',
        customer_count: 1,
        pin_configured: false
      })
    ]);
    expect(res.body).not.toContain('010');
    expect(calls.some((url) => url.includes('/rpc/operator_list_stores'))).toBe(true);
  });

  test('operator console no longer contains sample mock stores or local auth', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'operator', 'index.html'), 'utf8');
    expect(html).not.toContain('demoStores');
    expect(html).not.toContain('localStorage');
    expect(html).toContain('/api/operator/stores');
  });
});
