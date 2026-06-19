const { test, expect, request } = require('@playwright/test');

const BASE_URL = process.env.E2E_BASE_URL || 'https://www.revaro.me';
const STORE_ID = process.env.E2E_STORE_ID || 'test01';
const OTHER_STORE_ID = process.env.E2E_OTHER_STORE_ID || 'test02';
const OWNER_PIN = process.env.E2E_OWNER_PIN;

const unique = String(Date.now()).slice(-8);
const phone = process.env.E2E_PHONE || `010${unique}`;
const directPhone = process.env.E2E_DIRECT_PHONE || `010${String(Date.now() + 17).slice(-8)}`;
const last4 = phone.slice(-4);
const customerName = process.env.E2E_CUSTOMER_NAME || `테스트${unique.slice(-5)}`;
const directCustomerName = process.env.E2E_DIRECT_CUSTOMER_NAME || `보안테스트${unique.slice(-5)}`;

let api;
let ownerApi;
let supabaseUrl;
let supabaseAnonKey;

async function rpc(name, body) {
  const res = await api.post(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      'Content-Type': 'application/json'
    },
    data: body
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    throw new Error(`RPC ${name} returned non-json`);
  }
  if (!res.ok()) {
    const message = data && (data.message || data.error_description || data.hint);
    throw new Error(`RPC ${name} failed: ${message || res.status()}`);
  }
  return data;
}

async function ownerSnapshot() {
  const res = await ownerApi.get('/api/owner/dashboard');
  expect(res.ok()).toBeTruthy();
  const data = await res.json();
  expect(data.ok).toBe(true);
  return data.snapshot;
}

function expectPublicResponse(data, allowedKeys) {
  expect(Object.keys(data).sort()).toEqual([...allowedKeys].sort());
  const serialized = JSON.stringify(data).toLowerCase();
  for (const forbidden of ['phone', 'consent', 'customer_id', 'visit_count', 'name']) {
    expect(serialized).not.toContain(`\"${forbidden}\"`);
  }
}

test.describe.serial('Secure QR registration and revisit loop', () => {
  test.beforeAll(async () => {
    if (!OWNER_PIN) throw new Error('E2E_OWNER_PIN is required');
    api = await request.newContext();
    const configRes = await api.get(`${BASE_URL}/api/public-config`);
    expect(configRes.ok()).toBeTruthy();
    const config = await configRes.json();
    supabaseUrl = config.supabase_url;
    supabaseAnonKey = config.supabase_anon_key;

    ownerApi = await request.newContext({ baseURL: BASE_URL });
    const login = await ownerApi.post('/api/owner/login', {
      data: { store_id: STORE_ID, pin: OWNER_PIN }
    });
    expect(login.ok()).toBeTruthy();
  });

  test.afterAll(async () => {
    if (ownerApi) {
      await ownerApi.post('/api/owner/logout');
      await ownerApi.dispose();
    }
    if (api) await api.dispose();
  });

  test('매장 정보는 개인정보 없이 조회된다', async () => {
    const store = await rpc('qr_customer_lookup', { p_store_id: STORE_ID, p_phone: null });
    expect(store.mode).toBe('store');
    expect(store.store_name).toBeTruthy();
    expectPublicResponse(store, ['mode', 'store_name']);
  });

  test('신규 고객 등록 후 공개 응답에 개인정보가 없다', async ({ page }) => {
    await page.goto(`${BASE_URL}/register?store_id=${STORE_ID}`);
    await page.locator('#phone').fill(phone);
    await page.locator('#startBtn').click();
    await expect(page.locator('#v-register')).toHaveClass(/on/);
    await page.locator('#name').fill(customerName);
    await page.locator('#registerBtn').click();
    await expect(page.locator('#v-done-register')).toHaveClass(/on/);

    const lookup = await rpc('qr_customer_lookup', { p_store_id: STORE_ID, p_phone: phone });
    expect(lookup.mode).toBe('existing');
    expectPublicResponse(lookup, ['mode', 'store_name']);
  });

  test('6시간 이내 재체크인은 추가 방문을 만들지 않는다', async ({ page }) => {
    await page.goto(`${BASE_URL}/register?store_id=${STORE_ID}`);
    await page.locator('#phone').fill(phone);
    await page.locator('#startBtn').click();
    await expect(page.locator('#v-checkin')).toHaveClass(/on/);
    await expect(page.locator('#ci-last-row')).toBeHidden();
    await expect(page.locator('#ci-count-row')).toBeHidden();
    await page.locator('#checkinBtn').click();
    await expect(page.locator('#v-done-checkin')).toHaveClass(/on/);
    await expect(page.locator('#dc-title')).toContainText('이미 방문이 기록됐어요');

    const snapshot = await ownerSnapshot();
    const customer = (snapshot.customers || []).find((item) => item.name === customerName);
    expect(customer).toBeTruthy();
    expect(customer.visit_count).toBe(1);
    expect(customer.phone_masked).toContain(last4);
  });

  test('잘못된 store_id는 등록을 막는다', async ({ page }) => {
    await page.goto(`${BASE_URL}/register?store_id=wrongstore999`);
    await expect(page.locator('#store-name')).toContainText('매장을 찾을 수 없어요');
    await page.locator('#phone').fill('01099998888');
    await expect(page.locator('#startBtn')).toBeDisabled();
  });

  test('다른 store_id에서는 테스트 고객이 조회되지 않는다', async () => {
    const other = await rpc('qr_customer_lookup', { p_store_id: OTHER_STORE_ID, p_phone: phone });
    expect(other.mode).toBe('new');
    expectPublicResponse(other, ['mode', 'store_name']);
  });

  test('같은 번호를 3번 직접 등록해도 방문 수는 1회다', async () => {
    const before = await ownerSnapshot();
    const beforeTotal = Number(before.metrics.total_customers || 0);
    const dashed = directPhone.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
    const spaced = `  ${directPhone}  `;

    const first = await rpc('qr_customer_register', {
      p_store_id: STORE_ID,
      p_phone: directPhone,
      p_name: directCustomerName,
      p_consent: true
    });
    expect(first.mode).toBe('registered');
    expectPublicResponse(first, ['mode', 'store_name']);

    const second = await rpc('qr_customer_register', {
      p_store_id: STORE_ID,
      p_phone: dashed,
      p_name: `${directCustomerName}2`,
      p_consent: true
    });
    expect(second.mode).toBe('already_checked_in');
    expectPublicResponse(second, ['mode', 'store_name']);

    const third = await rpc('qr_customer_register', {
      p_store_id: STORE_ID,
      p_phone: spaced,
      p_name: `${directCustomerName}3`,
      p_consent: true
    });
    expect(third.mode).toBe('already_checked_in');
    expectPublicResponse(third, ['mode', 'store_name']);

    const after = await ownerSnapshot();
    expect(Number(after.metrics.total_customers || 0)).toBe(beforeTotal + 1);
    const customer = (after.customers || []).find((item) => item.name === directCustomerName);
    expect(customer).toBeTruthy();
    expect(customer.visit_count).toBe(1);
  });
});
