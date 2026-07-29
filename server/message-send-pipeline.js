const crypto = require('node:crypto');

const { hasBrokenDisplayText, hasForbiddenMessageText } = require('./ai-message');

const DEFAULT_PROVIDER = 'nhn_cloud';
const MAKE_SEND_SECRET_ENV = 'MAKE_SEND_SECRET';

function timingSafeEqualText(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function makeAuth(req) {
  const configured = process.env[MAKE_SEND_SECRET_ENV];
  if (!configured) {
    const error = new Error('MAKE_SEND_SECRET is not configured.');
    error.code = 'make_secret_not_configured';
    error.status = 503;
    throw error;
  }

  const auth = String(req.headers.authorization || '');
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const header = String(req.headers['x-make-secret'] || '').trim();
  if (!timingSafeEqualText(bearer || header, configured)) {
    const error = new Error('Make 인증이 필요합니다.');
    error.code = 'unauthorized';
    error.status = 401;
    throw error;
  }
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function isValidCustomerPhone(value) {
  const phone = normalizePhone(value);
  return (phone.length === 10 || phone.length === 11) && phone.startsWith('0');
}

function validatePendingMessage(row, duplicateRows) {
  const reasons = [];
  const customer = row.customers || {};
  const store = row.stores || {};
  const body = String(row.body || '').trim();

  if (row.ai_status !== 'generated') reasons.push('ai_status_not_generated');
  if (row.send_status !== 'pending') reasons.push('send_status_not_pending');
  if (row.message_type !== 'return_visit') reasons.push('unsupported_message_type');
  if (row.channel !== 'kakao') reasons.push('unsupported_channel');
  if (!body) reasons.push('empty_body');
  if (hasForbiddenMessageText(body)) reasons.push('forbidden_body');
  if (hasBrokenDisplayText(body)) reasons.push('broken_body');
  if (!(customer.kakao_agreed === true && customer.marketing_agreed === true && customer.consent !== false)) {
    reasons.push('consent_required');
  }
  if (!isValidCustomerPhone(customer.phone)) reasons.push('invalid_phone');
  if (!store.name || !store.store_code) reasons.push('invalid_store');
  if (hasBrokenDisplayText(customer.name) || hasBrokenDisplayText(store.name)) reasons.push('broken_display_text');
  if ((duplicateRows || []).length !== 1) reasons.push('duplicate_pending');

  return reasons;
}

function publicSendTarget(row) {
  const customer = row.customers || {};
  const store = row.stores || {};
  return {
    message_id: row.id,
    store_id: store.store_code || '',
    store_uuid: row.store_id,
    store_name: store.name || '',
    customer_id: row.customer_id,
    customer_name: customer.name || '',
    phone: normalizePhone(customer.phone),
    channel: row.channel || 'kakao',
    provider: row.provider || DEFAULT_PROVIDER,
    body: row.body || '',
    message_type: row.message_type,
    created_at: row.created_at
  };
}

function resultStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'success' || status === 'failed') return status;
  return '';
}

function providerName(value) {
  return String(value || DEFAULT_PROVIDER).trim().slice(0, 50) || DEFAULT_PROVIDER;
}

module.exports = {
  DEFAULT_PROVIDER,
  MAKE_SEND_SECRET_ENV,
  makeAuth,
  normalizePhone,
  providerName,
  publicSendTarget,
  resultStatus,
  validatePendingMessage
};
