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
  return el('<div class="loading"><span class="spinner"></span><div style="margin-top:10px">กำลังโหลด…</div></div>');
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

  return { el: root, getFile: () => current, setFile: (f) => setFile(f), clear: () => setFile(null) };
}

/** Fetches an image from a data: or http URL and wraps it as a File (for the dropzone). */
export async function urlToFile(url, name = 'image.png') {
  const res = await fetch(url);
  const blob = await res.blob();
  return new File([blob], name, { type: blob.type || 'image/png' });
}

/* ---------- Rich-text composer ----------
 * Facebook's Graph/Send APIs take plain text only, so "bold/italic" is produced
 * with Unicode mathematical alphanumeric glyphs (𝗕𝗼𝗹𝗱 / 𝘐𝘵𝘢𝘭𝘪𝘤) and strikethrough
 * with a combining mark — all of which render on Facebook without any markup.
 * The value stays a plain string; nothing about the API payload changes.
 * Note: math bold/italic only have Latin-letter/digit glyphs, so they visibly
 * affect English text and numbers; strikethrough and emoji work on any text.
 */

// Reverse map: every styled glyph → its plain ASCII char (used to toggle styles off / normalize).
const GLYPH_TO_ASCII = (() => {
  const map = {};
  for (let i = 0; i < 26; i++) {
    const upper = String.fromCharCode(65 + i);
    const lower = String.fromCharCode(97 + i);
    map[String.fromCodePoint(0x1d400 + i)] = upper; // bold upper
    map[String.fromCodePoint(0x1d41a + i)] = lower; // bold lower
    map[String.fromCodePoint(0x1d434 + i)] = upper; // italic upper
    map[String.fromCodePoint(0x1d44e + i)] = lower; // italic lower
  }
  map['ℎ'] = 'h'; // italic h has no math codepoint; Unicode reuses ℎ
  for (let i = 0; i < 10; i++) {
    map[String.fromCodePoint(0x1d7ce + i)] = String.fromCharCode(48 + i); // bold digit
  }
  return map;
})();

const STRIKE_MARK = '̶';

function toBoldGlyph(ch) {
  const c = ch.codePointAt(0);
  if (c >= 65 && c <= 90) return String.fromCodePoint(0x1d400 + (c - 65));
  if (c >= 97 && c <= 122) return String.fromCodePoint(0x1d41a + (c - 97));
  if (c >= 48 && c <= 57) return String.fromCodePoint(0x1d7ce + (c - 48));
  return ch;
}
function toItalicGlyph(ch) {
  const c = ch.codePointAt(0);
  if (c >= 65 && c <= 90) return String.fromCodePoint(0x1d434 + (c - 65));
  if (c === 104) return 'ℎ';
  if (c >= 97 && c <= 122) return String.fromCodePoint(0x1d44e + (c - 97));
  return ch;
}
function inKind(ch, kind) {
  const c = ch.codePointAt(0);
  if (kind === 'bold') return (c >= 0x1d400 && c <= 0x1d433) || (c >= 0x1d7ce && c <= 0x1d7d7);
  if (kind === 'italic') return (c >= 0x1d434 && c <= 0x1d467) || c === 0x210e;
  return false;
}

/** Toggle a Unicode style over a selection: normalizes to plain first, then applies unless already that style. */
function toggleStyle(text, kind) {
  if (kind === 'strike') {
    return text.includes(STRIKE_MARK)
      ? text.replaceAll(STRIKE_MARK, '')
      : [...text].map((c) => (c === '\n' ? c : c + STRIKE_MARK)).join('');
  }
  const plain = [...text].map((c) => GLYPH_TO_ASCII[c] ?? c).join('');
  const alreadyThisKind = [...text].some((c) => inKind(c, kind));
  if (alreadyThisKind) return plain;
  const fn = kind === 'bold' ? toBoldGlyph : toItalicGlyph;
  return [...plain].map(fn).join('');
}

const COMPOSER_EMOJI = {
  'หน้า/อารมณ์': ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','😉','😍','🥰','😘','😋','😎','🤩','🥳','🤔','😐','😔','😢','😭','😤','😠','🥺','😴'],
  'มือ/ท่าทาง': ['👍','👎','👌','✌️','🤞','🙏','👏','🙌','💪','👋','🤝','☝️','👆','👉','👈','👇','🤟','🫶'],
  'หัวใจ/เน้น': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','💕','💖','💯','✨','⭐','🔥','🎉','🎊','💥','⚡','✅','❌','⚠️','❓','❗','💬'],
  'ของ/ทั่วไป': ['🎁','🛒','🏷️','💰','💵','📦','📢','📣','📌','📍','🕐','📅','🎯','🚀','🌟','🌈','☀️','🌙','🍀','🌸','🐶','🍔','☕','🎵'],
};

/**
 * A plain-text composer with a formatting toolbar (bold / italic / strikethrough)
 * and an emoji picker. Returns { el, getValue, setValue, clear, textarea }.
 */
export function createComposer(opts = {}) {
  const root = el(`<div class="composer">
    <div class="composer-bar">
      <button type="button" class="cbtn" data-cmd="bold" title="ตัวหนา"><b>B</b></button>
      <button type="button" class="cbtn" data-cmd="italic" title="ตัวเอียง"><i>I</i></button>
      <button type="button" class="cbtn" data-cmd="strike" title="ขีดฆ่า"><span style="text-decoration:line-through">S</span></button>
      <span class="cbar-sep"></span>
      <button type="button" class="cbtn" data-cmd="emoji" title="อีโมจิ">😀</button>
    </div>
    <textarea class="composer-input"></textarea>
    <div class="emoji-pop" hidden></div>
  </div>`);

  const ta = root.querySelector('textarea');
  if (opts.placeholder) ta.placeholder = opts.placeholder;
  if (opts.minHeight) ta.style.minHeight = opts.minHeight;
  const pop = root.querySelector('.emoji-pop');

  const applyFormat = (kind) => {
    const { selectionStart: s, selectionEnd: e } = ta;
    if (s === e) {
      toast('เลือกข้อความที่ต้องการจัดรูปแบบก่อน', '');
      ta.focus();
      return;
    }
    const styled = toggleStyle(ta.value.slice(s, e), kind);
    ta.setRangeText(styled, s, e, 'select');
    ta.focus();
  };

  const insertAtCursor = (str) => {
    const { selectionStart: s, selectionEnd: e } = ta;
    ta.setRangeText(str, s, e, 'end');
    ta.focus();
  };

  let emojiBuilt = false;
  const buildEmoji = () => {
    for (const [group, list] of Object.entries(COMPOSER_EMOJI)) {
      pop.appendChild(el(`<div class="emoji-group">${esc(group)}</div>`));
      const grid = el('<div class="emoji-grid"></div>');
      for (const emo of list) {
        const b = el(`<button type="button" class="emoji-cell">${emo}</button>`);
        b.addEventListener('click', () => { insertAtCursor(emo); });
        grid.appendChild(b);
      }
      pop.appendChild(grid);
    }
    emojiBuilt = true;
  };
  const toggleEmoji = () => {
    if (!emojiBuilt) buildEmoji();
    pop.hidden = !pop.hidden;
  };

  root.querySelectorAll('.cbtn').forEach((btn) =>
    btn.addEventListener('click', () => {
      const cmd = btn.dataset.cmd;
      if (cmd === 'emoji') toggleEmoji();
      else applyFormat(cmd);
    }),
  );
  // Close the emoji panel when clicking outside the composer
  document.addEventListener('click', (e) => {
    if (!pop.hidden && !root.contains(e.target)) pop.hidden = true;
  });

  return {
    el: root,
    textarea: ta,
    getValue: () => ta.value,
    setValue: (v) => { ta.value = v ?? ''; },
    clear: () => { ta.value = ''; pop.hidden = true; },
  };
}
