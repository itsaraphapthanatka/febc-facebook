import { Endpoints, mountPath } from '../api.js';
import { el, esc, toast, bindAsync, confirmDialog, openModal, loadingView, createDropzone } from '../ui.js';

export async function renderPages(view) {
  view.innerHTML = '';
  const head = el(`<div class="page-head">
    <div><h1>เพจ</h1><div class="sub">เพจ Facebook ที่เชื่อมต่อกับระบบ</div></div>
    <div class="btn-row">
      <button class="btn" data-refresh>🔄 ดึงเพจใหม่</button>
      <a class="btn primary" href="${mountPath('/auth/facebook')}">➕ เชื่อมต่อเพจ</a>
    </div>
  </div>`);
  view.appendChild(head);

  bindAsync(head.querySelector('[data-refresh]'), async () => {
    await Endpoints.refreshPages();
    toast('ดึงรายการเพจใหม่แล้ว', 'ok');
    renderPages(view);
  });

  const loading = loadingView();
  view.appendChild(loading);
  const pages = await Endpoints.pages();
  loading.remove();

  if (!pages.length) {
    view.appendChild(el(`<div class="card"><div class="empty">
      <div class="big">📄</div>
      <p>ยังไม่มีเพจที่เชื่อมต่อ</p>
      <a class="btn primary" href="${mountPath('/auth/facebook')}" style="margin-top:8px">เชื่อมต่อเพจแรก</a>
    </div></div>`));
    return;
  }

  const card = el('<div class="card table-wrap"></div>');
  const table = el(`<table><thead><tr>
    <th>เพจ</th><th>เจ้าของ</th><th>Webhook</th><th>สถานะ</th><th style="text-align:right">จัดการ</th>
  </tr></thead><tbody></tbody></table>`);
  const tbody = table.querySelector('tbody');

  for (const p of pages) {
    const owner = p.ownerName
      ? `<div>${esc(p.ownerName)}</div><div class="mono">${esc(p.ownerFbId || '')}</div>`
      : '<span class="muted">—</span>';
    const tr = el(`<tr>
      <td><div style="font-weight:600">${esc(p.name)}</div><div class="mono">${esc(p.fbPageId)}</div></td>
      <td>${owner}</td>
      <td>${p.webhookSubscribed ? '<span class="badge ok">สมัครแล้ว</span>' : '<span class="badge muted">ยังไม่สมัคร</span>'}</td>
      <td>${p.isActive ? '<span class="badge ok">ใช้งาน</span>' : '<span class="badge muted">พัก</span>'}</td>
      <td><div class="btn-row" style="justify-content:flex-end"></div></td>
    </tr>`);
    const actions = tr.querySelector('.btn-row');

    const imgBtn = el('<button class="btn sm">🖼 เปลี่ยนรูป</button>');
    imgBtn.addEventListener('click', () => openImageModal(p));
    actions.appendChild(imgBtn);

    const subBtn = el(`<button class="btn sm">${p.webhookSubscribed ? 'ยกเลิก Webhook' : 'สมัคร Webhook'}</button>`);
    bindAsync(subBtn, async () => {
      if (p.webhookSubscribed) await Endpoints.unsubscribePage(p.id);
      else await Endpoints.subscribePage(p.id);
      toast('อัปเดต Webhook แล้ว', 'ok');
      renderPages(view);
    });
    actions.appendChild(subBtn);

    const actBtn = el(`<button class="btn sm">${p.isActive ? 'พักใช้งาน' : 'เปิดใช้งาน'}</button>`);
    bindAsync(actBtn, async () => {
      await Endpoints.setPageActive(p.id, !p.isActive);
      renderPages(view);
    });
    actions.appendChild(actBtn);

    const delBtn = el('<button class="btn sm danger">ลบ</button>');
    bindAsync(delBtn, async () => {
      if (!(await confirmDialog(`ลบเพจ "${p.name}" ออกจากระบบ? (ไม่มีผลกับเพจจริงบน Facebook)`))) return;
      await Endpoints.deletePage(p.id);
      toast('ลบเพจแล้ว', 'ok');
      renderPages(view);
    });
    actions.appendChild(delBtn);

    tbody.appendChild(tr);
  }
  card.appendChild(table);
  view.appendChild(card);
}

/** Modal to update cover photo / profile picture — via drag-and-drop upload or an image URL. */
function openImageModal(page) {
  const section = (key, title) => `
    <div class="field">
      <label>${title}</label>
      <div data-${key}-dz></div>
      <div class="desc" style="margin:10px 0 4px">หรือวาง URL รูป (ลิงก์สาธารณะ)</div>
      <input type="url" data-${key}-url placeholder="https://…" />
      <button class="btn sm primary" data-${key}-btn style="margin-top:12px">อัปเดต</button>
    </div>`;

  const body = el(`<div>
    <p class="muted" style="margin-top:0">ลากรูปมาวาง อัปโหลดจากเครื่อง หรือวาง URL รูป แล้วกดอัปเดต — มีผลกับเพจจริงบน Facebook ทันที</p>
    ${section('cover', 'รูปหน้าปก (Cover)')}
    <hr style="border:none;border-top:1px solid var(--border);margin:20px 0" />
    ${section('profile', 'รูปโปรไฟล์ (Profile)')}
  </div>`);

  const modal = openModal(`เปลี่ยนรูป: ${page.name}`, body);

  const wire = (key, { previewClass, uploadFile, setUrl, label }) => {
    const urlInput = body.querySelector(`[data-${key}-url]`);
    const dz = createDropzone({
      previewClass,
      onFile: (file) => { if (file) urlInput.value = ''; },
    });
    body.querySelector(`[data-${key}-dz]`).appendChild(dz.el);

    urlInput.addEventListener('input', () => {
      if (/^https?:\/\//i.test(urlInput.value.trim())) dz.clear();
    });

    bindAsync(body.querySelector(`[data-${key}-btn]`), async () => {
      const file = dz.getFile();
      const url = urlInput.value.trim();
      if (!file && !/^https?:\/\//i.test(url)) return toast('ลากไฟล์มาวาง เลือกไฟล์ หรือใส่ URL รูป', 'err');
      if (!(await confirmDialog(`อัปเดต${label}ของเพจ "${page.name}" บน Facebook?`))) return;
      if (file) await uploadFile(file);
      else await setUrl(url);
      toast(`อัปเดต${label}แล้ว`, 'ok');
    });
  };

  wire('cover', {
    previewClass: 'cover',
    label: 'รูปหน้าปก',
    uploadFile: (f) => Endpoints.setCoverFile(page.id, f),
    setUrl: (u) => Endpoints.setCover(page.id, u),
  });
  wire('profile', {
    previewClass: 'profile',
    label: 'รูปโปรไฟล์',
    uploadFile: (f) => Endpoints.setProfilePictureFile(page.id, f),
    setUrl: (u) => Endpoints.setProfilePicture(page.id, u),
  });

  return modal;
}
