import { describe, expect, it } from 'vitest';
import { decrypt, encrypt } from '../src/lib/crypto';

describe('crypto (AES-256-GCM)', () => {
  it('round-trips a value', () => {
    const secret = 'EAABsbCS1234PageAccessToken|ปลอดภัย';
    expect(decrypt(encrypt(secret))).toBe(secret);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    expect(encrypt('same-value')).not.toBe(encrypt('same-value'));
  });

  it('rejects tampered payloads', () => {
    const encoded = encrypt('token');
    const buf = Buffer.from(encoded, 'base64');
    buf[buf.length - 1] ^= 0xff;
    expect(() => decrypt(buf.toString('base64'))).toThrow();
  });

  it('rejects payloads that are too short', () => {
    expect(() => decrypt(Buffer.from('short').toString('base64'))).toThrow('Invalid encrypted payload');
  });
});
