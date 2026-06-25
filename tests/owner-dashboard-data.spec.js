const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const dashboardHandler = require('../api/owner/dashboard');

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
    async json() {
      return body;
    }
  };
}

function createResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(value) {
      this.body = value || '';
    }
  };
}

test.describe('owner dashboard real data', () => {
  const storeUuid = '00000000-0000-4000-8000-000000000001';
  const token = 'a'.repeat(64);
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

  test('session store scopes customers and visits, then masks private data', async () => {
    const requestedUrls = [];
    global.fetch = async (url) => {
      requestedUrls.push(String(url));
      if (String(url).includes('/rpc/owner_session_dashboard')) {
        return jsonResponse({
          ok: true,
          expires_at: '2026-06-23T10:00:00Z',
          snapshot: {
            store: { id: storeUuid, store_code: 'test01', name: '테스트 매장' },
            metrics: { total_customers: 1, recommended_customers: 0 },
            customers: []
          }
        });
      }
      if (String(url).includes('/rest/v1/customers?')) {
        return jsonResponse([{
          id: '10000000-0000-4000-8000-000000000001',
          name: '최근고객',
          phone: '01012345678',
          created_at: '2026-06-23T01:00:00Z',
          last_visit_at: '2026-06-23T01:00:00Z',
          visit_count: 2
        }]);
      }
      if (String(url).includes('/rest/v1/settings?')) {
        return jsonResponse([{ reservation_url: '', revisit_cycle_days: 30, default_message: '기본 문구' }]);
      }
      if (String(url).includes('/rest/v1/visits?')) {
        return jsonResponse([
          { customer_id: '10000000-0000-4000-8000-000000000001' },
          { customer_id: '10000000-0000-4000-8000-000000000001' }
        ]);
      }
      return jsonResponse({}, 404);
    };

    const req = { method: 'GET', headers: { cookie: `__Host-owner_session=${token}` } };
    const res = createResponse();
    await dashboardHandler(req, res);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.recent_customers).toEqual([expect.objectContaining({
      name: '최근고객',
      phone_masked: '010-****-5678',
      visit_count: 2
    })]);
    expect(body.customer_list).toEqual([expect.objectContaining({
      name: '최근고객',
      phone_masked: '010-****-5678',
      last_visit_at: '2026-06-23T01:00:00Z',
      visit_count: 2,
      kakao_agreed: false,
      marketing_agreed: false
    })]);
    expect(body.customer_list[0]).not.toHaveProperty('phone');
    expect(res.body).not.toContain('01012345678');
    expect(requestedUrls.find((url) => url.includes('/customers?'))).toContain(`store_id=eq.${storeUuid}`);
    expect(requestedUrls.find((url) => url.includes('/customers?'))).toContain('order=created_at.desc');
    expect(requestedUrls.find((url) => url.includes('/visits?'))).toContain(`store_id=eq.${storeUuid}`);
  });

  test('empty customers return an empty recent list without querying visits', async () => {
    const requestedUrls = [];
    global.fetch = async (url) => {
      requestedUrls.push(String(url));
      if (String(url).includes('/rpc/owner_session_dashboard')) {
        return jsonResponse({
          ok: true,
          snapshot: {
            store: { id: storeUuid, store_code: 'test01', name: '빈 매장' },
            metrics: { total_customers: 0, recommended_customers: 0 },
            customers: []
          }
        });
      }
      if (String(url).includes('/rest/v1/settings?')) return jsonResponse([]);
      if (String(url).includes('/rest/v1/customers?')) return jsonResponse([]);
      return jsonResponse({}, 404);
    };

    const req = { method: 'GET', headers: { cookie: `__Host-owner_session=${token}` } };
    const res = createResponse();
    await dashboardHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).recent_customers).toEqual([]);
    expect(JSON.parse(res.body).customer_list).toEqual([]);
    expect(requestedUrls.some((url) => url.includes('/rest/v1/visits?'))).toBeFalsy();
  });

  test('owner home contains real-data targets and empty states', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'owner.html'), 'utf8');
    expect(html).toContain('id="owner-total-count">0</span>');
    expect(html).toContain('id="recentCustomerRows"');
    expect(html).toContain('id="customerListRows"');
    expect(html).toContain('아직 등록된 고객이 없어요.');
    expect(html).toContain('아직 재방문 관리 대상 고객이 없어요.');
    expect(html).not.toContain('라온 헤어 신촌점');
    expect(html).toContain('id="ownerStoreNameTitle"');
    expect(html).toContain('id="ownerStoreNameSide"');
    expect(html).toContain('<th>적용 기준</th>');
  });

  test('real data cards and lists fit desktop and mobile viewports', async ({ page }) => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'owner.html'), 'utf8');
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      document.querySelectorAll('.screen').forEach((screen) => screen.classList.remove('active'));
      document.querySelector('#screen-dash').classList.add('active');
      setText('ownerStoreNameTitle', '테스트 매장');
      setText('ownerStoreNameSide', '테스트 매장');
      setText('set-name', '테스트 매장');
      setText('owner-total-count', 12);
      setText('owner-recommend-count', 2);
      renderRecentCustomers([{
        id: 'customer-1',
        name: '최근고객',
        phone_masked: '010-****-5678',
        created_at: '2026-06-23T01:00:00Z',
        visit_count: 2
      }]);
      renderCustomerList([{
        id: 'customer-1',
        name: '최근고객',
        phone_masked: '010-****-5678',
        last_visit_at: '2026-06-23T01:00:00Z',
        visit_count: 2,
        kakao_agreed: true,
        marketing_agreed: false
      }]);
      renderOwnerCustomers([{
        id: 'customer-1',
        name: '최근고객',
        phone_masked: '010-****-5678',
        visit_count: 2,
        last_visit_days: 31,
        expected_revisit_label: '지남',
        revisit_basis_label: '실제 방문 간격',
        status_kind: 'due',
        status_label: '지금 안내'
      }], 2);
    });

    await expect(page.locator('#owner-total-count')).toHaveText('12');
    await expect(page.locator('#ownerStoreNameTitle')).toHaveText('테스트 매장');
    await expect(page.locator('#ownerStoreNameSide')).toHaveText('테스트 매장');
    await expect(page.locator('#set-name')).toHaveText('테스트 매장');
    await expect(page.locator('#recentCustomerRows')).toContainText('최근고객');
    await expect(page.locator('#customerListRows')).toContainText('최근고객');
    await expect(page.locator('#customerListRows')).toContainText('5678');
    await expect(page.locator('#customerListRows')).not.toContainText('01012345678');
    await expect(page.locator('#visitRows')).toContainText('지금 안내');
    await expect(page.locator('#visitRows')).toContainText('실제 방문 간격');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();

    await page.evaluate(() => {
      activeCustomerId = '10000000-0000-4000-8000-000000000001';
      renderCustomerDetail({
        id: activeCustomerId,
        name: '최근고객',
        phone: '01012345678',
        last_visit_at: '2026-06-23T01:00:00Z',
        visit_count: 2,
        kakao_agreed: true,
        marketing_agreed: false,
        created_at: '2026-06-01T01:00:00Z'
      });
      document.querySelector('#editOverlay').classList.add('open');
    });
    await expect(page.locator('#detailCustomerPhone')).toHaveText('010-1234-5678');
    await expect(page.locator('#detailKakaoConsent')).toHaveText('동의');
    await expect(page.locator('#detailMarketingConsent')).toHaveText('미동의');
    await page.getByRole('button', { name: '고객 정보 수정', exact: true }).click();
    expect(await page.locator('#ed-name').inputValue()).toBe('최근고객');
    expect(await page.locator('#ed-phone').inputValue()).toBe('01012345678');
    await page.evaluate(() => cancelCustomerEdit());

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => toggleSide(false));
    await expect(page.locator('#side')).not.toHaveClass(/open/);
    await expect.poll(async () => {
      var box = await page.locator('#side').boundingBox();
      return box.x + box.width;
    }).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    const modalBox = await page.locator('#editOverlay .modal').boundingBox();
    expect(Math.abs((modalBox.y + modalBox.height) - 844)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: 'test-results/owner-customer-detail-mobile.png', fullPage: false });
    await page.evaluate(() => closeEdit());
    await page.screenshot({ path: 'test-results/owner-dashboard-mobile.png', fullPage: true });
  });
});
