const DEFAULT_OPENAI_MESSAGE_MODEL = 'gpt-4.1-mini';

const FORBIDDEN_BODY_PATTERNS = [
  /revaro\s+default\s+message/i,
  /test\s+message/i,
  /fallback\s+message/i,
  /dummy\s+message/i,
  /sample\s+message/i,
  /lorem\s+ipsum/i
];

function messageModel() {
  return String(process.env.OPENAI_MESSAGE_MODEL || DEFAULT_OPENAI_MESSAGE_MODEL).trim();
}

function hasForbiddenMessageText(value) {
  const text = String(value || '').trim();
  return FORBIDDEN_BODY_PATTERNS.some((pattern) => pattern.test(text));
}

function hasBrokenDisplayText(value) {
  const text = String(value || '');
  return /�|[A-Za-z0-9가-힣]\?\?|\?\?[A-Za-z0-9가-힣]/.test(text);
}

function normalizeGeneratedMessage(value) {
  const text = String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text || text.length < 20 || text.length > 500) return '';
  if (hasForbiddenMessageText(text)) return '';
  if (hasBrokenDisplayText(text)) return '';
  return text;
}

function kstDateLabel(value) {
  if (!value) return '확인되지 않음';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '확인되지 않음';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(date);
}

function daysSince(value, now = new Date()) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86400000));
}

function addDays(value, days) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() + Number(days || 0) * 86400000);
}

function buildPrompt({ store, customer, settings }) {
  if (hasBrokenDisplayText(customer && customer.name)) {
    throw new Error('Customer name contains invalid display text.');
  }
  if (hasBrokenDisplayText(store && store.name)) {
    throw new Error('Store name contains invalid display text.');
  }

  const cycleDays = Number(settings && settings.revisit_cycle_days ? settings.revisit_cycle_days : 30);
  const lastVisitDays = daysSince(customer.last_visit_at);
  const expectedVisitAt = customer.last_visit_at ? addDays(customer.last_visit_at, cycleDays) : null;
  const bookingUrl = (settings && settings.reservation_url) || store.booking_url || '';

  return [
    '한국 소상공인 점주가 단골 고객에게 직접 보내는 카카오 알림 문구를 작성하세요.',
    '',
    '조건:',
    '- 2~4문장, 180자 이내',
    '- 스팸이나 광고처럼 보이지 않게 작성',
    '- 강한 구매 압박, 과장, 이모지, 해시태그 금지',
    '- Revaro나 AI가 말하는 표현 금지',
    '- 고객 휴대폰 번호는 사용하지 않음',
    '- 예약 링크가 있으면 마지막 문장에 자연스럽게 안내',
    '',
    '고객 정보:',
    `- 고객 이름: ${customer.name || '고객'}님`,
    `- 매장명: ${store.name || '매장'}`,
    `- 마지막 방문일: ${kstDateLabel(customer.last_visit_at)}`,
    `- 마지막 방문 후 경과일: ${lastVisitDays === null ? '확인되지 않음' : `${lastVisitDays}일`}`,
    `- 재방문 권장 시점: ${expectedVisitAt ? kstDateLabel(expectedVisitAt) : '확인되지 않음'}`,
    `- 누적 방문 횟수: ${Number(customer.visit_count || 0)}회`,
    `- 예약 링크: ${bookingUrl || '없음'}`,
    '',
    '출력은 고객에게 보낼 메시지 본문만 작성하세요.'
  ].join('\n');
}

function extractOutputText(data) {
  if (data && typeof data.output_text === 'string') return data.output_text;
  const parts = [];
  for (const item of data && Array.isArray(data.output) ? data.output : []) {
    for (const content of Array.isArray(item.content) ? item.content : []) {
      if (typeof content.text === 'string') parts.push(content.text);
    }
  }
  return parts.join('\n');
}

async function generateCustomerMessage({ store, customer, settings }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured.');

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: messageModel(),
      input: buildPrompt({ store, customer, settings }),
      max_output_tokens: 220
    })
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = null;
  }

  if (!response.ok) {
    throw new Error(`OpenAI message generation failed (${response.status}).`);
  }

  const body = normalizeGeneratedMessage(extractOutputText(data));
  if (!body) throw new Error('OpenAI returned an unusable message.');
  return {
    body,
    model: data && data.model ? data.model : messageModel()
  };
}

module.exports = {
  DEFAULT_OPENAI_MESSAGE_MODEL,
  buildPrompt,
  generateCustomerMessage,
  hasBrokenDisplayText,
  hasForbiddenMessageText,
  messageModel,
  normalizeGeneratedMessage
};
