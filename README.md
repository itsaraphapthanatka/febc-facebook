# febc-facebook

Middleware สำหรับจัดการ Facebook Page ผ่าน Graph API:

- **เชื่อมต่อ Page** ผ่าน Facebook OAuth → เก็บ page access token (เข้ารหัส AES-256-GCM) + รับ Webhooks (`feed`, `messages`)
- **Broadcast** — โพสต์เนื้อหาเดียวกันไปหลาย Page พร้อมกัน และส่งข้อความ Messenger ถึงคนที่เคยทักแชท Page
- **LLM auto-post** — OpenAI สร้างเนื้อหาโพสต์จาก prompt template แล้วโพสต์อัตโนมัติตาม cron schedule

> **ข้อจำกัดของ Facebook:** Graph API **ไม่รองรับการสร้าง Page ใหม่** — ต้องสร้าง Page ผ่านหน้าเว็บ Facebook แล้วนำมาเชื่อมต่อกับ middleware นี้ผ่าน OAuth

**Stack:** Node.js 20 + TypeScript, Fastify, Drizzle ORM + PostgreSQL, node-cron, OpenAI SDK, Zod
**UI:** Dashboard เว็บ (static, ไม่มี build step) เสิร์ฟจากตัว server เดียวกันที่ `/`

## Dashboard UI

เปิดเบราว์เซอร์ไปที่ root ของ server (`{BASE_URL}` หรือ `http://127.0.0.1:3900`) จะเจอหน้า **FEBC Facebook Console**:

1. หน้า login — ใส่ค่า `ADMIN_API_KEY` (ตัวเดียวกับใน `.env`) → คีย์ถูกเก็บใน localStorage ของเบราว์เซอร์และแนบเป็น Bearer token ทุก request
2. เมนูใช้งาน:
   - **ภาพรวม** — สรุปจำนวนเพจ/ตาราง/โพสต์/ผู้ทักแชท
   - **เพจ** — เชื่อมต่อเพจใหม่ (ปุ่มไป OAuth), สมัคร/ยกเลิก Webhook, พัก/เปิดใช้งาน, ลบ
   - **Broadcast** — ฟอร์มโพสต์ลงหลายเพจ + ส่ง Messenger (เลือก tag ได้)
   - **ตั้งเวลาโพสต์ (AI)** — สร้าง/แก้ไขตาราง cron + prompt, พรีวิวเนื้อหา AI, สั่งรันทันที
   - **ประวัติ** — โพสต์ที่ผ่านมา (ลิงก์ไปโพสต์จริง) + รายชื่อผู้ทักแชท Messenger

UI เป็นไฟล์ static ในโฟลเดอร์ [web/](web/) — แก้ไขแล้ว refresh เบราว์เซอร์ได้เลย ไม่ต้อง build

## เริ่มต้นใช้งาน

```bash
npm install
copy .env.example .env        # แล้วแก้ค่าตามด้านล่าง
docker compose up -d          # PostgreSQL (host port 5434)
npm run db:migrate
npm run dev                   # http://127.0.0.1:3900 (ค่า PORT ใน .env)
```

> **หมายเหตุเครื่อง dev นี้:** พอร์ต 3000/5432/5433 มีแอปอื่นใช้อยู่แล้ว โปรเจกต์นี้จึงใช้ **PORT=3900** และ Postgres ที่ **5434** — ตอนทดสอบให้เรียก `127.0.0.1` ตรงๆ (มีแอปอื่น bind `[::1]` ทำให้ `localhost` อาจวิ่งผิดแอป) และเปิด tunnel ด้วย `ngrok http 127.0.0.1:3900`

### สร้างค่า secret

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"   # ADMIN_API_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # ENCRYPTION_KEY
```

## ตั้งค่า Facebook App

1. สร้าง App ประเภท **Business** ที่ [developers.facebook.com](https://developers.facebook.com) → จด `FB_APP_ID`, `FB_APP_SECRET`
2. เพิ่ม products: **Facebook Login**, **Webhooks**, **Messenger**
3. เปิด tunnel: `ngrok http 127.0.0.1:3900` → นำ URL ไปใส่ `BASE_URL` ใน `.env`
4. **Facebook Login → Settings:** เพิ่ม Valid OAuth Redirect URI = `{BASE_URL}/auth/facebook/callback`
5. **Webhooks:** subscribe object `Page`, callback URL = `{BASE_URL}/webhooks/facebook`, verify token = ค่า `FB_WEBHOOK_VERIFY_TOKEN`, เลือก fields `feed`, `messages`
6. แนะนำเปิด **Settings → Advanced → Require App Secret** (โค้ดแนบ `appsecret_proof` ทุก call อยู่แล้ว)
7. บัญชีที่เป็น admin/developer/tester ของ App ใช้ได้ทันที — เปิดให้ผู้ใช้ทั่วไปต้องผ่าน App Review + Business Verification

## Flow การใช้งาน

```
1) เปิด browser → GET /auth/facebook
   → login + อนุญาต scopes → ระบบเก็บ user token (long-lived ~60 วัน) + page tokens (ไม่หมดอายุ)

2) POST /api/pages/:id/subscribe
   → ติดตั้ง webhook บน Page (feed, messages) — เมื่อมีคนทักแชท ระบบจะเก็บ PSID ไว้เป็นกลุ่มเป้าหมาย broadcast

3) POST /api/broadcasts/feed | /api/broadcasts/messenger  → broadcast ทันที
   POST /api/schedules                                    → ตั้ง LLM auto-post ตาม cron
```

## API

ทุก endpoint ใต้ `/api/*` ต้องส่ง header `Authorization: Bearer {ADMIN_API_KEY}`

| Method | Path | คำอธิบาย |
|---|---|---|
| GET | `/auth/facebook` | เริ่ม OAuth (เปิดใน browser) |
| GET | `/api/pages` | รายชื่อ Page ที่เชื่อมต่อ |
| POST | `/api/pages/refresh` | ดึงรายชื่อ Page จาก Facebook ใหม่ |
| POST/DELETE | `/api/pages/:id/subscribe` | เปิด/ปิด webhook ของ Page |
| POST | `/api/pages/:id/cover` | เปลี่ยนรูปหน้าปก — รับ `{ imageUrl }` (JSON) หรือ **อัปโหลดไฟล์** (multipart field `image`) |
| POST | `/api/pages/:id/profile-picture` | เปลี่ยนรูปโปรไฟล์ — `{ imageUrl }` หรืออัปโหลดไฟล์ (multipart `image`) |
| PATCH | `/api/pages/:id` | `{ "isActive": false }` พัก Page |
| POST | `/api/broadcasts/feed` | `{ message, link?, imageUrl?, pageIds[] }` (JSON) หรืออัปโหลดไฟล์รูป (multipart: `message`, `pageIds`, `image`) |
| POST | `/api/broadcasts/messenger` | `{ message, pageIds[], messageTag?, onlyWithin24h? }` |
| GET | `/api/broadcasts/:id` | สถานะ broadcast รายเป้าหมาย |
| POST | `/api/schedules` | สร้าง schedule (ดูตัวอย่างด้านล่าง) |
| POST | `/api/schedules/:id/preview` | ให้ OpenAI generate โดยไม่โพสต์ |
| POST | `/api/schedules/:id/run` | สั่งรันทันที |
| GET | `/api/posts?pageId=&source=` | ประวัติโพสต์ |
| GET | `/api/messenger/recipients?pageId=` | รายชื่อผู้ทักแชท |
| GET | `/webhooks/facebook` | Facebook verification handshake (public) |
| POST | `/webhooks/facebook` | รับ event (ตรวจ `X-Hub-Signature-256`) |
| GET | `/healthz` | health check + DB ping |

### ตัวอย่าง: สร้าง schedule auto-post

```bash
curl -X POST http://127.0.0.1:3900/api/schedules \
  -H "Authorization: Bearer $ADMIN_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "name": "โพสต์เช้าทุกวัน",
    "cronExpression": "0 8 * * *",
    "promptTemplate": "เขียนโพสต์ให้กำลังใจสั้นๆ หัวข้อ {{topic}} สำหรับวันที่ {{date}}",
    "topics": ["ความหวัง", "กำลังใจ", "ครอบครัว"],
    "targetPageIds": ["<uuid จาก GET /api/pages>"]
  }'
```

- `{{topic}}` หมุนเวียนจาก `topics` แบบ round-robin ทุกครั้งที่รัน, `{{date}}` = วันที่ปัจจุบัน (timezone จาก `SCHEDULER_TIMEZONE`)
- **เลือก LLM ได้:** ตั้ง `OPENAI_BASE_URL` ใน `.env` เพื่อชี้ไป endpoint ที่ OpenAI-compatible เช่น gateway `https://consoletoken.aunjai.org/api/v1` (model `gemma-4-12b`) หรือปล่อยว่างเพื่อใช้ api.openai.com — และ override model รายตัวได้ด้วย field `model` ของแต่ละ schedule
- ประวัติการรันดูได้ที่ `GET /api/schedules/:id` (`recentRuns`) และโพสต์ที่ `GET /api/posts?source=schedule`
- โพสต์ที่ล้มเหลวจาก error ชั่วคราว (rate limit ฯลฯ) จะถูก retry อัตโนมัติทุก 5 นาที สูงสุด 3 ครั้ง

### ข้อควรรู้เรื่อง Messenger broadcast

- โดยปกติ Facebook ให้ส่งข้อความได้เฉพาะภายใน **24 ชั่วโมง** หลังจาก user ทักมาล่าสุด — ระบบกรองผู้รับตามเงื่อนไขนี้อัตโนมัติ
- ส่งนอก 24h window ต้องระบุ `messageTag` (`ACCOUNT_UPDATE`, `CONFIRMED_EVENT_UPDATE`, `POST_PURCHASE_UPDATE`) และ **ห้ามใช้กับเนื้อหาโปรโมท/โฆษณา** — ผิด Facebook policy อาจโดนแบน
- ระบบเก็บรายชื่อผู้รับ (PSID) จาก webhook `messages` — Page ต้อง subscribe webhook ก่อนจึงจะเริ่มสะสมรายชื่อ

## ความปลอดภัย

- Token ทุกตัวเข้ารหัส AES-256-GCM ก่อนลง DB และไม่ถูกส่งออกทาง API
- ทุก Graph call แนบ `appsecret_proof`; webhook ตรวจ HMAC ของ raw body ด้วย `timingSafeEqual`
- OAuth มี CSRF `state`; admin key เทียบแบบ constant-time; มี helmet + rate limit

## คำสั่งที่ใช้บ่อย

```bash
npm run dev          # dev server (auto-reload)
npm test             # vitest (20 tests)
npm run typecheck    # tsc --noEmit
npm run db:generate  # สร้าง migration ใหม่หลังแก้ src/db/schema.ts
npm run db:migrate   # apply migrations
npm run build && npm start   # production
```
