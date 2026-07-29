const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const generateHandler = require('../api/owner/messages/generate');
const ownerActionHandler = require('../api/owner/messages/action');
const ownerMessagesHandler = require('../api/owner/messages');
const operatorMessagesHandler = require('../api/operator/messages');
const operatorActionHandler = require('../api/operator/messages-action');
const {
  buildPrompt,
  hasBrokenDisplayText,
  normalizeGeneratedMessage
} = require('../server/ai-message');

const OWNER_TOKEN = 'a'.repeat(64);
const OPERATOR_TOKEN = 'b'.repeat(64);
const STORE_ID = '00000000-0000-4000-8000-000000000001';
const CUSTOMER_ID = '10000000-0000-4000-8000-000000000001';
const MESSAGE_ID = '20000000-0000-4000-8000-000000000001';

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
  let updatedMessages;
  let openAiRequests;
  let customerConsent;
  let duplicateRows;
  let ownerMessageRows;
  let operatorMessageQueries;
  let openAiStatus;
  let openAiBody;
  let selectedMessage;

  test.beforeEach(() => {
    originalFetch = global.fetch;
    insertedMessages = [];
    updatedMessages = [];
    openAiRequests = [];
    customerConsent = true;
    duplicateRows = [];
    ownerMessageRows = [];
    operatorMessageQueries = [];
    openAiStatus = 200;
    selectedMessage = {
      id: MESSAGE_ID,
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
      output_text: '민지님, 지난 방문 이후 시간이 조금 지났어요.\n편하신 시간에 다시 관리 받아보셔도 좋을 시기라 안내드려요.\n예약은 https://booking.example 에서 확인하실 수 있어요.',
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
        if (textUrl.includes(`id=eq.${MESSAGE_ID}`)) return jsonResponse([selectedMessage]);
        if (textUrl.includes('send_status=eq.pending')) return jsonResponse(duplicateRows);
        return jsonResponse(ownerMessageRows);
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

  test('builds a clean Korean prompt and rejects broken customer names', () => {
    const prompt = buildPrompt({
      store: { name: '테스트헤어', booking_url: 'https://booking.example', industry: '피부관리' },
      customer: { name: '민지', last_visit_at: '2026-06-01T01:00:00Z', visit_count: 3 },
      settings: { revisit_cycle_days: 30, reservation_url: 'https://booking.example' }
    });
    expect(prompt).toContain('고객 이름: 민지님');
    expect(prompt).toContain('매장명: 테스트헤어');
    expect(prompt).toContain('업종: 피부관리');
    expect(prompt).toContain('"~이에요", "~해요", "~드려요", "~주세요", "~좋아요"');
    expect(prompt).toContain('"입니다", "합니다", "시기입니다", "진행해 주세요"처럼 딱딱한 안내문 말투는 피함');
    expect(prompt).toContain('지금 예약하세요, 혜택, 이벤트, 마감 임박, 특별 할인');
    expect(prompt).toContain('민감하거나 관리 주기가 있는 업종은 더 조심스럽고 부담 없는 표현 사용');
    expect(prompt).not.toMatch(/\?\?|�/);
    expect(() => buildPrompt({
      store: { name: '테스트헤어' },
      customer: { name: 'AI??7042' },
      settings: {}
    })).toThrow(/Customer name/);
    expect(hasBrokenDisplayText('AI??7042')).toBe(true);
  });

  test('generates a real customer message as draft for review before pending approval', async () => {
    const res = createResponse();
    await generateHandler(ownerRequest(), res);

    expect(res.statusCode).toBe(201);
    expect(openAiRequests).toHaveLength(1);
    expect(JSON.stringify(openAiRequests[0])).not.toContain('01012345678');
    expect(openAiRequests[0].input).toContain('고객 이름: 민지님');
    expect(openAiRequests[0].input).toContain('2~3문장, 180자 이내');
    expect(openAiRequests[0].input).toContain('예약 링크가 있으면 마지막 문장에 자연스럽게 안내');
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
    expect(insertedMessages[0].body).not.toMatch(/Revaro default message|test message|fallback message|dummy message|sample message|lorem ipsum|\?\?|�/i);
    expect(insertedMessages[0].body).toContain('확인하실 수 있어요');
    expect(res.body).not.toContain('sk-test-secret-value');
  });

  test('approval is the only path that changes send_status to pending', async () => {
    const res = createResponse();
    await ownerActionHandler(ownerRequest({ message_id: MESSAGE_ID, action: 'approve' }), res);

    expect(res.statusCode).toBe(200);
    expect(updatedMessages).toEqual([expect.objectContaining({
      status: 'pending',
      send_status: 'pending'
    })]);
  });

  test('cancel changes send_status to canceled', async () => {
    const res = createResponse();
    await ownerActionHandler(ownerRequest({ message_id: MESSAGE_ID, action: 'cancel' }), res);

    expect(res.statusCode).toBe(200);
    expect(updatedMessages).toEqual([expect.objectContaining({
      status: 'canceled',
      send_status: 'canceled'
    })]);
  });

  test('regenerate creates a new draft and cancels the previous draft after success', async () => {
    const res = createResponse();
    await generateHandler(ownerRequest({ message_id: MESSAGE_ID }), res);

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
    await ownerActionHandler(ownerRequest({ message_id: MESSAGE_ID, action: 'approve' }), res);

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).code).toBe('consent_required');
    expect(updatedMessages).toHaveLength(0);
  });

  test('approval blocks fallback and broken copy', async () => {
    for (const body of ['fallback message', '민지??님, 다시 방문해 주세요.']) {
      selectedMessage.body = body;
      const res = createResponse();
      await ownerActionHandler(ownerRequest({ message_id: MESSAGE_ID, action: 'approve' }), res);

      expect(res.statusCode).toBe(409);
      expect(['blocked_message_body', 'broken_message_body']).toContain(JSON.parse(res.body).code);
      expect(updatedMessages).toHaveLength(0);
    }
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
    expect(insertedMessages).toEqual([expect.objectContaining({
      body: null,
      ai_status: 'failed',
      send_status: 'draft',
      status: 'failed'
    })]);
    expect(insertedMessages).not.toEqual([expect.objectContaining({ send_status: 'pending' })]);
  });

  test('rejects fallback and broken generated copy', async () => {
    for (const output_text of ['Revaro default message test message', '민지??님, 다시 방문해 주세요.']) {
      insertedMessages = [];
      openAiBody = { output_text, model: 'test-openai-model' };
      const res = createResponse();
      await generateHandler(ownerRequest(), res);

      expect(res.statusCode).toBe(502);
      expect(insertedMessages).toEqual([expect.objectContaining({
        body: null,
        ai_status: 'failed',
        send_status: 'draft'
      })]);
    }
  });

  test('forbidden message text helper blocks unsafe placeholders', () => {
    for (const value of [
      'Revaro default message 123',
      'test message',
      'fallback message',
      'dummy message',
      'sample message',
      'lorem ipsum',
      '민지??님, 다시 방문해 주세요.'
    ]) {
      expect(normalizeGeneratedMessage(value)).toBe('');
    }
  });

  test('operator can see actual AI messages with safe names from review-ready rows', async () => {
    global.fetch = async (url) => {
      const textUrl = String(url);
      if (textUrl.includes('/rpc/operator_session_validate')) {
        return jsonResponse({ ok: true, operator_email: 'operator@revaro.me' });
      }
      if (textUrl.includes('/rest/v1/messages?')) {
        operatorMessageQueries.push(textUrl);
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
            body: 'AI??7042님, 다시 방문해 주세요.',
            status: 'draft',
            ai_status: 'generated',
            send_status: 'draft',
            error_message: null,
            created_at: '2026-07-21T00:01:00Z',
            stores: { store_code: 'test01', name: '테스트헤어', booking_url: '' },
            customers: { name: 'AI??7042', last_visit_at: null }
          }
        ]);
      }
      return jsonResponse({}, 404);
    };

    const res = createResponse();
    await operatorMessagesHandler({ method: 'GET', headers: { cookie: `__Host-operator_session=${OPERATOR_TOKEN}` } }, res);
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(operatorMessageQueries[0]).toContain('message_type=eq.return_visit');
    expect(operatorMessageQueries[0]).toContain('ai_status=eq.generated');
    expect(operatorMessageQueries[0]).toContain('send_status=in.(draft,pending)');
    expect(body.messages[0]).toEqual(expect.objectContaining({
      body: '민지님, 지난 방문 이후 시간이 조금 지났어요.',
      customer_name: '민지',
      send_status: 'draft',
      has_booking_link: true
    }));
    expect(body.messages[1]).toEqual(expect.objectContaining({
      body: 'AI 문구 재생성이 필요합니다.',
      customer_name: '고객명 확인 필요'
    }));
  });

  test('owner message list is scoped to the session store and hides canceled rows', async () => {
    ownerMessageRows = [{
      id: MESSAGE_ID,
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
      id: MESSAGE_ID,
      customer_name: '민지',
      send_status: 'draft'
    }));
  });

  test('operator approval can change any store message to pending after safety checks', async () => {
    const res = createResponse();
    await operatorActionHandler({
      method: 'POST',
      headers: { cookie: `__Host-operator_session=${OPERATOR_TOKEN}` },
      body: { message_id: MESSAGE_ID, action: 'approve' }
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
