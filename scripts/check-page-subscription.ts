/**
 * Diagnostic: reads each connected page's token and asks Facebook what the
 * page is actually subscribed to (GET /{page-id}/subscribed_apps). Confirms
 * the page-level half of webhook delivery independent of our own DB flag.
 *
 * Usage: npx tsx scripts/check-page-subscription.ts
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { pages } from '../src/db/schema';
import { env } from '../src/env';
import { decrypt } from '../src/lib/crypto';

async function main() {
  const rows = await db.select().from(pages).where(eq(pages.isActive, true));
  if (rows.length === 0) {
    console.log('No active pages.');
    return;
  }

  for (const page of rows) {
    const token = decrypt(page.pageAccessTokenEnc);
    const url = `https://graph.facebook.com/${env.FB_GRAPH_VERSION}/${page.fbPageId}/subscribed_apps?access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    const body = await res.json();
    console.log(`\nPage: ${page.name} (fbPageId=${page.fbPageId})`);
    console.log(`  db.webhookSubscribed = ${page.webhookSubscribed}`);
    console.log(`  facebook subscribed_apps =`, JSON.stringify(body, null, 2));
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
