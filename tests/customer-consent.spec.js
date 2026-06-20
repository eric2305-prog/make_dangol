const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.E2E_BASE_URL || 'https://www.revaro.me';
const STORE_ID = process.env.E2E_STORE_ID || 'test01';

test('고객 동의 상태를 구분해 저장하고 QR 흐름을 유지한다', async ({ page, request }) => {
  const phone = `010${String(Date.now()).slice(-8)}`;
  const rejectedPhone = `010${String(Date.now() + 1).slice(-8)}`;

  const configResponse = await request.get(`${BASE_URL}/api/public-config`);
  expect(configResponse.ok()).toBeTruthy();
  const config = await configResponse.json();
  const rpcUrl = `${config.supabase_url}/rest/v1/rpc`;
  const headers = {
    apikey: config.supabase_anon_key,
    Authorization: `Bearer ${config.supabase_anon_key}`,
    'Content-Type': 'application/json'
  };

  const rejected = await request.post(`${rpcUrl}/qr_customer_register`, {
    headers,
    data: {
      p_store_id: STORE_ID,
      p_phone: rejectedPhone,
      p_name: '필수동의거부',
      p_privacy_agreed: false,
      p_kakao_agreed: true,
      p_marketing_agreed: true
    }
  });
  expect(rejected.ok()).toBeFalsy();

  await page.goto(`${BASE_URL}/register?store_id=${STORE_ID}`);
  await page.locator('#phone').fill(phone);
  await page.locator('#startBtn').click();
  await expect(page.locator('#v-register')).toHaveClass(/on/);
  await expect(page.locator('#consent-store-name')).not.toHaveText('우리 매장');
  await expect(page.locator('.consent-row')).toHaveCount(3);

  await page.locator('#name').fill('동의화면테스트');
  await page.locator('#registerBtn').click();
  await expect(page.locator('#toast')).toContainText('개인정보 수집 및 이용에 동의해 주세요.');
  await expect(page.locator('#v-register')).toHaveClass(/on/);

  await page.locator('#privacy-agreed').check();
  await page.locator('#kakao-agreed').check();
  await page.locator('#marketing-agreed').check();

  const registerRequest = page.waitForRequest((req) => req.url().endsWith('/rpc/qr_customer_register'));
  await page.locator('#registerBtn').click();
  const payload = (await registerRequest).postDataJSON();
  expect(payload.p_privacy_agreed).toBe(true);
  expect(payload.p_kakao_agreed).toBe(true);
  expect(payload.p_marketing_agreed).toBe(true);
  expect(payload.p_consent).toBeUndefined();
  await expect(page.locator('#v-done-register')).toHaveClass(/on/);

  const lookup = await request.post(`${rpcUrl}/qr_customer_lookup`, {
    headers,
    data: { p_store_id: STORE_ID, p_phone: phone }
  });
  expect(lookup.ok()).toBeTruthy();
  const lookupBody = await lookup.json();
  expect(lookupBody.mode).toBe('existing');
  expect(Object.keys(lookupBody).sort()).toEqual(['mode', 'store_name']);

  await page.goto(`${BASE_URL}/register?store_id=${STORE_ID}`);
  await page.locator('#phone').fill(phone);
  await page.locator('#startBtn').click();
  await expect(page.locator('#v-checkin')).toHaveClass(/on/);
  await page.locator('#checkinBtn').click();
  await expect(page.locator('#v-done-checkin')).toHaveClass(/on/);
});
