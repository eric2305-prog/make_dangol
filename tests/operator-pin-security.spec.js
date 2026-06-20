const fs = require('node:fs');
const path = require('node:path');
const { test, expect, request } = require('@playwright/test');

const BASE_URL = process.env.E2E_BASE_URL || 'https://www.revaro.me';
const OPERATOR_EMAIL = process.env.E2E_OPERATOR_EMAIL;
const OPERATOR_PASSWORD = process.env.E2E_OPERATOR_PASSWORD;
const STORE_ID = process.env.E2E_OPERATOR_STORE_ID || 'test02';
const ORIGIN = new URL(BASE_URL).origin;

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test.describe.serial('operator PIN issuance security', () => {
  test('운영자 인증 없이는 PIN을 발급할 수 없다', async () => {
    const api = await request.newContext({ baseURL: BASE_URL });
    const response = await api.post('/api/operator/pin/issue', {
      headers: { Origin: ORIGIN },
      data: { store_id: STORE_ID, reason: 'reissue' }
    });
    expect(response.status()).toBe(401);
    await api.dispose();
  });

  test('점주 쿠키는 운영자 권한으로 인정되지 않는다', async () => {
    const api = await request.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: {
        Origin: ORIGIN,
        Cookie: '__Host-owner_session=' + 'a'.repeat(64)
      }
    });
    const response = await api.post('/api/operator/pin/issue', {
      data: { store_id: STORE_ID, reason: 'reissue' }
    });
    expect(response.status()).toBe(401);
    await api.dispose();
  });

  test('정상 운영자는 PIN을 재발급하고 기존 PIN과 세션을 만료시킨다', async () => {
    if (!OPERATOR_EMAIL || !OPERATOR_PASSWORD) {
      throw new Error('E2E operator credentials are required');
    }

    const operator = await request.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { Origin: ORIGIN }
    });
    const login = await operator.post('/api/operator/login', {
      data: { email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD }
    });
    expect(login.status(), 'operator login status').toBe(200);
    const loginBody = await login.json();
    expect(loginBody.ok).toBe(true);
    expect(loginBody.token).toBeUndefined();
    const cookie = login.headers()['set-cookie'] || '';
    expect(cookie).toContain('__Host-operator_session=');
    expect(cookie.toLowerCase()).toContain('httponly');
    expect(cookie.toLowerCase()).toContain('secure');
    expect(cookie.toLowerCase()).toContain('samesite=strict');

    const storesResponse = await operator.get('/api/operator/stores');
    expect(storesResponse.ok()).toBeTruthy();
    const storesBody = await storesResponse.json();
    const store = (storesBody.stores || []).find((item) => item.store_id === STORE_ID);
    expect(store).toBeTruthy();
    expect(store.pin).toBeUndefined();
    expect(store.pin_hash).toBeUndefined();

    const firstIssue = await operator.post('/api/operator/pin/issue', {
      data: { store_id: STORE_ID, reason: 'reissue' }
    });
    expect(firstIssue.ok()).toBeTruthy();
    const firstBody = await firstIssue.json();
    expect(firstBody.ok).toBe(true);
    expect(/^[0-9]{6}$/.test(firstBody.pin)).toBe(true);
    const firstPin = firstBody.pin;

    const ownerSession = await request.newContext({ baseURL: BASE_URL });
    const firstOwnerLogin = await ownerSession.post('/api/owner/login', {
      data: { store_id: STORE_ID, pin: firstPin }
    });
    expect(firstOwnerLogin.ok()).toBeTruthy();
    expect((await ownerSession.get('/api/owner/dashboard')).ok()).toBeTruthy();

    const secondIssue = await operator.post('/api/operator/pin/issue', {
      data: { store_id: STORE_ID, reason: 'reissue' }
    });
    expect(secondIssue.ok()).toBeTruthy();
    const secondBody = await secondIssue.json();
    expect(/^[0-9]{6}$/.test(secondBody.pin)).toBe(true);
    expect(secondBody.pin === firstPin).toBe(false);
    const secondPin = secondBody.pin;

    const oldPinAttempt = await request.newContext({ baseURL: BASE_URL });
    const oldPinLogin = await oldPinAttempt.post('/api/owner/login', {
      data: { store_id: STORE_ID, pin: firstPin }
    });
    expect(oldPinLogin.status()).toBe(401);

    const newPinAttempt = await request.newContext({ baseURL: BASE_URL });
    const newPinLogin = await newPinAttempt.post('/api/owner/login', {
      data: { store_id: STORE_ID, pin: secondPin }
    });
    expect(newPinLogin.ok()).toBeTruthy();

    const expiredOwnerSession = await ownerSession.get('/api/owner/dashboard');
    expect(expiredOwnerSession.status()).toBe(401);

    await operator.post('/api/operator/logout');
    const afterLogout = await operator.post('/api/operator/pin/issue', {
      data: { store_id: STORE_ID, reason: 'reissue' }
    });
    expect(afterLogout.status()).toBe(401);

    await Promise.all([
      operator.dispose(),
      ownerSession.dispose(),
      oldPinAttempt.dispose(),
      newPinAttempt.dispose()
    ]);
  });

  test('운영관리자 공개 코드에 mock PIN과 localStorage 인증이 없다', async () => {
    const root = path.resolve(__dirname, '..');
    const operatorCode = [
      fs.readFileSync(path.join(root, 'operator', 'index.html'), 'utf8'),
      fs.readFileSync(path.join(root, 'operator', 'login.html'), 'utf8')
    ].join('\n');
    expect(operatorCode.includes('localStorage')).toBe(false);
    expect(operatorCode.includes('revaroOperatorSession')).toBe(false);
    expect(operatorCode.includes('otp.code')).toBe(false);
    expect(/code\s*:\s*['"][0-9]{6}['"]/.test(operatorCode)).toBe(false);

    const apiCode = fs.readFileSync(
      path.join(root, 'api', 'operator', 'pin', 'issue.js'),
      'utf8'
    );
    expect(apiCode.includes('console.log')).toBe(false);
    expect(apiCode.includes('service_role')).toBe(false);
  });
});
