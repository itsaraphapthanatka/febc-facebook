import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/client';
import { messengerRecipients } from '../../db/schema';
import { env } from '../../env';

// ---- Edit these to your real organisation details before submitting to Facebook ----
const ORG_NAME = 'FEBC';
const CONTACT_EMAIL = 'support@example.com';
const LAST_UPDATED = '10 กรกฎาคม 2026';

function page(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="th"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#000; color:#c2c2c2; font-family:"Segoe UI","Leelawadee UI","Noto Sans Thai",system-ui,sans-serif; line-height:1.7; }
  .stripe { height:4px; background:linear-gradient(90deg,#0066b1 0 33.334%,#1c69d4 33.334% 66.667%,#e22718 66.667% 100%); }
  .wrap { max-width:760px; margin:0 auto; padding:48px 24px 80px; }
  h1 { color:#fff; font-size:28px; margin:0 0 6px; }
  h2 { color:#fff; font-size:19px; margin:32px 0 10px; }
  .meta { color:#8a8a8a; font-size:13px; margin-bottom:24px; }
  p, li { font-size:15px; }
  a { color:#4a9eff; }
  code { background:#1a1a1a; padding:2px 6px; border-radius:4px; color:#e6e6e6; font-size:13px; }
  .box { background:#0d0d0d; border:1px solid #333; padding:16px 18px; margin:16px 0; }
</style>
</head><body><div class="stripe"></div><div class="wrap">${bodyHtml}
<p class="meta" style="margin-top:40px">${ORG_NAME} · ปรับปรุงล่าสุด ${LAST_UPDATED} · ติดต่อ: ${CONTACT_EMAIL}</p>
</div></body></html>`;
}

/** Verifies a Facebook signed_request and returns its payload, or null if invalid. */
function parseSignedRequest(signedRequest: string): { user_id?: string } | null {
  const [encodedSig, encodedPayload] = signedRequest.split('.');
  if (!encodedSig || !encodedPayload) return null;
  const b64 = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const expected = createHmac('sha256', env.FB_APP_SECRET).update(encodedPayload).digest();
  const received = b64(encodedSig);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    return JSON.parse(b64(encodedPayload).toString('utf8'));
  } catch {
    return null;
  }
}

/** Removes the personal data we hold for a given Facebook user id (PSID). */
async function deleteUserData(userId: string): Promise<void> {
  await db.delete(messengerRecipients).where(eq(messengerRecipients.psid, userId));
}

export async function legalRoutes(app: FastifyInstance) {
  app.get('/privacy', async (_req, reply) => {
    reply.type('text/html').send(
      page(
        'นโยบายความเป็นส่วนตัว',
        `<h1>นโยบายความเป็นส่วนตัว</h1>
<p class="meta">Facebook Page Management Console (${ORG_NAME})</p>
<p>บริการนี้เป็นเครื่องมือช่วยจัดการเพจ Facebook — โพสต์เนื้อหา, ส่งข้อความ Broadcast ผ่าน Messenger และตั้งเวลาโพสต์อัตโนมัติ เอกสารนี้อธิบายว่าเราเก็บและใช้ข้อมูลอะไรบ้าง</p>

<h2>ข้อมูลที่เราเก็บ</h2>
<ul>
  <li><b>ข้อมูลเพจและ Access Token</b> — ที่คุณอนุญาตให้เชื่อมต่อ เพื่อโพสต์และส่งข้อความในนามเพจ (token ถูกเข้ารหัสก่อนจัดเก็บ)</li>
  <li><b>ข้อมูลผู้ที่ทักแชทเพจ</b> — รหัสผู้ใช้เฉพาะเพจ (PSID) และเวลาที่ทักล่าสุด เพื่อให้ส่งข้อความตอบกลับ/Broadcast ได้ตามนโยบาย 24 ชั่วโมงของ Facebook</li>
  <li><b>เนื้อหาที่คุณสร้าง</b> — ข้อความและรูปภาพที่โพสต์หรือส่ง รวมถึงประวัติการส่ง</li>
</ul>

<h2>วิธีที่เราใช้ข้อมูล</h2>
<ul>
  <li>เพื่อเผยแพร่โพสต์และส่งข้อความในนามเพจของคุณตามที่คุณสั่ง</li>
  <li>เพื่อแสดงสถานะ/ประวัติการทำงานในหน้าจัดการ</li>
  <li>เราไม่ขายข้อมูล และไม่ใช้ข้อมูลเพื่อการโฆษณาข้ามบริการ</li>
</ul>

<h2>การเก็บรักษาและลบข้อมูล</h2>
<p>ข้อมูลถูกเก็บไว้ตราบเท่าที่จำเป็นต่อการให้บริการ รูปภาพชั่วคราวของ Broadcast จะถูกลบอัตโนมัติภายใน 24 ชั่วโมง คุณสามารถถอนการเชื่อมต่อเพจได้ทุกเมื่อ ซึ่งจะลบ token และข้อมูลเพจที่เกี่ยวข้อง</p>
<p>ดูวิธีขอลบข้อมูลได้ที่ <a href="/data-deletion">หน้าการลบข้อมูล</a></p>

<h2>บริการของบุคคลที่สาม</h2>
<p>เราใช้ Facebook Graph API สำหรับการจัดการเพจ การใช้งานอยู่ภายใต้ <a href="https://www.facebook.com/policy.php" target="_blank" rel="noopener">นโยบายของ Meta</a> ด้วย</p>

<h2>ติดต่อเรา</h2>
<p>หากมีคำถามเกี่ยวกับความเป็นส่วนตัว ติดต่อได้ที่ <code>${CONTACT_EMAIL}</code></p>`,
      ),
    );
  });

  // Human-readable data-deletion page. Also serves as the status page the callback points to.
  app.get('/data-deletion', async (req, reply) => {
    const code = (req.query as { code?: string })?.code;
    const status = code
      ? `<div class="box">สถานะคำขอลบข้อมูล — รหัสอ้างอิง: <code>${String(code).replace(/[^a-zA-Z0-9]/g, '')}</code><br />คำขอของคุณได้รับการดำเนินการแล้ว ข้อมูลส่วนบุคคลที่เกี่ยวข้องถูกลบออกจากระบบ</div>`
      : '';
    reply.type('text/html').send(
      page(
        'การลบข้อมูล',
        `<h1>การลบข้อมูลผู้ใช้</h1>
<p>คุณสามารถขอให้ลบข้อมูลส่วนบุคคลที่ระบบนี้จัดเก็บได้ 2 วิธี</p>
${status}
<h2>วิธีที่ 1 — ผ่าน Facebook</h2>
<p>ไปที่ การตั้งค่า Facebook → แอปและเว็บไซต์ → เลือกแอปนี้ → ลบ เมื่อคุณลบการเชื่อมต่อ Facebook จะส่งคำขอลบข้อมูลมายังระบบของเราโดยอัตโนมัติ และเราจะลบรหัสผู้ใช้ (PSID) กับข้อมูลการโต้ตอบที่เกี่ยวข้อง</p>
<h2>วิธีที่ 2 — ติดต่อเราโดยตรง</h2>
<p>ส่งอีเมลมาที่ <code>${CONTACT_EMAIL}</code> พร้อมระบุเพจ/บัญชีที่เกี่ยวข้อง เราจะลบข้อมูลให้ภายใน 30 วัน</p>`,
      ),
    );
  });

  // Facebook Data Deletion Request Callback: verifies the signed request, deletes the
  // user's data, and returns the status URL + tracking code Facebook expects.
  app.post('/data-deletion', async (req, reply) => {
    let signedRequest: string | undefined;
    const body = req.body as unknown;
    if (Buffer.isBuffer(body)) {
      signedRequest = new URLSearchParams(body.toString('utf8')).get('signed_request') ?? undefined;
    } else if (body && typeof body === 'object') {
      signedRequest = (body as { signed_request?: string }).signed_request;
    } else if (typeof body === 'string') {
      signedRequest = new URLSearchParams(body).get('signed_request') ?? undefined;
    }

    if (!signedRequest) return reply.code(400).send({ error: 'missing signed_request' });
    const data = parseSignedRequest(signedRequest);
    if (!data?.user_id) return reply.code(400).send({ error: 'invalid signed_request' });

    await deleteUserData(data.user_id);

    const code = randomBytes(8).toString('hex');
    req.log.info({ userId: data.user_id, code }, 'processed data deletion request');
    return reply.send({
      url: `${env.BASE_URL}/data-deletion?code=${code}`,
      confirmation_code: code,
    });
  });
}
