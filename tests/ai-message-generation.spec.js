const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const generateHandler = require('../api/owner/messages/generate');
const ownerActionHandler = require('../api/owner/messages/action');
const ownerMessagesHandler = require('../api/owner/messages');
const operatorMessagesHandler = require('../api/operator/messages');
const operatorActionHandler = require('../api/operator/messages-action');
const { normalizeGeneratedMessage } = require('../server/ai-message');

const OWNER_TOKEN = 'a'.repeat(64);
const OPERATOR_TOKEN = 'b'.repeat(64);
const STORE_ID = '00000000-0000-4000-8000-000000000001';
const CUSTOMER_ID = '10000000-0000-4000-8000-000000000001';

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

function ownerRequest(body = { customer_id: CUSTOMER_ID }) {
  return {
    method: 'POST',
    headers: { cookie: `__Host-owner_session=${OWNER_TOKEN}` },
    body
  };
}

test.describe('AI customer message generation', () => {
  let originalFetch;
  let insertedMessages;
  let openAiRequests;
  let customerConsent;
  let duplicateRows;
  let openAiStatus;
  let openAiBody;
  let selectedMessage;
  let updatedMessages;

  test.beforeEach(() => {
    originalFetch = global.fetch;
    insertedMessages = [];
    openAiRequests = [];
    customerConsent = true;
    duplicateRows = [];
    openAiStatus = 200;
    updatedMessages = [];
    selectedMessage = {
      id: '20000000-0000-4000-8000-000000000001',
      store_id: STORE_ID,
      customer_id: CUSTOMER_ID,
      message_type: 'return_visit',
      body: '민지님, 지난 방문 이후 시간이 조금 지났어요.',
      status: 'draft',
      ai_status: 'generated',
      send_status: 'draft',
      customers: {
        kakao_agreed: true,
        marketing_agreed: true,
        consent: true,
        name: '민지',
        last_visit_at: '2026-06-01T01:00:00Z',
        visit_count: 3
      }
    };
    openAiBody = {
      output_text: '민지님, 지난 방문 이후 시간이 조금 지났어요.\n편하신 시간에 다시 관리 받아보셔도 좋을 시기라 안내드려요.\n예약은 https://booking.example 에서 확인하실 수 있습니다.',
      model: 'test-openai-model'
    };
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-service-key';
    process.env.OPENAI_API_KEY = 'sk-test-secret-value';
    delete process.env.OPENAI_MESSAGE_MODEL;

    global.fetch = async (url, options = {}) => {
      const textUrl = String(url);
      if (textUrl.includes('/rpc/owner_session_dashboard')) {
        return jsonResponse({
          ok: true,
          snapshot: {
            store: {
              id: STORE_ID,
              store_code: 'test01',
              name: '테스트헤어',
              booking_url: 'https://booking.example'
            }
          }
        });
      }
      if (textUrl.includes('/rpc/operator_session_validate')) {
        return jsonResponse({ ok: true, operator_email: 'operator@revaro.me' });
      }
      if (textUrl.includes('/rest/v1/customers?')) {
        return jsonResponse([{
          id: CUSTOMER_ID,
          name: '민지',
          phone: '01012345678',
          last_visit_at: '2026-06-01T01:00:00Z',
          visit_count: 3,
          kakao_agreed: customerConsent,
          marketing_agreed: customerConsent,
          consent: customerConsent
        }]);
      }
      if (textUrl.startsWith('https://example.supabase.co/rest/v1/messages?') && options.method === 'PATCH') {
        const row = { ...selectedMessage, ...JSON.parse(options.body) };
        updatedMessages.push(row);
        return jsonResponse([row]);
      }
      if (textUrl.includes('/rest/v1/messages?')) {
        if (textUrl.includes('id=eq.20000000-0000-4000-8000-000000000001')) {
          return jsonResponse([selectedMessage]);
        }
        return jsonResponse(duplicateRows);
      }
      if (textUrl.includes('/rest/v1/settings?')) {
        return jsonResponse([{ reservation_url: 'https://booking.example', revisit_cycle_days: 30 }]);
      }
      if (textUrl === 'https://api.openai.com/v1/responses') {
        openAiRequests.push(JSON.parse(options.body));
        return jsonResponse(openAiBody, openAiStatus);
      }
      if (textUrl === 'https://example.supabase.co/rest/v1/messages') {
        const row = { id: `message-${insertedMessages.length + 1}`, ...JSON.parse(options.body) };
        insertedMessages.push(row);
        return jsonResponse([row], 201);
      }
      return jsonResponse({}, 404);
    };
  });

  test.afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MESSAGE_MODEL;
  });

  test('generates a real customer message as draft for review before pending approval', async () => {
    const res = createResponse();
    await generateHandler(ownerRequest(), res);

    expect(res.statusCode).toBe(201);
    expect(openAiRequests).toHaveLength(1);
    expect(JSON.stringify(openAiRequests[0])).not.toContain('01012345678');
    expect(openAiRequests[0].model).toBe('gpt-4.1-mini');
    expect(insertedMessages).toEqual([expect.objectContaining({
      store_id: STORE_ID,
      customer_id: CUSTOMER_ID,
      body: expect.stringContaining('민지님'),
      ai_status: 'generated',
      send_status: 'draft',
      status: 'draft',
      ai_model: 'test-openai-model'
    })]);
    expect(insertedMessages[0].body).not.toMatch(/Revaro default message|test message|fallback message|dummy message|sample message|lorem ipsum/i);
    expect(res.body).not.toContain('sk-test-secret-value');
  });

  test('approval is the only path that changes send_status to pending', async () => {
    const res = createResponse();
    await ownerActionHandler(ownerRequest({
      message_id: selectedMessage.id,
      action: 'approve'
    }), res);

    expect(res.statusCode).toBe(200);
    expect(updatedMessages).toEqual([expect.objectContaining({
      status: 'pending',
      send_status: 'pending'
    })]);
  });

  test('cancel changes send_status to canceled', async () => {
    const res = createResponse();
    await ownerActionHandler(ownerRequest({
      message_id: selectedMessage.id,
      action: 'cancel'
    }), res);

    expect(res.statusCode).toBe(200);
    expect(updatedMessages).toEqual([expect.objectContaining({
      status: 'canceled',
      send_status: 'canceled'
    })]);
  });

  test('regenerate creates a new draft and cancels the previous draft after success', async () => {
    const res = createResponse();
    await generateHandler(ownerRequest({
      message_id: selectedMessage.id
    }), res);

    expect(res.statusCode).toBe(201);
    expect(insertedMessages).toEqual([expect.objectContaining({
      ai_status: 'generated',
      send_status: 'draft',
      status: 'draft'
    })]);
    expect(updatedMessages).toEqual([expect.objectContaining({
      status: 'canceled',
      send_status: 'canceled'
    })]);
  });

  test('blocks customers without consent before OpenAI or pending insert', async () => {
    customerConsent = false;
    const res = createResponse();
    await generateHandler(ownerRequest(), res);

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).code).toBe('consent_required');
    expect(openAiRequests).toHaveLength(0);
    expect(insertedMessages).toHaveLength(0);
  });

  test('approval blocks messages when customer consent is missing', async () => {
    selectedMessage.customers.kakao_agreed = false;
    const res = createResponse();
    await ownerActionHandler(ownerRequest({
      message_id: selectedMessage.id,
      action: 'approve'
    }), res);

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).code).toBe('consent_required');
    expect(updatedMessages).toHaveLength(0);
  });

  test('approval blocks fallback and test-like copy', async () => {
    selectedMessage.body = 'fallback message';
    const res = createResponse();
    await ownerActionHandler(ownerRequest({
      message_id: selectedMessage.id,
      action: 'approve'
    }), res);

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).code).toBe('blocked_message_body');
    expect(updatedMessages).toHaveLength(0);
  });

  test('blocks duplicate pending return-visit messages', async () => {
    duplicateRows = [{ id: 'existing-message', ai_status: 'generated', send_status: 'pending' }];
    const res = createResponse();
    await generateHandler(ownerRequest(), res);

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).code).toBe('duplicate_pending');
    expect(openAiRequests).toHaveLength(0);
    expect(insertedMessages).toHaveLength(0);
  });

  test('does not create pending when OpenAI fails', async () => {
    openAiStatus = 500;
    openAiBody = { error: { message: 'model unavailable' } };

    const res = createResponse();
    await generateHandler(ownerRequest(), res);

    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).message).toBe('AI 문구 생성 실패');
    expect(insertedMessages).toEqual([expect.objectContaining({
      body: null,
      ai_status: 'failed',
      send_status: 'draft',
      status: 'failed'
    })]);
    expect(insertedMessages).not.toEqual([expect.objectContaining({ send_status: 'pending' })]);
  });

  test('rejects fallback and test-like generated copy', async () => {
    openAiBody = { output_text: 'Revaro default message test message', model: 'test-openai-model' };
    const res = createResponse();
    await generateHandler(ownerRequest(), res);

    expect(res.statusCode).toBe(502);
    expect(insertedMessages).toEqual([expect.objectContaining({
      body: null,
      ai_status: 'failed',
      send_status: 'draft'
    })]);
  });

  test('forbidden message text helper blocks unsafe placeholders', () => {
    for (const value of [
      'Revaro default message 123',
      'test message',
      'fallback message',
      'dummy message',
      'sample message',
      'lorem ipsum'
    ]) {
      expect(normalizeGeneratedMessage(value)).toBe('');
    }
  });

  test('operator can see actual AI messages and failed states', async () => {
    global.fetch = async (url) => {
      const textUrl = String(url);
      if (textUrl.includes('/rpc/operator_session_validate')) {
        return jsonResponse({ ok: true, operator_email: 'operator@revaro.me' });
      }
      if (textUrl.includes('/rest/v1/messages?')) {
        return jsonResponse([
          {
            id: 'message-1',
            message_type: 'return_visit',
            body: '민지님, 지난 방문 이후 시간이 조금 지났어요.',
            status: 'draft',
            ai_status: 'generated',
            send_status: 'draft',
            error_message: null,
            created_at: '2026-07-21T00:00:00Z',
            stores: { store_code: 'test01', name: '테스트헤어', booking_url: 'https://booking.example' },
            customers: { name: '민지', last_visit_at: '2026-06-01T01:00:00Z' }
          },
          {
            id: 'message-2',
            message_type: 'return_visit',
            body: null,
            status: 'failed',
            ai_status: 'failed',
            send_status: 'draft',
            error_message: 'OpenAI message generation failed (500).',
            created_at: '2026-07-21T00:01:00Z',
            stores: { store_code: 'test01', name: '테스트헤어', booking_url: '' },
            customers: { name: '지훈', last_visit_at: null }
          }
        ]);
      }
      return jsonResponse({}, 404);
    };

    const res = createResponse();
    await operatorMessagesHandler({ method: 'GET', headers: { cookie: `__Host-operator_session=${OPERATOR_TOKEN}` } }, res);
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.messages[0]).toEqual(expect.objectContaining({
      body: '민지님, 지난 방문 이후 시간이 조금 지났어요.',
      ai_status: 'generated',
      send_status: 'draft',
      has_booking_link: true
    }));
    expect(body.messages[1]).toEqual(expect.objectContaining({
      body: '',
      ai_status: 'failed',
      send_status: 'draft',
      error_message: 'OpenAI message generation failed (500).'
    }));
  });

  test('owner message list is scoped to the session store', async () => {
    duplicateRows = [{
      id: selectedMessage.id,
      customer_id: CUSTOMER_ID,
      body: selectedMessage.body,
      status: 'draft',
      ai_status: 'generated',
      send_status: 'draft',
      created_at: '2026-07-21T00:00:00Z',
      customers: { name: '민지', last_visit_at: '2026-06-01T01:00:00Z', visit_count: 3 }
    }];

    const res = createResponse();
    await ownerMessagesHandler({ method: 'GET', headers: { cookie: `__Host-owner_session=${OWNER_TOKEN}` } }, res);
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.messages[0]).toEqual(expect.objectContaining({
      id: selectedMessage.id,
      customer_name: '민지',
      send_status: 'draft'
    }));
  });

  test('operator approval can change any store message to pending after safety checks', async () => {
    const res = createResponse();
    await operatorActionHandler({
      method: 'POST',
      headers: { cookie: `__Host-operator_session=${OPERATOR_TOKEN}` },
      body: { message_id: selectedMessage.id, action: 'approve' }
    }, res);

    expect(res.statusCode).toBe(200);
    expect(updatedMessages).toEqual([expect.objectContaining({ send_status: 'pending' })]);
  });

  test('front-end files do not expose OpenAI API key names or secrets', () => {
    for (const file of ['index.html', 'customer.html', 'owner.html', 'operator/index.html', 'src/main.js']) {
      const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
      expect(html).not.toContain('OPENAI_API_KEY');
      expect(html).not.toContain('sk-test-secret-value');
    }
  });
});
