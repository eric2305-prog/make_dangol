const {
  COOKIE_NAME,
  clearSessionCookie,
  parseCookies,
  readJson,
  sendJson,
  serviceRpc,
  serviceSelect,
  serviceUpsert,
  sha256
} = require('../../server/owner-security');

const DEFAULT_REVISIT_DAYS = 30;
const DEFAULT_MESSAGE = '방문 주기에 맞춰 다시 안내드릴게요.';

function cleanText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function cleanUrl(value) {
  const url = cleanText(value, 500);
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.toString();
  } catch (_) {
    return '';
  }
}

async function ownerStore(req, res) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token || !/^[0-9a-f]{64}$/.test(token)) {
    res.setHeader('Set-Cookie', clearSessionCookie());
    sendJson(res, 401, { ok: false, message: '로그인이 필요합니다.' });
    return null;
  }

  const result = await serviceRpc('owner_session_dashboard', {
    p_token_hash: sha256(token)
  });
  const store = result && result.ok === true && result.snapshot
    ? result.snapshot.store || {}
    : {};
  if (!store.id || !/^[0-9a-f-]{36}$/i.test(store.id)) {
    res.setHeader('Set-Cookie', clearSessionCookie());
    sendJson(res, 401, { ok: false, message: '로그인 시간이 만료되었습니다.' });
    return null;
  }
  return store;
}

function publicSettings(row) {
  return {
    reservation_url: row && row.reservation_url ? row.reservation_url : '',
    revisit_cycle_days: Number(row && row.revisit_cycle_days ? row.revisit_cycle_days : DEFAULT_REVISIT_DAYS),
    default_message: row && row.default_message ? row.default_message : DEFAULT_MESSAGE
  };
}

function publicStore(store) {
  return {
    store_id: store.store_id || store.store_code || '',
    name: store.name || '',
    phone: store.phone || '',
    address: store.address || ''
  };
}

module.exports = async function handler(req, res) {
  if (!['GET', 'PATCH'].includes(req.method)) {
    res.setHeader('Allow', 'GET, PATCH');
    return sendJson(res, 405, { ok: false, message: '허용되지 않는 요청입니다.' });
  }

  try {
    const store = await ownerStore(req, res);
    if (!store) return;

    const storeFilter = encodeURIComponent(store.id);
    const rows = await serviceSelect(
      'settings',
      `select=store_id,reservation_url,revisit_cycle_days,default_message&store_id=eq.${storeFilter}&limit=1`
    );

    if (req.method === 'GET') {
      return sendJson(res, 200, {
        ok: true,
        store: publicStore(store),
        settings: publicSettings(rows[0] || null)
      });
    }

    const body = await readJson(req);
    const reservationUrl = cleanUrl(body.reservation_url);
    const rawDays = Number.parseInt(String(body.revisit_cycle_days || ''), 10);
    const revisitCycleDays = Number.isFinite(rawDays)
      ? Math.min(180, Math.max(7, rawDays))
      : DEFAULT_REVISIT_DAYS;
    const defaultMessage = cleanText(body.default_message, 500) || DEFAULT_MESSAGE;

    const updated = await serviceUpsert(
      'settings',
      'on_conflict=store_id',
      {
        store_id: store.id,
        reservation_url: reservationUrl,
        revisit_cycle_days: revisitCycleDays,
        default_message: defaultMessage,
        updated_at: new Date().toISOString()
      }
    );

    return sendJson(res, 200, {
      ok: true,
      store: publicStore(store),
      settings: publicSettings(updated[0] || rows[0] || null)
    });
  } catch (_) {
    return sendJson(res, 500, { ok: false, message: '매장 설정을 처리하지 못했습니다.' });
  }
};
