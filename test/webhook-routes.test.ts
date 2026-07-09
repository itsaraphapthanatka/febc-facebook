import { createHmac } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('GET /webhooks/facebook (verification handshake)', () => {
  it('echoes hub.challenge for a valid verify token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/webhooks/facebook?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=challenge-123',
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('challenge-123');
  });

  it('returns 403 for a wrong verify token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/webhooks/facebook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=x',
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /webhooks/facebook (signature verification)', () => {
  const body = JSON.stringify({ object: 'page', entry: [] });

  it('rejects an invalid signature with 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/facebook',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=deadbeef' },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a missing signature with 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/facebook',
      headers: { 'content-type': 'application/json' },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts a correctly signed payload', async () => {
    const signature = 'sha256=' + createHmac('sha256', 'test-app-secret').update(body).digest('hex');
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/facebook',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true });
  });
});

describe('admin API key guard', () => {
  it('rejects /api/* without a bearer token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/pages' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects /api/* with a wrong bearer token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/pages',
      headers: { authorization: 'Bearer wrong-key' },
    });
    expect(res.statusCode).toBe(401);
  });
});
