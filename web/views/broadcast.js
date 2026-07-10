import { Endpoints } from '../api.js';
import { el, esc, toast, statusBadge, fmtDate, bindAsync, loadingView, createDropzone, createComposer, confirmDialog, openModal, urlToFile } from '../ui.js';

const MESSAGE_TAGS = ['CONFIRMED_EVENT_UPDATE', 'POST_PURCHASE_UPDATE', 'ACCOUNT_UPDATE'];

export async function renderBroadcast(view) {
  view.innerHTML = '';
  view.appendChild(el(`<div class="page-head"><div>
    <h1>Broadcast</h1><div class="sub">ส่งเนื้อหาไปหลายเพจพร้อมกัน หรือส่งข้อความ Messenger</div>
  </div></div>`));

  const tabs = el(`<div class="tabs">
    <button class="tab active" data-tab="feed">โพสต์ลงเพจ</button>
    <button class="tab" data-tab="messenger">Messenger</button>
  </div>`);
  view.appendChild(tabs);
  const body = el('<div></div>');
  view.appendChild(body);

  const loading = loadingView();
  view.appendChild(loading);
  const pages = (await Endpoints.pages()).filter((p) => p.isActive);
  loading.remove();

  let current = 'feed';
  const draw = () => {
    tabs.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === current));
    body.innerHTML = '';
    body.appendChild(current === 'feed' ? feedForm(pages) : messengerForm(pages));
  };
  tabs.querySelectorAll('.tab').forEach((t) =>
    t.addEventListener('click', () => { current = t.dataset.tab; draw(); }),
  );
  draw();

  view.appendChild(el('<h3 style="margin:26px 0 12px">Broadcast ล่าสุด</h3>'));
  const recent = el('<div class="card table-wrap" data-recent></div>');
  view.appendChild(recent);
  loadRecent(recent);
}

function pageChecklist(pages) {
  if (!pages.length) {
    return el('<div class="muted">ไม่มีเพจที่ใช้งานอยู่ — ไปเชื่อมต่อเพจก่อนที่แท็บ “เพจ”</div>');
  }
  const box = el('<div class="checklist"></div>');
  for (const p of pages) {
    box.appendChild(el(`<label><input type="checkbox" value="${esc(p.id)}" />${esc(p.name)}</label>`));
  }
  return box;
}
function selectedIds(box) {
  return [...box.querySelectorAll('input:checked')].map((i) => i.value);
}

/**
 * A "send now / schedule for later" field. getISO() returns null when empty (send now)
 * or an ISO string; it throws a user-facing message on an invalid or past time so the
 * bindAsync wrapper surfaces it as a toast.
 */
function scheduleField() {
  const wrap = el(`<div class="field">
    <label>ตั้งเวลาส่ง (ไม่บังคับ)</label>
    <div class="desc">เว้นว่าง = ส่งทันที • เลือกวันที่และเวลาเพื่อตั้งส่งล่วงหน้า (ทำงานทุก 1 นาที)</div>
    <div class="sched-row">
      <div>
        <div class="sched-sub">วันที่</div>
        <input type="date" data-sched-date />
      </div>
      <div>
        <div class="sched-sub">เวลา</div>
        <input type="time" data-sched-time />
      </div>
    </div>
  </div>`);
  const dateInput = wrap.querySelector('[data-sched-date]');
  const timeInput = wrap.querySelector('[data-sched-time]');
  return {
    el: wrap,
    getISO() {
      const date = dateInput.value;
      const time = timeInput.value;
      if (!date && !time) return null; // both empty → send now
      if (!date || !time) throw new Error('กรุณาเลือกทั้งวันที่และเวลา');
      const d = new Date(`${date}T${time}`); // interpreted in the browser's local timezone
      if (isNaN(d.getTime())) throw new Error('รูปแบบวันเวลาไม่ถูกต้อง');
      if (d.getTime() <= Date.now()) throw new Error('เวลาที่ตั้งต้องเป็นเวลาในอนาคต');
      return d.toISOString();
    },
    clear() { dateInput.value = ''; timeInput.value = ''; },
  };
}

/** Wraps an AI helper button in a spacing row. */
function aiRow(btn) {
  const row = el('<div class="ai-actions"></div>');
  row.appendChild(btn);
  return row;
}

/** "AI ช่วยคิด" — opens a brief prompt, writes copy into the composer. channel = 'feed' | 'messenger'. */
function aiComposeButton(composer, channel) {
  const btn = el('<button type="button" class="btn sm">✨ AI ช่วยคิด</button>');
  btn.addEventListener('click', () => {
    const body = el(`<div>
      <div class="field" style="margin-bottom:0">
        <label>อยากสื่อเรื่องอะไร? (บรีฟสั้นๆ)</label>
        <div class="desc">พิมพ์หัวข้อหรือใจความ แล้วให้ AI ช่วยเรียบเรียง (ข้อความที่พิมพ์ไว้จะถูกใช้เป็นบรีฟตั้งต้น)</div>
        <textarea data-brief placeholder="เช่น โปรโมชั่นลด 20% เฉพาะสัปดาห์นี้ พูดให้น่าสนใจ ใส่อิโมจิ"></textarea>
      </div>
    </div>`);
    body.querySelector('[data-brief]').value = composer.getValue().trim();
    const foot = el(`<div class="modal-foot">
      <button class="btn" data-cancel>ปิด</button>
      <button class="btn primary" data-gen>✨ สร้างข้อความ</button>
    </div>`);
    const modal = openModal('AI ช่วยคิดข้อความ', body, foot);
    foot.querySelector('[data-cancel]').addEventListener('click', modal.close);
    bindAsync(foot.querySelector('[data-gen]'), async () => {
      const brief = body.querySelector('[data-brief]').value.trim();
      if (!brief) return toast('ใส่บรีฟก่อน', 'err');
      const res = await Endpoints.aiCompose({ brief, channel });
      composer.setValue(res.content);
      toast('AI สร้างข้อความแล้ว', 'ok');
      modal.close();
    });
  });
  return btn;
}

/** "สร้างรูปด้วย AI" — generates an image, previews it, and drops it into the given dropzone. */
export function aiImageButton(dz) {
  const btn = el('<button type="button" class="btn sm">🎨 สร้างรูปด้วย AI</button>');
  btn.addEventListener('click', () => {
    const body = el(`<div>
      <div class="field">
        <label>อธิบายรูปที่ต้องการ</label>
        <div class="desc">ยิ่งบรรยายละเอียดยิ่งตรง — ภาษาไทยหรืออังกฤษก็ได้</div>
        <textarea data-prompt placeholder="เช่น กาแฟลาเต้ร้อนในแก้วเซรามิก บนโต๊ะไม้ แสงเช้า สไตล์มินิมอล"></textarea>
      </div>
      <div class="ai-img-preview" data-preview hidden></div>
    </div>`);
    const foot = el(`<div class="modal-foot">
      <button class="btn" data-cancel>ปิด</button>
      <button class="btn" data-use disabled>ใช้รูปนี้</button>
      <button class="btn primary" data-gen>🎨 สร้างรูป</button>
    </div>`);
    const modal = openModal('สร้างรูปภาพด้วย AI', body, foot);
    foot.querySelector('[data-cancel]').addEventListener('click', modal.close);

    let dataUrl = null;
    const useBtn = foot.querySelector('[data-use]');
    bindAsync(foot.querySelector('[data-gen]'), async () => {
      const prompt = body.querySelector('[data-prompt]').value.trim();
      if (!prompt) return toast('ใส่คำอธิบายรูปก่อน', 'err');
      const res = await Endpoints.aiImage({ prompt });
      dataUrl = res.dataUrl;
      const prev = body.querySelector('[data-preview]');
      prev.hidden = false;
      prev.innerHTML = '';
      prev.appendChild(el(`<img src="${dataUrl}" alt="ตัวอย่างรูปที่ AI สร้าง" />`));
      useBtn.disabled = false;
    });
    bindAsync(useBtn, async () => {
      if (!dataUrl) return;
      dz.setFile(await urlToFile(dataUrl, 'ai-image.png'));
      toast('ใส่รูปที่ AI สร้างแล้ว', 'ok');
      modal.close();
    });
  });
  return btn;
}

function feedForm(pages) {
  const wrap = el(`<div class="card card-pad" style="max-width:640px">
    <div class="field">
      <label>ข้อความ</label>
      <div data-composer></div>
    </div>
    <div class="field">
      <label>ลิงก์ (ไม่บังคับ)</label>
      <input type="url" data-link placeholder="https://…" />
    </div>
    <div class="field">
      <label>รูปภาพ (ไม่บังคับ)</label>
      <div class="desc">ลากรูปมาวาง อัปโหลดจากเครื่อง หรือวาง URL รูป — ถ้ามีรูป ระบบจะโพสต์เป็นรูปภาพ</div>
      <div data-image-dz></div>
      <input type="url" data-image placeholder="หรือวาง URL รูป https://…" style="margin-top:10px" />
    </div>
    <div class="field">
      <label>เลือกเพจปลายทาง</label>
      <div data-pages></div>
    </div>
    <div data-schedule></div>
    <button class="btn primary" data-send>📣 ส่งโพสต์</button>
  </div>`);
  const box = pageChecklist(pages);
  wrap.querySelector('[data-pages]').appendChild(box);

  const composer = createComposer({ placeholder: 'พิมพ์ข้อความที่จะโพสต์…' });
  const composerBox = wrap.querySelector('[data-composer]');
  composerBox.appendChild(composer.el);
  composerBox.appendChild(aiRow(aiComposeButton(composer, 'feed')));

  const sched = scheduleField();
  wrap.querySelector('[data-schedule]').appendChild(sched.el);

  const urlInput = wrap.querySelector('[data-image]');
  const dz = createDropzone({
    previewClass: 'cover',
    onFile: (file) => { if (file) urlInput.value = ''; },
  });
  const imageBox = wrap.querySelector('[data-image-dz]');
  imageBox.appendChild(dz.el);
  imageBox.appendChild(aiRow(aiImageButton(dz)));
  urlInput.addEventListener('input', () => {
    if (/^https?:\/\//i.test(urlInput.value.trim())) dz.clear();
  });

  bindAsync(wrap.querySelector('[data-send]'), async () => {
    const message = composer.getValue().trim();
    const link = wrap.querySelector('[data-link]').value.trim();
    const imageUrl = urlInput.value.trim();
    const file = dz.getFile();
    const pageIds = selectedIds(box);
    if (!message) return toast('กรุณาใส่ข้อความ', 'err');
    if (!pageIds.length) return toast('เลือกอย่างน้อย 1 เพจ', 'err');
    if (link && (imageUrl || file)) return toast('ใส่ลิงก์หรือรูปอย่างใดอย่างหนึ่ง', 'err');
    const scheduledAt = sched.getISO();

    let res;
    if (file) {
      res = await Endpoints.broadcastFeedFile(message, pageIds, file, scheduledAt ? { scheduledAt } : {});
    } else {
      const payload = { message, pageIds };
      if (link) payload.link = link;
      if (imageUrl) payload.imageUrl = imageUrl;
      if (scheduledAt) payload.scheduledAt = scheduledAt;
      res = await Endpoints.broadcastFeed(payload);
    }
    toast(
      res.status === 'scheduled'
        ? `ตั้งเวลาโพสต์แล้ว: ${fmtDate(res.scheduledAt)}`
        : `ส่งไป ${res.targetCount} เพจแล้ว — กำลังโพสต์`,
      'ok',
    );
    composer.clear();
    urlInput.value = '';
    dz.clear();
    sched.clear();
    box.querySelectorAll('input:checked').forEach((i) => (i.checked = false));
    loadRecent(document.querySelector('[data-recent]'));
  });
  return wrap;
}

function messengerForm(pages) {
  const wrap = el(`<div class="card card-pad" style="max-width:640px">
    <div class="field">
      <label>ข้อความ</label>
      <div data-composer></div>
    </div>
    <div class="field">
      <label>รูปภาพ (ไม่บังคับ)</label>
      <div class="desc">ลากรูปมาวางหรืออัปโหลดจากเครื่อง — จะส่งเป็นรูปตามหลังข้อความอีก 1 ข้อความ</div>
      <div data-image-dz></div>
    </div>
    <div class="field">
      <label>เลือกเพจ</label>
      <div data-pages></div>
    </div>
    <div class="field">
      <label>Message Tag (ไม่บังคับ)</label>
      <div class="desc">ปกติส่งได้เฉพาะผู้ที่ทักภายใน 24 ชม. — เลือก tag เพื่อส่งนอกช่วงเวลา (ห้ามใช้กับเนื้อหาโปรโมท ผิดนโยบาย Facebook)</div>
      <select data-tag>
        <option value="">— ส่งเฉพาะภายใน 24 ชม. —</option>
        ${MESSAGE_TAGS.map((t) => `<option value="${t}">${t}</option>`).join('')}
      </select>
    </div>
    <div data-schedule></div>
    <button class="btn primary" data-send>💬 ส่งข้อความ</button>
  </div>`);
  const box = pageChecklist(pages);
  wrap.querySelector('[data-pages]').appendChild(box);

  const composer = createComposer({ placeholder: 'ข้อความที่จะส่งถึงผู้ที่เคยทักแชท…' });
  const composerBox = wrap.querySelector('[data-composer]');
  composerBox.appendChild(composer.el);
  composerBox.appendChild(aiRow(aiComposeButton(composer, 'messenger')));

  const dz = createDropzone({ previewClass: 'cover' });
  const imageBox = wrap.querySelector('[data-image-dz]');
  imageBox.appendChild(dz.el);
  imageBox.appendChild(aiRow(aiImageButton(dz)));

  const sched = scheduleField();
  wrap.querySelector('[data-schedule]').appendChild(sched.el);

  bindAsync(wrap.querySelector('[data-send]'), async () => {
    const message = composer.getValue().trim();
    const tag = wrap.querySelector('[data-tag]').value;
    const file = dz.getFile();
    const pageIds = selectedIds(box);
    if (!message) return toast('กรุณาใส่ข้อความ', 'err');
    if (!pageIds.length) return toast('เลือกอย่างน้อย 1 เพจ', 'err');
    const scheduledAt = sched.getISO();

    let res;
    if (file) {
      res = await Endpoints.broadcastMessengerFile(message, pageIds, file, {
        ...(tag ? { messageTag: tag } : {}),
        ...(scheduledAt ? { scheduledAt } : {}),
      });
    } else {
      const payload = { message, pageIds };
      if (tag) payload.messageTag = tag;
      if (scheduledAt) payload.scheduledAt = scheduledAt;
      res = await Endpoints.broadcastMessenger(payload);
    }
    toast(
      res.status === 'scheduled'
        ? `ตั้งเวลาส่งแล้ว: ${fmtDate(res.scheduledAt)}`
        : `ส่งถึง ${res.targetCount} ผู้รับแล้ว`,
      'ok',
    );
    composer.clear();
    dz.clear();
    sched.clear();
    loadRecent(document.querySelector('[data-recent]'));
  });
  return wrap;
}

async function loadRecent(container) {
  if (!container) return;
  container.innerHTML = '';
  container.appendChild(loadingView());
  try {
    const rows = await Endpoints.broadcasts();
    container.innerHTML = '';
    if (!rows.length) {
      container.appendChild(el('<div class="empty">ยังไม่มี broadcast</div>'));
      return;
    }
    const table = el(`<table><thead><tr>
      <th>ประเภท</th><th>ข้อความ</th><th>สถานะ</th><th>เมื่อ</th><th></th>
    </tr></thead><tbody></tbody></table>`);
    const tb = table.querySelector('tbody');
    for (const b of rows) {
      const snippet = (b.message || '').slice(0, 60);
      const when = b.status === 'scheduled'
        ? `🕐 ${fmtDate(b.scheduledAt)}`
        : fmtDate(b.createdAt);
      const row = el(`<tr>
        <td>${b.kind === 'messenger' ? '💬 Messenger' : '📄 เพจ'}</td>
        <td>${esc(snippet)}${b.message && b.message.length > 60 ? '…' : ''}</td>
        <td>${statusBadge(b.status)}</td>
        <td class="muted">${esc(when)}</td>
        <td></td>
      </tr>`);
      const actions = row.querySelector('td:last-child');
      if (b.status === 'scheduled') {
        const cancelBtn = el('<button class="btn sm danger">ยกเลิก</button>');
        cancelBtn.addEventListener('click', async () => {
          if (!(await confirmDialog('ยกเลิกการตั้งเวลา broadcast นี้?'))) return;
          try {
            await Endpoints.cancelBroadcast(b.id);
            toast('ยกเลิกแล้ว', 'ok');
            loadRecent(container);
          } catch (err) {
            toast(err.message || 'ยกเลิกไม่สำเร็จ', 'err');
          }
        });
        actions.appendChild(cancelBtn);
      } else if (['completed', 'partial', 'failed'].includes(b.status) && b.pageIds && b.pageIds.length) {
        // Finished broadcasts (that still carry their target pages) can be re-sent with the same content.
        const resendBtn = el('<button class="btn sm">🔁 ส่งซ้ำ</button>');
        bindAsync(resendBtn, async () => {
          if (!(await confirmDialog(`ส่ง broadcast นี้ซ้ำอีกครั้งเดี๋ยวนี้?\n\n"${(b.message || '').slice(0, 80)}"`))) return;
          const res = await Endpoints.resendBroadcast(b.id);
          if (res.imageOmitted) toast(`ส่งซ้ำถึง ${res.targetCount} เป้าหมาย (รูปเดิมหมดอายุแล้ว จึงส่งเฉพาะข้อความ)`, 'ok');
          else toast(`ส่งซ้ำถึง ${res.targetCount} เป้าหมายแล้ว`, 'ok');
          loadRecent(container);
        });
        actions.appendChild(resendBtn);
      }
      tb.appendChild(row);
    }
    container.appendChild(table);
  } catch (err) {
    container.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
}
