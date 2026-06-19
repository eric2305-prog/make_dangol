const { sendJson, supabaseAnonKey, supabaseUrl } = require('../server/owner-security');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { ok: false });
  }

  try {
    return sendJson(res, 200, {
      supabase_url: supabaseUrl(),
      supabase_anon_key: supabaseAnonKey()
    });
  } catch (_) {
    return sendJson(res, 500, { ok: false });
  }
};
