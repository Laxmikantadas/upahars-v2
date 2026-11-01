// Talks to Shipex directly (no database, no website) and prints exactly what Shipex answers.
// Usage (from the backend folder):
//   SHIPEX_EMAIL=you@mail.com SHIPEX_PASSWORD=secret node scripts/test-shipex.js 756060 756032
// Arguments: <pickUpPincode> <deliveryPincode>
const BASE = (process.env.SHIPEX_BASE_URL || 'https://api.shipexindia.com/v1/api/external').replace(/\/$/, '');
const [pickUpPincode = '756060', deliveryPincode = '756032'] = process.argv.slice(2);
const { SHIPEX_EMAIL: email, SHIPEX_PASSWORD: password } = process.env;
if (!email || !password) { console.error('Set SHIPEX_EMAIL and SHIPEX_PASSWORD first.'); process.exit(1); }

const show = async (label, res) => { const t = await res.text(); console.log(`\n${label} → HTTP ${res.status}\n${t.slice(0, 800)}`); try { return JSON.parse(t); } catch { return {}; } };

const login = await show('generateToken', await fetch(`${BASE}/generateToken`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }));
const token = login?.data?.token;
if (!token) { console.error('\nNo token came back: check the e-mail / password above.'); process.exit(1); }

const body = { pickUpPincode, deliveryPincode, applicableWeight: 1.2, length: 40, width: 30, height: 20, paymentType: 'Prepaid', declaredValue: 1000 };
console.log('\nSending body:', JSON.stringify(body));
await show('pincodeServiceability (POST)', await fetch(`${BASE}/pincodeServiceability`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }));
