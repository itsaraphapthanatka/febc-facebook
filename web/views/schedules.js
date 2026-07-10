import { Endpoints } from '../api.js';
import { el, esc, toast, statusBadge, fmtDate, bindAsync, confirmDialog, openModal, loadingView, createDropzone } from '../ui.js';
import { aiImageButton } from './broadcast.js';

const CRON_PRESETS = [
  { label: 'ทุกวัน 08:00', value: '0 8 * * *' },
  { label: 'ทุกวัน 12:00', value: '0 12 * * *' },
  { label: 'ทุกวัน 18:00', value: '0 18 * * *' },
  { label: 'ทุกจันทร์ 09:00', value: '0 9 * * 1' },
  { label: 'ทุกชั่วโมง', value: '0 * * * *' },
];

export async function renderSchedules(view) {
  view.innerHTML = '';
  const head = el(`<div class="page-head">
    <div><h1>ตั้งเวลาโพสต์ (AI)</h1><div class="sub">ให้ AI เขียนโพสต์แล้วโพสต์อัตโนมัติตามตารางเวลา</div></div>
    <button class="btn primary" data-new>➕ สร้างตารางใหม่</button>
  </div>`);
  view.appendChild(head);

  const loading = loadingView();
  view.appendChild(loading);
  const [schedules, pages] = await Promise.all([Endpoints.schedules(), Endpoints.pages()]);
  loading.remove();

  head.querySelector('[data-new]').addEventListener('click', () =>
    openEditor(null, pages, () => renderSchedules(view)),
  );

  if (!schedules.length) {
    view.appendChild(el(`<div class="card"><div class="empty">
      <div class="big">🤖</div><p>ยังไม่มีตารางโพสต์อัตโนมัติ</p>
    </div></div>`));
    return;
  }

  const pageName = (id) => pages.find((p) => p.id === id)?.name || '(เพจถูกลบ)';
  const card = el('<div class="card table-wrap"></div>');
  const table = el(`<table><thead><tr>
    <th>ชื่อ</th><th>ตารางเวลา</th><th>เพจ</th><th>สถานะ</th><th>รันล่าสุด</th><th style="text-align:right">จัดการ</th>
  </tr></thead><tbody></tbody></table>`);
  const tbody = table.querySelector('tbody');

  for (const s of schedules) {
    const targets = (s.targetPageIds || []).map(pageName).join(', ');
    const tr = el(`<tr>
      <td><div style="font-weight:600">${esc(s.name)}</div></td>
      <td class="mono">${esc(s.cronExpression)}</td>
      <td>${esc(targets)}</td>
      <td>${s.isActive ? '<span class="badge ok">เปิด</span>' : '<span class="badge muted">ปิด</span>'}</td>
      <td class="muted">${fmtDate(s.lastRunAt)}</td>
      <td><div class="btn-row" style="justify-content:flex-end"></div></td>
    </tr>`);
    const actions = tr.querySelector('.btn-row');

    const previewBtn = el('<button class="btn sm">👁 พรีวิว</button>');
    bindAsync(previewBtn, async () => {
      const res = await Endpoints.previewSchedule(s.id);
      showPreview(s.name, res.preview);
    });
    actions.appendChild(previewBtn);

    const runBtn = el('<button class="btn sm">▶ รันเลย</button>');
    bindAsync(runBtn, async () => {
      if (!(await confirmDialog(`รัน "${s.name}" เดี๋ยวนี้? AI จะเขียนและโพสต์ขึ้นเพจจริงทันที`))) return;
      await Endpoints.runSchedule(s.id);
      toast('สั่งรันแล้ว — ตรวจผลได้ที่ประวัติ', 'ok');
    });
    actions.appendChild(runBtn);

    const editBtn = el('<button class="btn sm">แก้ไข</button>');
    editBtn.addEventListener('click', () => openEditor(s, pages, () => renderSchedules(view)));
    actions.appendChild(editBtn);

    const toggleBtn = el(`<button class="btn sm">${s.isActive ? 'ปิด' : 'เปิด'}</button>`);
    bindAsync(toggleBtn, async () => {
      await Endpoints.updateSchedule(s.id, { isActive: !s.isActive });
      renderSchedules(view);
    });
    actions.appendChild(toggleBtn);

    const delBtn = el('<button class="btn sm danger">ลบ</button>');
    bindAsync(delBtn, async () => {
      if (!(await confirmDialog(`ลบตาราง "${s.name}"?`))) return;
      await Endpoints.deleteSchedule(s.id);
      toast('ลบแล้ว', 'ok');
      renderSchedules(view);
    });
    actions.appendChild(delBtn);

    tbody.appendChild(tr);
  }
  card.appendChild(table);
  view.appendChild(card);
}

function showPreview(name, text) {
  const body = el(`<div>
    <p class="muted" style="margin-top:0">ตัวอย่างเนื้อหาที่ AI สร้าง (ยังไม่โพสต์)</p>
    <div class="preview-box">${esc(text)}</div>
  </div>`);
  openModal(`พรีวิว: ${name}`, body);
}

export function openEditor(schedule, pages, onSaved) {
  const isEdit = !!schedule;
  const s = schedule || { name: '', cronExpression: '0 8 * * *', promptTemplate: '', topics: [], model: '', targetPageIds: [], isActive: true };

  const body = el(`<div>
    <div class="field">
      <label>ชื่อตาราง</label>
      <input type="text" data-name value="${esc(s.name)}" placeholder="เช่น โพสต์ให้กำลังใจตอนเช้า" />
    </div>
    <div class="field">
      <label>ตารางเวลา (Cron)</label>
      <div class="desc">รูปแบบ: นาที ชม. วัน เดือน วันในสัปดาห์ (โซนเวลา Asia/Bangkok)</div>
      <input type="text" data-cron value="${esc(s.cronExpression)}" placeholder="0 8 * * *" />
      <div class="btn-row" style="margin-top:8px" data-presets></div>
    </div>
    <div class="field">
      <label>คำสั่งให้ AI (Prompt)</label>
      <div class="desc">ใช้ {{topic}} และ {{date}} เป็นตัวแปรได้</div>
      <textarea data-prompt placeholder="เขียนโพสต์ Facebook สั้นๆ เรื่อง {{topic}} สำหรับวันที่ {{date}}">${esc(s.promptTemplate)}</textarea>
    </div>
    <div class="field">
      <label>หัวข้อ (Topics) — คั่นด้วยบรรทัดใหม่</label>
      <div class="desc">ระบบจะหมุนเวียนใช้ทีละหัวข้อในแต่ละครั้งที่โพสต์</div>
      <textarea data-topics placeholder="โปรโมชั่นสินค้า&#10;เคล็ดลับการใช้งาน">${esc((s.topics || []).join('\n'))}</textarea>
    </div>
    <div class="field">
      <label>โมเดล AI (ไม่บังคับ)</label>
      <div class="desc">ปล่อยว่างเพื่อใช้ค่าเริ่มต้นของเซิร์ฟเวอร์</div>
      <input type="text" data-model value="${esc(s.model || '')}" placeholder="เช่น gemma-4-12b" />
    </div>
    <div class="field">
      <label>รูปภาพ (ไม่บังคับ)</label>
      <div class="desc">แนบรูปกับโพสต์ทุกครั้งที่รัน — อัปโหลด, ให้ AI สร้าง, หรือวาง URL รูปสาธารณะ</div>
      <div data-image-dz></div>
      <div data-image-note class="muted" style="margin-top:8px" hidden>แนบรูปที่อัปโหลดไว้แล้ว <button type="button" class="btn sm danger" data-remove-img style="margin-left:6px">ลบรูป</button></div>
      <input type="url" data-image-url placeholder="หรือวาง URL รูป https://…" style="margin-top:10px" />
    </div>
    <div class="field">
      <label>เพจปลายทาง</label>
      <div data-pages></div>
    </div>
    <label style="display:flex;align-items:center;gap:8px;font-weight:500;margin-bottom:14px">
      <input type="checkbox" data-also-msg ${s.alsoMessenger ? 'checked' : ''} style="width:auto" /> ส่งเข้า Messenger ด้วย (ถึงผู้ที่ทักใน 24 ชม.)
    </label>
    <label style="display:flex;align-items:center;gap:8px;font-weight:500">
      <input type="checkbox" data-active ${s.isActive ? 'checked' : ''} style="width:auto" /> เปิดใช้งานตารางนี้
    </label>
  </div>`);

  // cron presets
  const presetRow = body.querySelector('[data-presets]');
  for (const p of CRON_PRESETS) {
    const b = el(`<button class="btn sm" type="button">${esc(p.label)}</button>`);
    b.addEventListener('click', () => { body.querySelector('[data-cron]').value = p.value; });
    presetRow.appendChild(b);
  }

  // image picker: dropzone + AI button + URL, with handling for an already-attached image
  const existingImage = s.imageUrl || '';
  const isLocalExisting = existingImage.startsWith('local:');
  let keepLocal = isLocalExisting;
  const urlInput = body.querySelector('[data-image-url]');
  urlInput.value = existingImage && !isLocalExisting ? existingImage : '';
  const note = body.querySelector('[data-image-note]');
  note.hidden = !isLocalExisting;

  const dz = createDropzone({ previewClass: 'cover', onFile: (f) => { if (f) urlInput.value = ''; } });
  const dzBox = body.querySelector('[data-image-dz]');
  dzBox.appendChild(dz.el);
  const aiRow = el('<div class="ai-actions"></div>');
  aiRow.appendChild(aiImageButton(dz));
  dzBox.appendChild(aiRow);
  note.querySelector('[data-remove-img]').addEventListener('click', () => { keepLocal = false; note.hidden = true; });

  // page checklist
  const box = el('<div class="checklist"></div>');
  if (!pages.length) box.appendChild(el('<div class="muted">ไม่มีเพจ</div>'));
  for (const p of pages) {
    const checked = (s.targetPageIds || []).includes(p.id) ? 'checked' : '';
    box.appendChild(el(`<label><input type="checkbox" value="${esc(p.id)}" ${checked} />${esc(p.name)}${p.isActive ? '' : ' (พัก)'}</label>`));
  }
  body.querySelector('[data-pages]').appendChild(box);

  const foot = el(`<div class="modal-foot">
    <button class="btn" data-cancel>ยกเลิก</button>
    <button class="btn primary" data-save>${isEdit ? 'บันทึก' : 'สร้าง'}</button>
  </div>`);
  const modal = openModal(isEdit ? 'แก้ไขตาราง' : 'สร้างตารางใหม่', body, foot);
  foot.querySelector('[data-cancel]').addEventListener('click', modal.close);

  bindAsync(foot.querySelector('[data-save]'), async () => {
    const payload = {
      name: body.querySelector('[data-name]').value.trim(),
      cronExpression: body.querySelector('[data-cron]').value.trim(),
      promptTemplate: body.querySelector('[data-prompt]').value.trim(),
      topics: body.querySelector('[data-topics]').value.split('\n').map((t) => t.trim()).filter(Boolean),
      targetPageIds: [...box.querySelectorAll('input:checked')].map((i) => i.value),
      alsoMessenger: body.querySelector('[data-also-msg]').checked,
      isActive: body.querySelector('[data-active]').checked,
    };
    const model = body.querySelector('[data-model]').value.trim();
    if (model) payload.model = model;

    if (!payload.name) return toast('กรุณาใส่ชื่อ', 'err');
    if (!payload.promptTemplate) return toast('กรุณาใส่ Prompt', 'err');
    if (!payload.targetPageIds.length) return toast('เลือกอย่างน้อย 1 เพจ', 'err');

    // Resolve the attached image: new upload/AI file → new URL → keep existing → clear.
    const file = dz.getFile();
    const urlVal = urlInput.value.trim();
    if (file) payload.imageUrl = (await Endpoints.uploadScheduleImage(file)).imageUrl;
    else if (urlVal) payload.imageUrl = urlVal;
    else payload.imageUrl = keepLocal ? existingImage : null;

    if (isEdit) await Endpoints.updateSchedule(schedule.id, payload);
    else await Endpoints.createSchedule(payload);
    toast(isEdit ? 'บันทึกแล้ว' : 'สร้างตารางแล้ว', 'ok');
    modal.close();
    onSaved();
  });
}
