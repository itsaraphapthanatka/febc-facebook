import { createHmac } from 'crypto';
import { describe, expect, it } from 'vitest';
import { verifyWebhookSignature } from '../src/modules/webhooks/service';

const SECRET = 'test-app-secret';

function sign(body: string): string {
  return 'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex');
}

describe('verifyWebhookSignature', () => {
  const body = JSON.stringify({ object: 'page', entry: [] });

  it('accepts a valid signature', () => {
    expect(verifyWebhookSignature(body, sign(body), SECRET)).toBe(true);
  });

  it('rejects a signature computed with the wrong secret', () => {
    const bad = 'sha256=' + createHmac('sha256', 'wrong-secret').update(body).digest('hex');
    expect(verifyWebhookSignature(body, bad, SECRET)).toBe(false);
  });

  it('rejects when the body was modified', () => {
    expect(verifyWebhookSignature(body + 'x', sign(body), SECRET)).toBe(false);
  });

  it('rejects a missing or malformed header', () => {
    expect(verifyWebhookSignature(body, undefined, SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, 'sha1=abc', SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, 'sha256=zzz', SECRET)).toBe(false);
  });
});
