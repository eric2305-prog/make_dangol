const crypto = require('node:crypto');

const COOKIE_NAME = '__Host-owner_session';
const SESSION_SECONDS = 30 * 60;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing server environment variable: ${name}`);
  return value;
}

function supabaseUrl() {
  return process.env.SUPABASE_URL || requiredEnv('NEXT_PUBLIC_SUPABASE_URL');
}

function supabaseAnonKey() {
  return process.env.SUPABASE_ANON_KEY || requiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function secureHash(value) {
  return crypto
    .createHmac('sha256', requiredEnv('OWNER_IP_HASH_SECRET'))
    .update(String(value))
    .digest('hex');
}

function randomToken() {
  return crypto.randomBytes(32).toString('hex');
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (Array.isArray(forwarded)) return forwarded[0] || 'unknown';
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim() || 'unknown';
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
}

function parseCookies(req) {
  const cookies = {};
  const raw = req.headers.cookie || '';
  raw.split(';').forEach((part) => {
    const index = part.indexOf('=');
    if (index < 0) return;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  });
  return cookies;
}

function sessionCookie(token) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');

  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

async function serviceRpc(name, body) {
  const url = supabaseUrl();
  const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body || {})
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = null;
  }

  if (!response.ok) {
    throw new Error(`Supabase RPC failed: ${name} (${response.status})`);
  }
  return data;
}

async function serviceSelect(resource, query) {
  const url = supabaseUrl();
  const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  const response = await fetch(`${url}/rest/v1/${resource}?${query}`, {
    method: 'GET',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Supabase select failed: ${resource} (${response.status})`);
  }
  return response.json();
}

module.exports = {
  COOKIE_NAME,
  SESSION_SECONDS,
  clearSessionCookie,
  getClientIp,
  parseCookies,
  randomToken,
  readJson,
  requiredEnv,
  secureHash,
  sendJson,
  serviceRpc,
  serviceSelect,
  sessionCookie,
  sha256,
  supabaseAnonKey,
  supabaseUrl
};
