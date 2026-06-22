const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.E2E_BASE_URL || 'https://www.revaro.me';
const STORE_ID = process.env.E2E_STORE_ID || 'test01';
const OTHER_STORE_ID = process.env.E2E_OTHER_STORE_ID || 'test02';
const OWNER_PIN = process.env.E2E_OWNER_PIN;
const REGISTRATION_URL = `${BASE_URL}/register?store_id=${STORE_ID}`;

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

async function login(page) {
  await page.goto(`/owner?store_id=${OTHER_STORE_ID}`);
  await page.locator('#lg-store').fill(STORE_ID);
  await page.locator('#lg-pin').fill(OWNER_PIN);
  await page.locator('#loginBtn').click();
  await expect(page.locator('#screen-dash')).toHaveClass(/active/);
}

test.describe('owner QR management', () => {
  test('세션 매장 QR과 버튼, 고객 등록 흐름이 모두 작동한다', async ({ context, page }) => {
    if (!OWNER_PIN) throw new Error('E2E_OWNER_PIN is required');
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE_URL });
    await login(page);

    await expect(page.locator('#qrStoreId')).toHaveText(STORE_ID);
    await expect(page.locator('#qrStoreId')).not.toHaveText(OTHER_STORE_ID);
    await expect(page.locator('#qrRegistrationLink')).toHaveText(REGISTRATION_URL);

    const qr = page.locator('#storeQrImage');
    await expect(qr).toHaveAttribute('src', new RegExp('^/api/owner/qr'));
    await expect.poll(() => qr.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);

    const response = await page.request.get('/api/owner/qr?store_id=' + OTHER_STORE_ID);
    expect(response.ok()).toBeTruthy();
    expect(response.headers()['content-type']).toContain('image/png');
    expect((await response.body()).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');

    await page.locator('#copyQrLinkBtn').click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(REGISTRATION_URL);

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#downloadQrBtn').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`revaro-${STORE_ID}-qr.png`);

    const popupPromise = page.waitForEvent('popup');
    await page.locator('#openRegistrationBtn').click();
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    expect(popup.url()).toBe(REGISTRATION_URL);
    await expect(popup.locator('#v-start')).toHaveClass(/on/);
    await popup.close();

    const phone = `010${String(Date.now()).slice(-8)}`;
    await page.goto(REGISTRATION_URL);
    await page.locator('#phone').fill(phone);
    await page.locator('#startBtn').click();
    await expect(page.locator('#v-register')).toHaveClass(/on/);
    await page.locator('#name').fill('QR관리테스트');
    await page.locator('#privacy-agreed').check();
    await page.locator('#registerBtn').click();
    await expect(page.locator('#v-done-register.on')).toBeVisible();

    await page.goto(REGISTRATION_URL);
    await page.locator('#phone').fill(phone);
    await page.locator('#startBtn').click();
    await expect(page.locator('#v-checkin')).toHaveClass(/on/);
    await page.locator('#checkinBtn').click();
    await expect(page.locator('#v-done-checkin.on')).toBeVisible();

    await page.request.post('/api/owner/logout');
  });
});
