import { env } from '../env';
import { graphGet, graphGetAll } from './graphClient';

export const OAUTH_SCOPES = [
  'pages_show_list',
  'pages_manage_posts',
  'pages_read_engagement',
  'pages_manage_metadata',
  'pages_messaging',
].join(',');

export function redirectUri(): string {
  return `${env.BASE_URL.replace(/\/$/, '')}/auth/facebook/callback`;
}

export function buildLoginUrl(state: string): string {
  const url = new URL(`https://www.facebook.com/${env.FB_GRAPH_VERSION}/dialog/oauth`);
  url.searchParams.set('client_id', env.FB_APP_ID);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('state', state);
  url.searchParams.set('response_type', 'code');
  if (env.FB_LOGIN_CONFIG_ID) {
    url.searchParams.set('config_id', env.FB_LOGIN_CONFIG_ID);
  } else {
    url.searchParams.set('scope', OAUTH_SCOPES);
  }
  return url.toString();
}

interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

export async function exchangeCodeForToken(code: string): Promise<TokenResponse> {
  return graphGet<TokenResponse>('oauth/access_token', null, {
    client_id: env.FB_APP_ID,
    client_secret: env.FB_APP_SECRET,
    redirect_uri: redirectUri(),
    code,
  });
}

/** Short-lived user token → long-lived (~60 days). */
export async function exchangeForLongLivedToken(shortLivedToken: string): Promise<TokenResponse> {
  return graphGet<TokenResponse>('oauth/access_token', null, {
    grant_type: 'fb_exchange_token',
    client_id: env.FB_APP_ID,
    client_secret: env.FB_APP_SECRET,
    fb_exchange_token: shortLivedToken,
  });
}

export interface FbMe {
  id: string;
  name: string;
}

export async function fetchMe(userToken: string): Promise<FbMe> {
  return graphGet<FbMe>('me', userToken, { fields: 'id,name' });
}

export interface FbPageAccount {
  id: string;
  name: string;
  category?: string;
  access_token: string;
}

/** Pages the user administers; page tokens derived from a long-lived user token do not expire. */
export async function fetchPageAccounts(userToken: string): Promise<FbPageAccount[]> {
  return graphGetAll<FbPageAccount>('me/accounts', userToken, {
    fields: 'id,name,category,access_token',
  });
}
