import { createHmac } from 'crypto';
import { env } from '../env';
import { FacebookApiError } from '../lib/errors';

const GRAPH_BASE = 'https://graph.facebook.com';

/** HMAC-SHA256 of the access token with the app secret — required on every server-side Graph call. */
export function appSecretProof(accessToken: string): string {
  return createHmac('sha256', env.FB_APP_SECRET).update(accessToken).digest('hex');
}

function buildUrl(path: string, accessToken: string | null, params: Record<string, string> = {}): string {
  const url = new URL(`${GRAPH_BASE}/${env.FB_GRAPH_VERSION}/${path.replace(/^\//, '')}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (accessToken) {
    url.searchParams.set('access_token', accessToken);
    url.searchParams.set('appsecret_proof', appSecretProof(accessToken));
  }
  return url.toString();
}

async function parseResponse<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || (body && typeof body === 'object' && 'error' in body)) {
    const fbError = (body as { error?: { message: string; type?: string; code?: number; error_subcode?: number } })
      .error ?? { message: `HTTP ${res.status}` };
    throw new FacebookApiError(fbError, res.status);
  }
  return body as T;
}

export async function graphGet<T>(
  path: string,
  accessToken: string | null,
  params: Record<string, string> = {},
): Promise<T> {
  const res = await fetch(buildUrl(path, accessToken, params));
  return parseResponse<T>(res);
}

export async function graphPost<T>(
  path: string,
  accessToken: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(buildUrl(path, accessToken), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseResponse<T>(res);
}

export async function graphDelete<T>(
  path: string,
  accessToken: string,
  params: Record<string, string> = {},
): Promise<T> {
  const res = await fetch(buildUrl(path, accessToken, params), { method: 'DELETE' });
  return parseResponse<T>(res);
}

export interface UploadFile {
  buffer: Buffer;
  filename: string;
  mimetype: string;
}

/** Multipart POST — sends a binary file directly to Facebook (avoids Facebook having to fetch a URL). */
export async function graphPostForm<T>(
  path: string,
  accessToken: string,
  fields: Record<string, string> = {},
  file?: UploadFile,
): Promise<T> {
  const form = new FormData();
  form.set('access_token', accessToken);
  form.set('appsecret_proof', appSecretProof(accessToken));
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  if (file) {
    form.set('source', new Blob([file.buffer], { type: file.mimetype }), file.filename);
  }
  const url = `${GRAPH_BASE}/${env.FB_GRAPH_VERSION}/${path.replace(/^\//, '')}`;
  const res = await fetch(url, { method: 'POST', body: form });
  return parseResponse<T>(res);
}

/** Follows `paging.next` and returns all data entries. */
export async function graphGetAll<T>(
  path: string,
  accessToken: string,
  params: Record<string, string> = {},
  maxPages = 10,
): Promise<T[]> {
  const results: T[] = [];
  let url: string | null = buildUrl(path, accessToken, { limit: '100', ...params });
  for (let i = 0; i < maxPages && url; i++) {
    const res = await fetch(url);
    const body = await parseResponse<{ data: T[]; paging?: { next?: string } }>(res);
    results.push(...(body.data ?? []));
    url = body.paging?.next ?? null;
  }
  return results;
}
