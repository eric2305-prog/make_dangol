const { test, expect } = require('@playwright/test');

const pendingHandler = require('../api/make/messages/pending');
const resultHandler = require('../api/make/messages/result');

const SECRET = 'make-test-secret';
const MESSAGE_ID = '20000000-0000-4000-8000-000000000001';
const STORE_ID = '00000000-0000-4000-8000-000000000001';
const CUSTOMER_ID = '10000000-0000-4000-8000-000000000001';

function createResponse() {
  return {
    headers: {},
    statusCode: 0,
    body: '',
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
    end(value) {
      this.body = value || '';
    }
  };
}

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

function request(method, body) {
  return {
    method,
    url: '/api/make/messages',
    headers: { authorization: `Bearer ${SECRET}` },
    body
  };
}

function pendingRow(overrides = {}) {
  return {
    id: MESSAGE_ID,
    store_id: STORE_ID,
    customer_id: CUSTOMER_ID,
    message_type: 'return_visit',
    channel: 'kakao',
    body: '민지님, 지난 방문 이후 시간이 조금 지났어요.\n편하실 때 다시 관리 받아보셔도 좋아요.',
    status: 'pending',
    ai_status: 'generated',
    send_status: 'pending',
    provider: null,
    created_at: '2026-07-30T00:00:00Z',
    stores: { store_code: 'test01', name: '테스트 매장' },
    customers: {
      id: CUSTOMER_ID,
      name: '민지',
      phone: '01012345678',
      kakao_agreed: true,
      marketing_agreed: true,
      consent: true
    },
    ...overrides
  };
}

test.describe('Make/NHN send pipeline preparation', () => {
  let originalFetch;
  let selectedMessages;
  let duplicateRows;
  let selectedResultMessage;
  let updatedMessages;
  let insertedLogs;

  test.beforeEach(() => {
    originalFetch = global.fetch;
    selectedMessages = [pendingRow()];
    duplicateRows = [{ id: MESSAGE_ID }];
    selectedResultMessage = {
      id: MESSAGE_ID,
      store_id: STORE_ID,
      customer_id: CUSTOMER_ID,
      channel: 'kakao',
      send_status: 'pending',
      retry_count: 0
    };
    updatedMessages = [];
    insertedLogs = [];

    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
    process.env.MAKE_SEND_SECRET = SECRET;

    global.fetch = async (url, options = {}) => {
      const textUrl = String(url);
      if (textUrl.includes('/rest/v1/messages?') && options.method === 'PATCH') {
        const body = JSON.parse(options.body || '{}');
        updatedMessages.push(body);
        return jsonResponse([{ id: MESSAGE_ID, ...body }]);
      }
      if (textUrl === 'https://example.supabase.co/rest/v1/send_logs') {
        const body = JSON.parse(options.body || '{}');
        insertedLogs.push(body);
        return jsonResponse([{ id: 'send-log-1', ...body }]);
      }
      if (textUrl.includes('/rest/v1/messages?')) {
        if (textUrl.includes('select=id&store_id=')) return jsonResponse(duplicateRows);
        if (textUrl.includes(`id=eq.${MESSAGE_ID}`)) return jsonResponse([selectedResultMessage]);
        return jsonResponse(selectedMessages);
      }
      return jsonResponse({}, 404);
    };
  });

  test.afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.MAKE_SEND_SECRET;
  });

  test('pending API returns only sendable generated pending messages', async () => {
    const res = createResponse();
    await pendingHandler(request('GET'), res);
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.messages).toEqual([expect.objectContaining({
      message_id: MESSAGE_ID,
      store_id: 'test01',
      customer_name: '민지',
      phone: '01012345678',
      provider: 'nhn_cloud',
      body: expect.stringContaining('민지님')
    })]);
    expect(body.skipped_count).toBe(0);
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
  });

  test('pending API skips unsafe or unsendable messages before Make sends', async () => {
    selectedMessages = [
      pendingRow({ id: 'bad-body', body: 'fallback message' }),
      pendingRow({ id: 'bad-phone', customers: { ...pendingRow().customers, phone: '1234' } }),
      pendingRow({ id: 'bad-consent', customers: { ...pendingRow().customers, marketing_agreed: false } })
    ];

    const res = createResponse();
    await pendingHandler(request('GET'), res);
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.messages).toEqual([]);
    expect(body.skipped).toEqual([
      expect.objectContaining({ message_id: 'bad-body', reasons: expect.arrayContaining(['forbidden_body']) }),
      expect.objectContaining({ message_id: 'bad-phone', reasons: expect.arrayContaining(['invalid_phone']) }),
      expect.objectContaining({ message_id: 'bad-consent', reasons: expect.arrayContaining(['consent_required']) })
    ]);
  });

  test('pending API requires Make secret', async () => {
    const res = createResponse();
    await pendingHandler({ method: 'GET', url: '/api/make/messages/pending', headers: {} }, res);
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(401);
    expect(body.code).toBe('unauthorized');
  });

  test('result API records success in messages and send_logs without sending Kakao itself', async () => {
    const res = createResponse();
    await resultHandler(request('POST', {
      message_id: MESSAGE_ID,
      status: 'success',
      provider: 'nhn_cloud',
      provider_message_id: 'nhn-123',
      status_code: 200,
      response_payload: { requestId: 'req-1' }
    }), res);
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(updatedMessages[0]).toEqual(expect.objectContaining({
      status: 'sent',
      send_status: 'sent',
      provider: 'nhn_cloud',
      provider_message_id: 'nhn-123',
      retry_count: 0
    }));
    expect(updatedMessages[0].sent_at).toBeTruthy();
    expect(insertedLogs[0]).toEqual(expect.objectContaining({
      message_id: MESSAGE_ID,
      status: 'success',
      provider: 'nhn_cloud',
      provider_message_id: 'nhn-123',
      status_code: 200,
      response_payload: { requestId: 'req-1' }
    }));
    expect(body.ok).toBe(true);
  });

  test('result API records failure reason and increments retry count', async () => {
    selectedResultMessage.retry_count = 2;

    const res = createResponse();
    await resultHandler(request('POST', {
      message_id: MESSAGE_ID,
      status: 'failed',
      provider: 'nhn_cloud',
      failed_reason: 'NHN rejected template',
      status_code: 400,
      response_payload: { code: 'BAD_TEMPLATE' }
    }), res);

    expect(res.statusCode).toBe(200);
    expect(updatedMessages[0]).toEqual(expect.objectContaining({
      status: 'failed',
      send_status: 'failed',
      failed_reason: 'NHN rejected template',
      retry_count: 3
    }));
    expect(updatedMessages[0].failed_at).toBeTruthy();
    expect(insertedLogs[0]).toEqual(expect.objectContaining({
      status: 'failed',
      error_message: 'NHN rejected template',
      status_code: 400,
      response_payload: { code: 'BAD_TEMPLATE' }
    }));
  });

  test('result API refuses non-pending messages', async () => {
    selectedResultMessage.send_status = 'canceled';

    const res = createResponse();
    await resultHandler(request('POST', {
      message_id: MESSAGE_ID,
      status: 'success'
    }), res);
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(409);
    expect(body.code).toBe('not_pending');
    expect(updatedMessages).toEqual([]);
    expect(insertedLogs).toEqual([]);
  });
});
