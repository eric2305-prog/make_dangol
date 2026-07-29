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
  const industry = store.industry || store.category || store.business_type || '';

  return [
    '한국 소상공인 점주가 단골 고객에게 직접 보내는 카카오 알림 문구를 작성하세요.',
    '',
    '톤:',
    '- 안부를 전하며 자연스럽게 재방문을 안내하는 느낌',
    '- 점주가 고객에게 직접 보내는 부드러운 존댓말',
    '- "~이에요", "~해요", "~드려요", "~주세요", "~좋아요" 같은 말투를 우선 사용',
    '- "입니다", "합니다", "시기입니다", "진행해 주세요"처럼 딱딱한 안내문 말투는 피함',
    '- 왁싱샵, 네일샵, 피부관리처럼 민감하거나 관리 주기가 있는 업종은 더 조심스럽고 부담 없는 표현 사용',
    '',
    '금지:',
    '- 스팸이나 광고처럼 보이는 표현',
    '- 지금 예약하세요, 혜택, 이벤트, 마감 임박, 특별 할인 같은 광고성 표현',
    '- 강한 구매 압박, 과장, 이모지, 해시태그',
    '- Revaro나 AI가 말하는 표현',
    '- 고객 휴대폰 번호는 사용하지 않음',
    '',
    '형식:',
    '- 2~3문장, 180자 이내',
    '- 고객 이름은 첫 문장에 자연스럽게 포함',
    '- 예약 링크가 있으면 마지막 문장에 자연스럽게 안내',
    '',
    '고객 정보:',
    `- 고객 이름: ${customer.name || '고객'}님`,
    `- 매장명: ${store.name || '매장'}`,
    `- 업종: ${industry || '확인되지 않음'}`,
    `- 마지막 방문일: ${kstDateLabel(customer.last_visit_at)}`,
    `- 마지막 방문 후 경과일: ${lastVisitDays === null ? '확인되지 않음' : `${lastVisitDays}일`}`,
    `- 재방문 권장 시점: ${expectedVisitAt ? kstDateLabel(expectedVisitAt) : '확인되지 않음'}`,
    `- 누적 방문 횟수: ${Number(customer.visit_count || 0)}회`,
    `- 예약 링크: ${bookingUrl || '없음'}`,
    '',
    '좋은 예시 톤:',
    '민지님, 지난 방문 이후 시간이 조금 지났어요.',
    '편하실 때 다시 관리 받아보셔도 좋을 시기라 안내드려요.',
    '예약은 아래 링크에서 확인하실 수 있어요.',
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
