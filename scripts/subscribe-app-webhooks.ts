/**
 * Registers the app-level webhook subscription with Facebook (object=page,
 * fields=feed,messages) pointing at `${BASE_URL}/webhooks/facebook`.
 *
 * Page-level subscribed_apps (done per page on connect) is not enough on its
 * own — the app must also subscribe to the fields here, or Facebook delivers
 * nothing. Re-run this whenever BASE_URL changes (e.g. a new ngrok URL).
 *
 * Usage: npx tsx scripts/subscribe-app-webhooks.ts
 */
import { env } from '../src/env';
import { WEBHOOK_FIELDS } from '../src/facebook/pages';

async function main() {
  const url = `https://graph.facebook.com/${env.FB_GRAPH_VERSION}/${env.FB_APP_ID}/subscriptions`;
  const callbackUrl = `${env.BASE_URL}/webhooks/facebook`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      object: 'page',
      callback_url: callbackUrl,
      fields: WEBHOOK_FIELDS,
      verify_token: env.FB_WEBHOOK_VERIFY_TOKEN,
      access_token: `${env.FB_APP_ID}|${env.FB_APP_SECRET}`,
    }),
  });

  const body = await res.json();
  if (!res.ok) {
    console.error('Subscription failed:', JSON.stringify(body, null, 2));
    process.exit(1);
  }
  console.log('Subscribed:', JSON.stringify(body));
  console.log(`  object:   page`);
  console.log(`  fields:   ${WEBHOOK_FIELDS}`);
  console.log(`  callback: ${callbackUrl}`);

  // Read back to confirm what Facebook now has on file
  const check = await fetch(
    `${url}?access_token=${env.FB_APP_ID}%7C${env.FB_APP_SECRET}`,
  );
  console.log('Current subscriptions:', JSON.stringify(await check.json(), null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
