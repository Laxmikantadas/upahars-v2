// Checks your MSG91 setup and prints MSG91's raw reply + what to fix.
//   node scripts/test-msg91.js send 9XXXXXXXXX            -> sends one real OTP
//   node scripts/test-msg91.js verify <reqId> <code>      -> (widget mode only) checks the code
import '../src/lib/loadEnv.js';
import { msg91Hint } from '../src/lib/sms.js';

const [cmd, a, b] = process.argv.slice(2);
const { MSG91_WIDGET_ID: widgetId, MSG91_WIDGET_TOKEN: tokenAuth, MSG91_AUTH_KEY: authkey, MSG91_TEMPLATE_ID: templateId } = process.env;
const show = (v) => (v ? `${v.slice(0, 4)}…(${v.length} chars)` : 'MISSING');
const templateMode = Boolean(templateId && !/^your_/i.test(templateId));
console.log('mode:', templateMode ? 'TEMPLATE (our backend makes the code)' : 'WIDGET (MSG91 makes the code)');
console.log('authkey:', show(authkey), '| template:', show(templateId), '| widgetId:', show(widgetId), '| widgetToken:', show(tokenAuth));

const run = async (label, url, init) => {
  const res = await fetch(url, init).catch((e) => { console.error('Network error - cannot reach MSG91:', e.cause?.code ?? e.message); process.exit(1); });
  const text = await res.text(); console.log(`\n${label} -> HTTP ${res.status}\n${text}`);
  let j = {}; try { j = JSON.parse(text); } catch { /* plain text */ }
  const bad = !res.ok || String(j.type).toLowerCase() === 'error';
  if (bad) console.log('\nFIX:', msg91Hint(j.message ?? text) || 'See the message above or ask MSG91 support with it.');
  return j;
};
const headers = { 'Content-Type': 'application/json', Accept: 'application/json', authkey };
if (cmd === 'send' && /^[6-9]\d{9}$/.test(a ?? '')) {
  if (templateMode) {
    const q = new URLSearchParams({ template_id: templateId, mobile: `91${a}`, otp: '123456', otp_expiry: '15', realTimeResponse: '1' });
    await run('otp', `https://control.msg91.com/api/v5/otp?${q}`, { method: 'POST', headers, body: '{}' });
  } else {
    await run('widget/sendOtp', 'https://control.msg91.com/api/v5/widget/sendOtp', { method: 'POST', headers, body: JSON.stringify({ widgetId, tokenAuth, identifier: `91${a}` }) });
  }
  console.log('\nSuccess = {"type":"success",...} AND an SMS arrives on the phone.');
} else if (cmd === 'verify' && a && /^\d{4,8}$/.test(b ?? '') && !templateMode) {
  const v = await run('widget/verifyOtp', 'https://control.msg91.com/api/v5/widget/verifyOtp', { method: 'POST', headers, body: JSON.stringify({ widgetId, tokenAuth, reqId: a, otp: b }) });
  if (v.type === 'success') await run('widget/verifyAccessToken', 'https://control.msg91.com/api/v5/widget/verifyAccessToken', { method: 'POST', headers, body: JSON.stringify({ authkey, 'access-token': v.message }) });
} else { console.error('Usage:\n  node scripts/test-msg91.js send 9XXXXXXXXX\n  node scripts/test-msg91.js verify <request id> <code>   (widget mode only)'); process.exit(1); }
