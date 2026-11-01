import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, badRequest, forbidden, HttpError } from '../lib/errors.js';
import { decryptJson, encryptJson, hmacHex, randomInt32, randomOtp, safeEqual } from '../lib/crypto.js';
import { generateSecret, otpauthUri, verifyTotp } from '../lib/totp.js';
import { validate } from '../lib/validate.js';
import { OtpChallenge, OtpThrottle, Seller, User } from '../models/index.js';
import { requireAuth, sessionCookieOptions, SESSION_COOKIE, signMfaChallenge, signSession, verifyMfaChallenge } from '../middleware/auth.js';

const phone = z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number');
const OTP_TTL_MIN = 15, OTP_TTL = OTP_TTL_MIN * 60_000, RESEND_GAP = 30_000, MAX_SENDS_PER_HOUR = 5, MAX_ATTEMPTS = 5;

const MFA_MAX_FAILS = 5, MFA_LOCK_MS = 15 * 60_000, BACKUP_CODE_COUNT = 10;
const secondFactorCode = z.string().trim().min(6).max(20); // 6-digit app code OR a backup code like "k3x9a-72mqp"
const normBackup = (c) => String(c).toLowerCase().replace(/[\s-]/g, '');

export async function userView(u, { requireAdmin2fa = false } = {}) {
  const seller = u.roles.includes('seller') || u.roles.includes('customer') ? await Seller.findOne({ userId: u._id }).lean() : null;
  return { id: String(u._id), phone: u.phone, name: u.name, email: u.email, roles: u.roles, twoFactorEnabled: Boolean(u.twoFactor?.enabled), twoFactorSetupRequired: Boolean(requireAdmin2fa && u.roles.includes('admin') && !u.twoFactor?.enabled), seller: seller ? { status: seller.status, storeSlug: seller.store.slug } : null };
}

export default function authRoutes({ config, sms, limits }) {
  const r = Router();
  const codeHash = (ph, code) => hmacHex(config.JWT_SECRET, `otp:${ph}:${code}`);
  const view = (u) => userView(u, { requireAdmin2fa: config.requireAdmin2fa });
  const backupHash = (u, code) => hmacHex(config.JWT_SECRET, `backup:${u._id}:${normBackup(code)}`);
  const newBackupCodes = () => Array.from({ length: BACKUP_CODE_COUNT }, () => { const a = randomInt32().toString(36).padStart(7, '0').slice(-5); const b = randomInt32().toString(36).padStart(7, '0').slice(-5); return `${a}-${b}`; });

  /** Checks an authenticator code or a backup code. Locks after 5 failures; an app code can only be used once. */
  async function checkSecondFactor(u, input) {
    const tf = u.twoFactor ?? {};
    if (tf.lockedUntil && tf.lockedUntil.getTime() > Date.now()) throw new HttpError(429, 'two_factor_locked', 'Too many wrong codes. Please try again in a few minutes.');
    const fail = async () => {
      const attempts = (tf.failedAttempts ?? 0) + 1;
      await User.updateOne({ _id: u._id }, { $set: attempts >= MFA_MAX_FAILS ? { 'twoFactor.failedAttempts': 0, 'twoFactor.lockedUntil': new Date(Date.now() + MFA_LOCK_MS) } : { 'twoFactor.failedAttempts': attempts } });
      throw badRequest('Wrong code. Please check and try again.', 'two_factor_wrong');
    };
    const ok = async () => { await User.updateOne({ _id: u._id }, { $set: { 'twoFactor.failedAttempts': 0 }, $unset: { 'twoFactor.lockedUntil': '' } }); };
    const code = String(input).trim();
    if (/^\d{6}$/.test(code)) {
      const secret = decryptJson(config.encryptionKey, tf.secretEnc).s;
      const step = verifyTotp(secret, code, { lastStep: tf.lastStep ?? 0 });
      if (step == null) return fail();
      // atomic: only the first request to use this step wins (blocks replay)
      const r = await User.updateOne({ _id: u._id, $or: [{ 'twoFactor.lastStep': { $lt: step } }, { 'twoFactor.lastStep': { $exists: false } }] }, { $set: { 'twoFactor.lastStep': step } });
      if (!r.modifiedCount) return fail();
      return ok();
    }
    const h = backupHash(u, code);
    if (!(tf.backupCodes ?? []).includes(h)) return fail();
    const r = await User.updateOne({ _id: u._id, 'twoFactor.backupCodes': h }, { $pull: { 'twoFactor.backupCodes': h } }); // single use
    if (!r.modifiedCount) return fail();
    return ok();
  }
  const finishLogin = async (u, res) => {
    u.lastLoginAt = new Date(); await u.save();
    res.cookie(SESSION_COOKIE, signSession(config, u._id), sessionCookieOptions(config));
    res.json({ user: await view(u) });
  };

  const smsDown = (e, what) => { console.error('[sms]', e.message); return new HttpError(502, 'sms_failed', config.isProd ? `We could not ${what} the code. Please try again.` : `We could not ${what} the code. ${e.message}`); };

  // Shared tail of every successful phone check: find or create the account, then start the session (or ask for the 2nd factor).
  async function signInPhone(ph, name, res) {
    let user = await User.findOne({ phone: ph });
    if (user?.isSuspended) throw new HttpError(403, 'suspended', 'This account is suspended');
    const isAdminPhone = config.adminPhones.includes(ph);
    if (!user) user = await User.create({ phone: ph, name: name ?? (isAdminPhone ? 'Admin' : ''), ...(isAdminPhone ? { roles: ['customer', 'admin'] } : {}) });
    else if (!user.name && name) { user.name = name; await user.save(); }
    // the allow-listed admin numbers always keep the admin role
    if (isAdminPhone && !user.roles.includes('admin')) { user.roles = [...new Set([...user.roles, 'customer', 'admin'])]; if (!user.name) user.name = 'Admin'; await user.save(); }
    // Step 2 of 2: accounts with two-factor on get NO session yet — only a 5-minute challenge to present with the app code.
    if (user.twoFactor?.enabled) return res.json({ twoFactorRequired: true, challenge: signMfaChallenge(config, user._id) });
    await finishLogin(user, res);
  }

  const otpRequest = async (req, res) => {
    const { phone: ph } = req.body; const now = Date.now();
    const th = await OtpThrottle.findOne({ phone: ph });
    if (th && now - th.lastSentAt.getTime() < RESEND_GAP) throw new HttpError(429, 'otp_too_soon', `Please wait ${Math.ceil((RESEND_GAP - (now - th.lastSentAt.getTime())) / 1000)} seconds before asking for a new code`);
    const freshWindow = !th || now - th.windowStart.getTime() > 3600_000;
    if (!freshWindow && th.sendCount >= MAX_SENDS_PER_HOUR) throw new HttpError(429, 'otp_limit', 'Too many codes requested. Try again in an hour.');
    // MSG91 widget mode (managed): MSG91 makes and sends the code and gives back a request id that belongs to THIS phone number.
    let managed = Boolean(sms.managed);
    let code = managed ? '' : randomOtp();
    let reqId = '';
    let smsFailed = false;
    if (managed) {
      try { ({ reqId } = await sms.sendOtp(ph)); }
      catch (e) {
        // development only: MSG91 refused, so make our own code and show it on screen (OTP_DEV_ECHO=true) instead of blocking the login
        if (config.OTP_DEV_ECHO && !config.isProd) { console.error('[sms]', e.message); managed = false; code = randomOtp(); smsFailed = true; }
        else throw smsDown(e, 'send');
      }
    }
    // a new code replaces any earlier one for this number; it lives OTP_TTL_MIN minutes, then MongoDB deletes it
    await OtpChallenge.findOneAndUpdate({ phone: ph }, { $set: { codeHash: managed ? 'managed' : codeHash(ph, code), reqId, expiresAt: new Date(now + OTP_TTL), attempts: 0 } }, { upsert: true });
    await OtpThrottle.findOneAndUpdate({ phone: ph }, { $set: { sendCount: freshWindow ? 1 : th.sendCount + 1, windowStart: freshWindow ? new Date(now) : th.windowStart, lastSentAt: new Date(now), expiresAt: new Date(now + 3600_000) } }, { upsert: true });
    if (managed) return res.json({ ok: true });
    if (!smsFailed) {
      try { await sms.send(ph, `Your Upahars verification code is ${code}. It expires in ${OTP_TTL_MIN} minutes.`, code); } catch (e) {
        console.error('[sms]', e.message);
        // development: if the SMS provider rejects the message, still let the person log in with the on-screen code
        if (config.OTP_DEV_ECHO && !config.isProd) smsFailed = true; else throw smsDown(e, 'send');
      }
    }
    res.json({ ok: true, ...(config.OTP_DEV_ECHO && !config.isProd ? { devCode: code } : {}), ...(smsFailed ? { smsFailed: true } : {}) });
  };
  r.post('/auth/otp/request', limits.otp, validate(z.object({ phone }).strict()), asyncHandler(otpRequest));

  const otpVerify = async (req, res) => {
    const { phone: ph, code, name } = req.body;
    const ch = await OtpChallenge.findOne({ phone: ph });
    if (!ch || ch.expiresAt.getTime() < Date.now()) throw badRequest('That code has expired. Please request a new one.', 'otp_expired');
    if (ch.attempts >= MAX_ATTEMPTS) { await ch.deleteOne(); throw badRequest('Too many wrong attempts. Please request a new code.', 'otp_locked'); }
    let good;
    if (sms.managed && ch.codeHash === 'managed') { try { good = await sms.verifyOtp(ph, ch.reqId, code); } catch (e) { throw smsDown(e, 'check'); } }
    else good = safeEqual(codeHash(ph, code), ch.codeHash);
    if (!good) {
      await OtpChallenge.updateOne({ _id: ch._id }, { $inc: { attempts: 1 } });
      throw badRequest('Wrong code. Please check and try again.', 'otp_wrong');
    }
    await ch.deleteOne(); // single use
    await signInPhone(ph, name, res);
  };
  r.post('/auth/otp/verify', limits.otp, validate(z.object({ phone, code: z.string().regex(/^\d{4,8}$/), name: z.string().trim().min(2).max(80).optional() }).strict()), asyncHandler(otpVerify));

  // ── separate ADMIN sign-in (used by /admin/login) ──
  // Only an allow-listed number (ADMIN_PHONES) or an existing administrator can get a code here; nobody else can create an account through these two endpoints.
  const isAdminNumber = async (ph) => config.adminPhones.includes(ph) || Boolean(await User.exists({ phone: ph, roles: 'admin', isSuspended: { $ne: true } }));
  r.post('/auth/admin/otp/request', limits.otp, validate(z.object({ phone }).strict()), asyncHandler(async (req, res) => {
    // same answer for everybody, so the page never reveals which numbers are administrators
    if (!(await isAdminNumber(req.body.phone))) return res.json({ ok: true });
    return otpRequest(req, res);
  }));
  r.post('/auth/admin/otp/verify', limits.otp, validate(z.object({ phone, code: z.string().regex(/^\d{4,8}$/) }).strict()), asyncHandler(async (req, res) => {
    if (!(await isAdminNumber(req.body.phone))) throw badRequest('That code has expired. Please request a new one.', 'otp_expired');
    return otpVerify(req, res);
  }));

  r.post('/auth/2fa/login', limits.twofa, validate(z.object({ challenge: z.string().min(20).max(1000), code: secondFactorCode }).strict()), asyncHandler(async (req, res) => {
    const id = verifyMfaChallenge(config, req.body.challenge);
    const user = id && await User.findById(id);
    if (!user || !user.twoFactor?.enabled) throw badRequest('Your sign-in expired. Please start again.', 'challenge_expired');
    if (user.isSuspended) throw new HttpError(403, 'suspended', 'This account is suspended');
    await checkSecondFactor(user, req.body.code);
    await finishLogin(user, res);
  }));

  // ── manage two-factor (signed-in users) ──
  r.post('/auth/2fa/setup', limits.twofa, requireAuth, validate(z.object({}).strict()), asyncHandler(async (req, res) => {
    if (req.user.twoFactor?.enabled) throw new HttpError(409, 'two_factor_already_on', 'Two-factor authentication is already on');
    const secret = generateSecret();
    await User.updateOne({ _id: req.user._id }, { $set: { 'twoFactor.pendingSecretEnc': encryptJson(config.encryptionKey, { s: secret }) } });
    res.json({ secret, otpauthUri: otpauthUri({ secret, account: req.user.phone }) });
  }));

  r.post('/auth/2fa/enable', limits.twofa, requireAuth, validate(z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your app') }).strict()), asyncHandler(async (req, res) => {
    const u = req.user;
    if (u.twoFactor?.enabled) throw new HttpError(409, 'two_factor_already_on', 'Two-factor authentication is already on');
    if (!u.twoFactor?.pendingSecretEnc) throw badRequest('Start the setup again to get a new key.', 'two_factor_not_started');
    if (u.twoFactor.lockedUntil && u.twoFactor.lockedUntil.getTime() > Date.now()) throw new HttpError(429, 'two_factor_locked', 'Too many wrong codes. Please try again in a few minutes.');
    const secret = decryptJson(config.encryptionKey, u.twoFactor.pendingSecretEnc).s;
    const step = verifyTotp(secret, req.body.code);
    if (step == null) {
      const attempts = (u.twoFactor.failedAttempts ?? 0) + 1;
      await User.updateOne({ _id: u._id }, { $set: attempts >= MFA_MAX_FAILS ? { 'twoFactor.failedAttempts': 0, 'twoFactor.lockedUntil': new Date(Date.now() + MFA_LOCK_MS) } : { 'twoFactor.failedAttempts': attempts } });
      throw badRequest('Wrong code. Check the key in your app and try again.', 'two_factor_wrong');
    }
    const codes = newBackupCodes();
    await User.updateOne({ _id: u._id }, { $set: { twoFactor: { enabled: true, secretEnc: u.twoFactor.pendingSecretEnc, pendingSecretEnc: '', lastStep: step, backupCodes: codes.map((c) => backupHash(u, c)), failedAttempts: 0, enabledAt: new Date() } } });
    res.json({ backupCodes: codes, user: await view(await User.findById(u._id)) }); // the codes are shown ONCE
  }));

  r.post('/auth/2fa/backup-codes', limits.twofa, requireAuth, validate(z.object({ code: secondFactorCode }).strict()), asyncHandler(async (req, res) => {
    if (!req.user.twoFactor?.enabled) throw badRequest('Two-factor authentication is not on.', 'two_factor_off');
    await checkSecondFactor(req.user, req.body.code);
    const codes = newBackupCodes();
    await User.updateOne({ _id: req.user._id }, { $set: { 'twoFactor.backupCodes': codes.map((c) => backupHash(req.user, c)) } });
    res.json({ backupCodes: codes });
  }));

  r.post('/auth/2fa/disable', limits.twofa, requireAuth, validate(z.object({ code: secondFactorCode }).strict()), asyncHandler(async (req, res) => {
    const u = req.user;
    if (!u.twoFactor?.enabled) throw badRequest('Two-factor authentication is not on.', 'two_factor_off');
    if (config.requireAdmin2fa && u.roles.includes('admin')) throw forbidden('Administrators must keep two-factor authentication on');
    await checkSecondFactor(u, req.body.code);
    await User.updateOne({ _id: u._id }, { $set: { twoFactor: { enabled: false, secretEnc: '', pendingSecretEnc: '', lastStep: 0, backupCodes: [], failedAttempts: 0 } } });
    res.json({ user: await view(await User.findById(u._id)) });
  }));

  r.post('/auth/logout', (req, res) => { res.clearCookie(SESSION_COOKIE, { path: '/' }); res.json({ ok: true }); });

  r.get('/me', requireAuth, asyncHandler(async (req, res) => res.json({ user: await view(req.user) })));
  r.patch('/me', requireAuth, validate(z.object({ name: z.string().trim().min(2).max(80).optional(), email: z.string().trim().toLowerCase().email().max(120).or(z.literal('')).optional() }).strict()), asyncHandler(async (req, res) => {
    Object.assign(req.user, req.body); await req.user.save(); res.json({ user: await view(req.user) });
  }));
  return r;
}
