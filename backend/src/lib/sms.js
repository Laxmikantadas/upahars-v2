const MSG91 = 'https://control.msg91.com/api/v5/widget';
const placeholder = (v) => !v || /^your_/i.test(v);

// MSG91 sometimes answers with JSON, sometimes with plain text or an HTML error page. Read it safely and keep the raw text for the logs.
async function readReply(res) {
  let raw = '', j = {};
  if (typeof res.text === 'function') { raw = await res.text().catch(() => ''); try { j = JSON.parse(raw); } catch { /* not JSON */ } }
  else { j = await res.json().catch(() => ({})); raw = JSON.stringify(j); }
  const message = String(j.message ?? j.error ?? (raw && raw.length < 300 ? raw : '') ?? '');
  const type = String(j.type ?? '').toLowerCase();
  return { j, raw, message, type, failed: !res.ok || type === 'error' || (type === '' && /error|fail|invalid|denied|blocked/i.test(message)) };
}
// Turns MSG91's short error words into the thing you actually have to fix in the MSG91 dashboard.
export function msg91Hint(message = '') {
  const m = String(message);
  if (/ip.?block|ip.*not.*(allow|whitelist)|whitelist/i.test(m)) return 'MSG91 is blocking this server IP. MSG91 dashboard -> Settings/Security -> IP Whitelisting: switch it OFF (or add this server public IP).';
  if (/captcha/i.test(m)) return 'Captcha is ON for the widget. MSG91 dashboard -> OTP -> Widget -> switch Captcha validation OFF.';
  if (/auth(entication)?.?fail|invalid.?auth|authkey|unauthor/i.test(m)) return 'MSG91_AUTH_KEY is wrong. Copy the Authkey again from MSG91 dashboard -> top-right profile -> Authkey.';
  if (/template/i.test(m)) return 'The DLT template id is wrong / not approved / not linked to a Sender ID. MSG91 dashboard -> OTP -> Templates: copy the template id of an APPROVED template whose text contains ##OTP##.';
  if (/(insufficient|low).*(balance|credit)|balance|credit/i.test(m)) return 'Your MSG91 account has no SMS balance. Recharge it (MSG91 dashboard -> Billing).';
  if (/widget|token/i.test(m)) return 'MSG91_WIDGET_ID / MSG91_WIDGET_TOKEN do not match. Copy both again from MSG91 dashboard -> OTP -> Widget.';
  if (/dlt|sender|route|entity/i.test(m)) return 'DLT is not set up: you need an approved Sender ID + Entity ID + OTP template in MSG91 (India SMS is blocked without it).';
  return '';
}
const decodeJwtPayload = (t) => {
  try { return JSON.parse(Buffer.from(String(t).split('.')[1], 'base64url').toString('utf8')); } catch { return null; }
};
// MSG91's reply when the person simply typed a wrong / expired code (as opposed to a setup or account problem).
const WRONG_CODE = /(otp|code).*(not match|mismatch|invalid|incorrect|wrong|expired)|(invalid|incorrect|wrong|expired).*(otp|code)/i;

/**
 * MSG91 OTP Widget API, called from the SERVER (https://docs.msg91.com/otp-widget).
 * The server sends the code, so it knows exactly which phone number MSG91's request id (reqId) belongs to. MSG91's own
 * access token does not name the number, so this is what ties a verified code to the right person.
 *   sendOtp(phone10)                -> { reqId }
 *   verifyOtp(phone10, reqId, code) -> true | false   (throws on setup / network trouble, so it is never shown as "wrong code")
 * MSG91 replies { type: 'success' | 'error', message: <reqId | access token | error text> }.
 * Note: the widget's Captcha option must be switched OFF in the MSG91 dashboard (captcha is not supported on this API).
 */
export function createMsg91Provider(config, doFetch = fetch) {
  const { MSG91_WIDGET_ID: widgetId, MSG91_WIDGET_TOKEN: tokenAuth, MSG91_AUTH_KEY: authkey, MSG91_TEMPLATE_ID: templateId } = config;
  if (!placeholder(templateId)) return createMsg91Sender({ authkey, templateId }, doFetch); // our backend makes + checks the code; MSG91 only delivers it
  if (placeholder(widgetId) || placeholder(tokenAuth) || placeholder(authkey))
    throw new Error('MSG91 OTP needs real MSG91_WIDGET_ID, MSG91_WIDGET_TOKEN and MSG91_AUTH_KEY (MSG91 dashboard → OTP → Widget / Authkey)');
  const call = async (path, body) => {
    let res;
    try { res = await doFetch(`${MSG91}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', authkey }, body: JSON.stringify(body) }); }
    catch (e) { throw new Error(`MSG91 request failed (network): ${e?.cause?.code ?? e?.message ?? ''}`.trim()); }
    const r = await readReply(res);
    if (r.failed) console.error(`[msg91] widget/${path} -> HTTP ${res.status} ${r.raw.slice(0, 300)}`);
    return { ok: !r.failed, message: r.message, status: res.status };
  };
  return {
    name: 'msg91', managed: true,
    async sendOtp(phone10) {
      const r = await call('sendOtp', { widgetId, tokenAuth, identifier: `91${phone10}` });
      if (!r.ok || !r.message) throw new Error(`MSG91 could not send the code (HTTP ${r.status}): ${r.message || 'no reply'}. ${msg91Hint(r.message)}`.trim());
      return { reqId: r.message };
    },
    async verifyOtp(_phone10, reqId, code) {
      const r = await call('verifyOtp', { widgetId, tokenAuth, reqId, otp: code });
      if (!r.ok) { if (WRONG_CODE.test(r.message)) return false; throw new Error(`MSG91 could not check the code (HTTP ${r.status}): ${r.message || 'no reply'}`); }
      const token = r.message; // a correct code returns MSG91's access token (a JWT)
      // the token must belong to THIS request (it carries the request id), and MSG91 must confirm it with our secret auth key
      const claimed = decodeJwtPayload(token)?.requestId;
      if (claimed && String(claimed) !== String(reqId)) return false;
      const v = await call('verifyAccessToken', { authkey, 'access-token': token });
      if (!v.ok) { if (WRONG_CODE.test(v.message)) return false; throw new Error(`MSG91 could not confirm the verification (HTTP ${v.status}): ${v.message || 'no reply'}`); }
      return true;
    },
    async send() { throw new Error('MSG91 manages the one-time code itself'); },
  };
}

/**
 * MSG91 as a plain SMS carrier (OTP API v5, needs the DLT-approved template id that contains ##OTP##).
 * OUR backend creates the code, stores only its hash, checks it and enforces expiry / attempt limits (routes/auth.js).
 * MSG91 just delivers the text:  send(phone10, text, code)
 */
export function createMsg91Sender({ authkey, templateId }, doFetch = fetch) {
  if (placeholder(authkey) || placeholder(templateId)) throw new Error('MSG91 SMS needs MSG91_AUTH_KEY and MSG91_TEMPLATE_ID (MSG91 dashboard → OTP → Templates)');
  return {
    name: 'msg91-sms',
    async send(phone10, _text, code) {
      const url = new URL('https://control.msg91.com/api/v5/otp');
      url.search = new URLSearchParams({ template_id: templateId, mobile: `91${phone10}`, otp: code, otp_expiry: '15', realTimeResponse: '1' }).toString();
      let res;
      try { res = await doFetch(url.toString(), { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', authkey }, body: '{}' }); }
      catch (e) { throw new Error(`MSG91 request failed (network): ${e?.cause?.code ?? e?.message ?? ''}`.trim()); }
      const r = await readReply(res);
      if (r.failed) {
        console.error(`[msg91] otp -> HTTP ${res.status} ${r.raw.slice(0, 300)}`);
        throw new Error(`MSG91 could not send the SMS (HTTP ${res.status}): ${r.message || 'no reply'}. ${msg91Hint(r.message)}`.trim());
      }
    },
  };
}

// SMS is behind an interface so the provider can change without touching auth code.
export function createSmsProvider(config, logger = console) {
  if (config.OTP_PROVIDER === 'msg91') return createMsg91Provider(config);
  // console provider: development only (never sends anything)
  return { name: 'console', async send(phone10, text) { logger.info?.(`[sms:console] to ******${phone10.slice(-4)}: ${text}`); } };
}
