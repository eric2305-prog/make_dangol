const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const {
  getClientIp,
  parseCookies,
  randomToken,
  readJson,
  requiredEnv,
  sendJson,
  serviceRpc,
  sha256
} = require('./owner-security');

const OPERATOR_COOKIE_NAME = '__Host-operator_session';
const OPERATOR_SESSION_SECONDS = 2 * 60 * 60;

function operatorSecret() {
  const value = requiredEnv('OPERATOR_SESSION_SECRET');
  if (value.length < 32) throw new Error('OPERATOR_SESSION_SECRET must be at least 32 characters.');
  return value;
}

function operatorHash(value) {
  return crypto.createHmac('sha256', operatorSecret()).update(String(value)).digest('hex');
}

function operatorEmail() {
  return requiredEnv('OPERATOR_EMAIL').trim().toLowerCase();
}

async function verifyOperatorCredentials(email, password) {
  const expectedEmail = operatorEmail();
  const emailMatches = String(email || '').trim().toLowerCase() === expectedEmail;
  const passwordMatches = await bcrypt.compare(
    String(password || ''),
    requiredEnv('OPERATOR_PASSWORD_HASH')
  );
  return emailMatches && passwordMatches;
}

function operatorSessionCookie(token) {
  return `${OPERATOR_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${OPERATOR_SESSION_SECONDS}`;
}

function clearOperatorSessionCookie() {
  return `${OPERATOR_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function operatorToken(req) {
  const token = parseCookies(req)[OPERATOR_COOKIE_NAME];
  return token && /^[0-9a-f]{64}$/.test(token) ? token : null;
}

function allowedOrigins() {
  const configured = String(process.env.OPERATOR_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set([
    'https://www.revaro.me',
    'https://revaro.me',
    ...configured
  ]);
}

function hasTrustedOrigin(req) {
  const origin = String(req.headers.origin || '');
  if (!origin && process.env.NODE_ENV !== 'production') return true;
  return allowedOrigins().has(origin);
}

async function getOperatorSession(req) {
  const token = operatorToken(req);
  if (!token) return null;
  const result = await serviceRpc('operator_session_validate', {
    p_token_hash: sha256(token)
  });
  if (!result || result.ok !== true) return null;
  return { token, tokenHash: sha256(token), ...result };
}

function operatorIpHash(req) {
  return operatorHash(`ip:${getClientIp(req)}`);
}

function operatorEmailHash(email) {
  return operatorHash(`email:${String(email || '').trim().toLowerCase()}`);
}

module.exports = {
  OPERATOR_COOKIE_NAME,
  OPERATOR_SESSION_SECONDS,
  clearOperatorSessionCookie,
  getOperatorSession,
  hasTrustedOrigin,
  operatorEmail,
  operatorEmailHash,
  operatorIpHash,
  operatorSessionCookie,
  operatorToken,
  randomToken,
  readJson,
  sendJson,
  serviceRpc,
  sha256,
  verifyOperatorCredentials
};
