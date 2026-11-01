import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, generateSecret, hotp, otpauthUri, totpAt, verifyTotp } from '../src/lib/totp.js';
import { loadEnvFile } from '../src/lib/loadEnv.js';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const RFC = base32Encode(Buffer.from('12345678901234567890'));
describe('TOTP (RFC 6238)', () => {
  it('matches the RFC test vectors', () => {
    expect(hotp(RFC, 1, 8)).toBe('94287082');          // t = 59
    expect(hotp(RFC, 37037036, 8)).toBe('07081804');   // t = 1111111109
    expect(hotp(RFC, 37037037, 8)).toBe('14050471');   // t = 1111111113
  });
  it('base32 round-trips', () => { const s = generateSecret(); expect(base32Encode(base32Decode(s))).toBe(s); expect(s).toHaveLength(32); });
  it('accepts the current code and ±1 step, rejects further drift and bad input', () => {
    const t = 1_700_000_000_000;
    expect(verifyTotp(RFC, totpAt(RFC, t), { ms: t })).not.toBeNull();
    expect(verifyTotp(RFC, totpAt(RFC, t - 30_000), { ms: t })).not.toBeNull();
    expect(verifyTotp(RFC, totpAt(RFC, t - 90_000), { ms: t })).toBeNull();
    expect(verifyTotp(RFC, 'abcdef', { ms: t })).toBeNull();
  });
  it('refuses a step that was already used', () => {
    const t = 1_700_000_000_000; const step = verifyTotp(RFC, totpAt(RFC, t), { ms: t });
    expect(verifyTotp(RFC, totpAt(RFC, t), { ms: t, lastStep: step })).toBeNull();
  });
  it('builds an otpauth link authenticator apps understand', () => {
    const u = otpauthUri({ secret: RFC, account: '9876543210' });
    expect(u).toMatch(/^otpauth:\/\/totp\/Upahars%3A9876543210\?secret=/); expect(u).toContain('issuer=Upahars');
  });
});
describe('.env loader', () => {
  it('reads values, skips comments, and never overrides real environment variables', () => {
    const f = join(mkdtempSync(join(tmpdir(), 'env-')), '.env');
    writeFileSync(f, '# c\nA=1\nB="two words"  \nC=3   # note\nEXISTING=file\n');
    const env = { EXISTING: 'real' }; loadEnvFile(f, env);
    expect(env).toEqual({ EXISTING: 'real', A: '1', B: 'two words', C: '3' });
  });
});
