import { Endpoints } from '../api.js';
import { el, esc, toast, statusBadge, fmtDate, bindAsync, loadingView, createDropzone } from '../ui.js';

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
  const recent = el('<div class="card table-wrap"></div>');
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

function feedForm(pages) {
  const wrap = el(`<div class="card card-pad" style="max-width:640px">
    <div class="field">
      <label>ข้อความ</label>
      <textarea data-msg placeholder="พิมพ์ข้อความที่จะโพสต์…"></textarea>
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
    <button class="btn primary" data-send>📣 ส่งโพสต์</button>
  </div>`);
  const box = pageChecklist(pages);
  wrap.querySelector('[data-pages]').appendChild(box);

  const urlInput = wrap.querySelector('[data-image]');
  const dz = createDropzone({
    previewClass: 'cover',
    onFile: (file) => { if (file) urlInput.value = ''; },
  });
  wrap.querySelector('[data-image-dz]').appendChild(dz.el);
  urlInput.addEventListener('input', () => {
    if (/^https?:\/\//i.test(urlInput.value.trim())) dz.clear();
  });

  bindAsync(wrap.querySelector('[data-send]'), async () => {
    const message = wrap.querySelector('[data-msg]').value.trim();
    const link = wrap.querySelector('[data-link]').value.trim();
    const imageUrl = urlInput.value.trim();
    const file = dz.getFile();
    const pageIds = selectedIds(box);
    if (!message) return toast('กรุณาใส่ข้อความ', 'err');
    if (!pageIds.length) return toast('เลือกอย่างน้อย 1 เพจ', 'err');
    if (link && (imageUrl || file)) return toast('ใส่ลิงก์หรือรูปอย่างใดอย่างหนึ่ง', 'err');

    let res;
    if (file) {
      res = await Endpoints.broadcastFeedFile(message, pageIds, file);
    } else {
      const payload = { message, pageIds };
      if (link) payload.link = link;
      if (imageUrl) payload.imageUrl = imageUrl;
      res = await Endpoints.broadcastFeed(payload);
    }
    toast(`ส่งไป ${res.targetCount} เพจแล้ว — กำลังโพสต์`, 'ok');
    wrap.querySelector('[data-msg]').value = '';
    urlInput.value = '';
    dz.clear();
    box.querySelectorAll('input:checked').forEach((i) => (i.checked = false));
  });
  return wrap;
}

function messengerForm(pages) {
  const wrap = el(`<div class="card card-pad" style="max-width:640px">
    <div class="field">
      <label>ข้อความ</label>
      <textarea data-msg placeholder="ข้อความที่จะส่งถึงผู้ที่เคยทักแชท…"></textarea>
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
    <button class="btn primary" data-send>💬 ส่งข้อความ</button>
  </div>`);
  const box = pageChecklist(pages);
  wrap.querySelector('[data-pages]').appendChild(box);

  bindAsync(wrap.querySelector('[data-send]'), async () => {
    const message = wrap.querySelector('[data-msg]').value.trim();
    const tag = wrap.querySelector('[data-tag]').value;
    const pageIds = selectedIds(box);
    if (!message) return toast('กรุณาใส่ข้อความ', 'err');
    if (!pageIds.length) return toast('เลือกอย่างน้อย 1 เพจ', 'err');
    const payload = { message, pageIds };
    if (tag) payload.messageTag = tag;
    const res = await Endpoints.broadcastMessenger(payload);
    toast(`ส่งถึง ${res.targetCount} ผู้รับแล้ว`, 'ok');
    wrap.querySelector('[data-msg]').value = '';
  });
  return wrap;
}

async function loadRecent(container) {
  container.appendChild(loadingView());
  try {
    const rows = await Endpoints.broadcasts();
    container.innerHTML = '';
    if (!rows.length) {
      container.appendChild(el('<div class="empty">ยังไม่มี broadcast</div>'));
      return;
    }
    const table = el(`<table><thead><tr>
      <th>ประเภท</th><th>ข้อความ</th><th>สถานะ</th><th>เมื่อ</th>
    </tr></thead><tbody></tbody></table>`);
    const tb = table.querySelector('tbody');
    for (const b of rows) {
      const snippet = (b.message || '').slice(0, 60);
      tb.appendChild(el(`<tr>
        <td>${b.kind === 'messenger' ? '💬 Messenger' : '📄 เพจ'}</td>
        <td>${esc(snippet)}${b.message && b.message.length > 60 ? '…' : ''}</td>
        <td>${statusBadge(b.status)}</td>
        <td class="muted">${fmtDate(b.createdAt)}</td>
      </tr>`));
    }
    container.appendChild(table);
  } catch (err) {
    container.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
}
