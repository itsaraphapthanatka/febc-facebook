// Shared DOM + formatting helpers (no framework).

/** Escape text for safe insertion into innerHTML. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );
}

/** Create an element from an HTML string (returns first child). */
export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

let toastTimer;
export function toast(message, kind = '') {
  const t = document.getElementById('toast');
  t.textContent = message;
  t.className = 'toast ' + kind;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, kind === 'err' ? 5000 : 3000);
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
}

export function statusBadge(status) {
  const map = {
    sent: 'ok', published: 'ok', completed: 'ok', success: 'ok', ok: 'ok',
    pending: 'muted', running: 'warn', partial: 'warn',
    failed: 'err', error: 'err',
  };
  return `<span class="badge ${map[status] || 'muted'}">${esc(status)}</span>`;
}

/** Simple modal. content is an HTMLElement. Returns { close }. */
export function openModal(title, contentEl, footEl) {
  const back = el(`<div class="modal-back"><div class="modal">
    <div class="modal-head"><h2></h2><button class="x-btn" aria-label="close">&times;</button></div>
    <div class="modal-body"></div>
  </div></div>`);
  back.querySelector('h2').textContent = title;
  back.querySelector('.modal-body').appendChild(contentEl);
  if (footEl) back.querySelector('.modal').appendChild(footEl);
  const close = () => back.remove();
  back.querySelector('.x-btn').addEventListener('click', close);
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  document.body.appendChild(back);
  return { close, root: back };
}

export function confirmDialog(message) {
  return new Promise((resolve) => {
    const body = el(`<div><p style="margin:0 0 4px">${esc(message)}</p></div>`);
    const foot = el(`<div class="modal-foot">
      <button class="btn" data-no>ยกเลิก</button>
      <button class="btn danger" data-yes>ยืนยัน</button>
    </div>`);
    const m = openModal('ยืนยันการทำงาน', body, foot);
    foot.querySelector('[data-no]').addEventListener('click', () => { m.close(); resolve(false); });
    foot.querySelector('[data-yes]').addEventListener('click', () => { m.close(); resolve(true); });
  });
}

/** Wrap an async button click: shows spinner + disables while running. */
export function bindAsync(btn, fn) {
  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    try {
      await fn();
    } catch (err) {
      toast(err.message || 'เกิดข้อผิดพลาด', 'err');
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  });
}

export function loadingView() {
  return el('<div class="loading"><span class="spinner" style="border-color:#ccc;border-top-color:#666"></span><div style="margin-top:10px">กำลังโหลด…</div></div>');
}

/**
 * A reusable drag-and-drop image picker.
 * Returns { el, getFile, clear }. Calls opts.onFile(file|null) on every change.
 */
export function createDropzone(opts = {}) {
  const previewClass = opts.previewClass || 'cover';
  const root = el(`<div class="dropzone">
    <input type="file" accept="image/*" hidden />
    <div class="dz-placeholder">
      <div class="dz-ico">🖼️</div>
      <div>ลากรูปมาวางที่นี่ หรือ <span class="dz-link">คลิกเลือกไฟล์</span></div>
      <div class="dz-hint">รองรับ jpg, png, gif, webp</div>
    </div>
    <div class="dz-preview" hidden>
      <img class="img-prev ${previewClass}" alt="" />
      <div class="dz-file"><span class="dz-name"></span><button type="button" class="dz-clear">✕ ลบ</button></div>
    </div>
  </div>`);

  const input = root.querySelector('input');
  const placeholder = root.querySelector('.dz-placeholder');
  const preview = root.querySelector('.dz-preview');
  const img = root.querySelector('img');
  const nameEl = root.querySelector('.dz-name');
  let objectUrl = null;
  let current = null;

  const setFile = (file) => {
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
    if (file && !/^image\//.test(file.type)) {
      toast('ไฟล์ต้องเป็นรูปภาพ', 'err');
      file = null;
    }
    current = file || null;
    input.value = '';
    if (current) {
      objectUrl = URL.createObjectURL(current);
      img.src = objectUrl;
      nameEl.textContent = current.name;
      placeholder.hidden = true;
      preview.hidden = false;
    } else {
      placeholder.hidden = false;
      preview.hidden = true;
    }
    opts.onFile?.(current);
  };

  root.addEventListener('click', (e) => {
    if (!e.target.closest('.dz-clear')) input.click();
  });
  input.addEventListener('change', () => setFile(input.files[0]));
  root.querySelector('.dz-clear').addEventListener('click', (e) => {
    e.stopPropagation();
    setFile(null);
  });

  ['dragenter', 'dragover'].forEach((ev) =>
    root.addEventListener(ev, (e) => { e.preventDefault(); root.classList.add('drag'); }),
  );
  ['dragleave', 'dragend'].forEach((ev) =>
    root.addEventListener(ev, (e) => { e.preventDefault(); root.classList.remove('drag'); }),
  );
  root.addEventListener('drop', (e) => {
    e.preventDefault();
    root.classList.remove('drag');
    const f = e.dataTransfer?.files?.[0];
    if (f) setFile(f);
  });

  return { el: root, getFile: () => current, clear: () => setFile(null) };
}
