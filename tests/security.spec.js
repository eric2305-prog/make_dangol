const { test, expect, request } = require('@playwright/test');

const BASE_URL = process.env.E2E_BASE_URL || 'https://www.revaro.me';
const STORE_ID = process.env.E2E_STORE_ID || 'test01';
const OTHER_STORE_ID = process.env.E2E_OTHER_STORE_ID || 'test02';
const OWNER_PIN = process.env.E2E_OWNER_PIN;

let api;
let supabaseUrl;
let supabaseAnonKey;

test.describe.serial('P0 owner privacy security', () => {
  test.beforeAll(async () => {
    if (!OWNER_PIN) throw new Error('E2E_OWNER_PIN is required');
    api = await request.newContext({ baseURL: BASE_URL });
    const configRes = await api.get('/api/public-config');
    expect(configRes.ok()).toBeTruthy();
    const config = await configRes.json();
    supabaseUrl = config.supabase_url;
    supabaseAnonKey = config.supabase_anon_key;
  });

  test.afterAll(async () => {
    if (api) await api.dispose();
  });

  test('anon은 점주 대시보드 RPC를 직접 실행할 수 없다', async () => {
    const res = await api.post(`${supabaseUrl}/rest/v1/rpc/qr_owner_dashboard_snapshot`, {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json'
      },
      data: { p_store_id: STORE_ID }
    });
    expect([401, 403, 404]).toContain(res.status());
  });

  test('세션 없이 점주 API를 호출하면 401이다', async () => {
    const isolated = await request.newContext({ baseURL: BASE_URL });
    const res = await isolated.get('/api/owner/dashboard');
    expect(res.status()).toBe(401);
    await isolated.dispose();
  });

  test('잘못된 PIN은 구체적인 계정 정보를 노출하지 않는다', async () => {
    const isolated = await request.newContext({ baseURL: BASE_URL });
    const res = await isolated.post('/api/owner/login', {
      data: { store_id: STORE_ID, pin: '000000' }
    });
    expect(res.status()).toBe(401);
    const data = await res.json();
    expect(data.message).toBe('매장코드 또는 PIN을 확인해 주세요.');
    await isolated.dispose();
  });

  test('정상 로그인은 HttpOnly 보안 쿠키만 발급한다', async () => {
    const owner = await request.newContext({ baseURL: BASE_URL });
    const login = await owner.post('/api/owner/login', {
      data: { store_id: STORE_ID, pin: OWNER_PIN }
    });
    expect(login.ok()).toBeTruthy();
    const body = await login.json();
    expect(body.ok).toBe(true);
    expect(body.token).toBeUndefined();

    const cookie = login.headers()['set-cookie'] || '';
    expect(cookie).toContain('__Host-owner_session=');
    expect(cookie.toLowerCase()).toContain('httponly');
    expect(cookie.toLowerCase()).toContain('secure');
    expect(cookie.toLowerCase()).toContain('samesite=strict');
    expect(cookie.toLowerCase()).toContain('max-age=1800');

    const own = await owner.get(`/api/owner/dashboard?store_id=${OTHER_STORE_ID}`);
    expect(own.ok()).toBeTruthy();
    const ownData = await own.json();
    expect(ownData.snapshot.store.store_id || ownData.snapshot.store.store_code).toBe(STORE_ID);

    const logout = await owner.post('/api/owner/logout');
    expect(logout.ok()).toBeTruthy();
    const afterLogout = await owner.get('/api/owner/dashboard');
    expect(afterLogout.status()).toBe(401);
    await owner.dispose();
  });
});
