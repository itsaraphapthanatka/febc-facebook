import { Endpoints } from '../api.js';
import { el, esc, toast, bindAsync, confirmDialog, openModal, loadingView } from '../ui.js';
import { openEditor as openScheduleEditor } from './schedules.js';

const TH_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];
const TH_DOW = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

// Displayed month, kept across prev/next within the session.
const state = { y: undefined, m: undefined };

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const keyOfDate = (dt) => dayKey(dt.getFullYear(), dt.getMonth(), dt.getDate());

/** ISO string → local {date:'YYYY-MM-DD', time:'HH:mm'} for form inputs. */
function localParts(iso) {
  const d = new Date(iso);
  return { date: dayKey(d.getFullYear(), d.getMonth(), d.getDate()), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}
function hhmm(iso) {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ---------- Minimal cron expander (5-field: min hour dom month dow) ----------
   Used to plot recurring AI schedules onto calendar days. Times are evaluated
   in the browser's local timezone, which for this app is Asia/Bangkok. */
function parseCronField(field, min, max) {
  const out = new Set();
  for (const part of String(field).split(',')) {
    const [range, stepStr] = part.split('/');
    const step = stepStr ? parseInt(stepStr, 10) : 1;
    if (!step || step < 1) continue;
    let lo, hi;
    if (range === '*') { lo = min; hi = max; }
    else if (range.includes('-')) { const [a, b] = range.split('-').map(Number); lo = a; hi = b; }
    else { lo = hi = Number(range); }
    if (Number.isNaN(lo) || Number.isNaN(hi)) continue;
    for (let v = lo; v <= hi; v += step) if (v >= min && v <= max) out.add(v);
  }
  return out;
}
function parseCron(expr) {
  const f = String(expr).trim().split(/\s+/);
  if (f.length !== 5) return null;
  const minute = parseCronField(f[0], 0, 59);
  const hour = parseCronField(f[1], 0, 23);
  const month = parseCronField(f[3], 1, 12);
  const domSet = parseCronField(f[2], 1, 31);
  const dowSet = new Set([...parseCronField(f[4], 0, 7)].map((v) => (v === 7 ? 0 : v)));
  if (!minute.size || !hour.size || !month.size) return null;
  return { minute, hour, month, domSet, dowSet, domStar: f[2] === '*', dowStar: f[4] === '*' };
}
function cronRunsOnDay(cron, y, m, d) {
  if (!cron.month.has(m + 1)) return false;
  const dow = new Date(y, m, d).getDay();
  const domOk = cron.domSet.has(d);
  const dowOk = cron.dowSet.has(dow);
  // Vixie cron: if both day-of-month and day-of-week are restricted, either may match.
  if (cron.domStar && cron.dowStar) return true;
  if (cron.domStar) return dowOk;
  if (cron.dowStar) return domOk;
  return domOk || dowOk;
}
function cronTimes(cron) {
  const times = [];
  for (const h of [...cron.hour].sort((a, b) => a - b))
    for (const mi of [...cron.minute].sort((a, b) => a - b)) times.push(`${pad(h)}:${pad(mi)}`);
  return times;
}

export async function renderCalendar(view) {
  const now = new Date();
  if (state.y === undefined) { state.y = now.getFullYear(); state.m = now.getMonth(); }

  view.innerHTML = '';
  view.appendChild(el(`<div class="page-head">
    <div><h1>ปฏิทิน</h1><div class="sub">Broadcast ที่ตั้งเวลา + ตารางโพสต์ AI — คลิกเพื่อแก้ไข (Broadcast ลากย้ายวันได้)</div></div>
    <div class="btn-row">
      <button class="btn sm" data-today>วันนี้</button>
      <a class="btn primary" href="#/broadcast">＋ ตั้ง Broadcast</a>
    </div>
  </div>`));

  const bar = el(`<div class="cal-bar">
    <button class="btn sm" data-prev aria-label="เดือนก่อน">‹</button>
    <div class="cal-title">${TH_MONTHS[state.m]} ${state.y + 543}</div>
    <button class="btn sm" data-next aria-label="เดือนถัดไป">›</button>
  </div>`);
  view.appendChild(bar);

  view.appendChild(el(`<div class="cal-legend">
    <span><i class="dot feed"></i> Broadcast — เพจ</span>
    <span><i class="dot msg"></i> Broadcast — Messenger</span>
    <span><i class="dot ai"></i> ตารางโพสต์ AI (รันซ้ำตามรอบ)</span>
  </div>`));

  const wrap = el('<div class="cal-wrap"></div>');
  view.appendChild(wrap);

  const reload = () => renderCalendar(view);
  bar.querySelector('[data-prev]').addEventListener('click', () => { shiftMonth(-1); reload(); });
  bar.querySelector('[data-next]').addEventListener('click', () => { shiftMonth(1); reload(); });
  view.querySelector('[data-today]').addEventListener('click', () => {
    state.y = now.getFullYear(); state.m = now.getMonth(); reload();
  });

  const loading = loadingView();
  wrap.appendChild(loading);
  const [scheduled, schedules, pages] = await Promise.all([
    Endpoints.scheduledBroadcasts(),
    Endpoints.schedules(),
    Endpoints.pages(),
  ]);
  loading.remove();

  buildGrid(wrap, { scheduled, schedules, pages }, reload);
}

function shiftMonth(delta) {
  let m = state.m + delta;
  let y = state.y;
  if (m < 0) { m = 11; y -= 1; }
  if (m > 11) { m = 0; y += 1; }
  state.m = m; state.y = y;
}

function buildGrid(container, data, reload) {
  const { scheduled, schedules, pages } = data;

  // Broadcasts grouped by local calendar day.
  const bcByDay = new Map();
  for (const b of scheduled) {
    if (!b.scheduledAt) continue;
    const k = keyOfDate(new Date(b.scheduledAt));
    if (!bcByDay.has(k)) bcByDay.set(k, []);
    bcByDay.get(k).push(b);
  }

  // Active AI schedules with a parseable cron.
  const activeSchedules = schedules
    .filter((s) => s.isActive)
    .map((s) => ({ s, cron: parseCron(s.cronExpression) }))
    .filter((x) => x.cron);

  const cal = el('<div class="cal"></div>');
  for (const d of TH_DOW) cal.appendChild(el(`<div class="cal-dow">${d}</div>`));

  const startOffset = new Date(state.y, state.m, 1).getDay();
  const daysInMonth = new Date(state.y, state.m + 1, 0).getDate();
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  const todayKey = keyOfDate(new Date());

  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - startOffset + 1;
    if (dayNum < 1 || dayNum > daysInMonth) {
      cal.appendChild(el('<div class="cal-cell cal-cell-empty"></div>'));
      continue;
    }
    const key = dayKey(state.y, state.m, dayNum);
    const cell = el(`<div class="cal-cell" data-day="${key}">
      <div class="cal-daynum">${dayNum}</div>
      <div class="cal-items"></div>
    </div>`);
    if (key === todayKey) cell.classList.add('is-today');
    const items = cell.querySelector('.cal-items');

    // Merge broadcasts + AI occurrences for the day, ordered by time.
    const entries = [];
    for (const b of bcByDay.get(key) || []) {
      const dt = new Date(b.scheduledAt);
      entries.push({ min: dt.getHours() * 60 + dt.getMinutes(), node: broadcastChip(b, reload) });
    }
    for (const { s, cron } of activeSchedules) {
      if (!cronRunsOnDay(cron, state.y, state.m, dayNum)) continue;
      const times = cronTimes(cron);
      const [h, mi] = times[0].split(':').map(Number);
      entries.push({ min: h * 60 + mi, node: aiChip(s, times, pages, reload) });
    }
    entries.sort((a, b) => a.min - b.min);
    for (const e of entries) items.appendChild(e.node);

    wireDropTarget(cell, state.y, state.m, dayNum, reload);
    cal.appendChild(cell);
  }

  container.appendChild(cal);
  if (scheduled.length === 0 && activeSchedules.length === 0) {
    container.appendChild(el('<div class="cal-empty">ยังไม่มี Broadcast ที่ตั้งเวลา หรือ ตารางโพสต์ AI ที่เปิดใช้งาน</div>'));
  }
}

function broadcastChip(b, reload) {
  const icon = b.kind === 'messenger' ? '💬' : '📄';
  const snippet = (b.message || '').replace(/\s+/g, ' ').slice(0, 20);
  const c = el(`<button class="cal-chip cal-chip-${esc(b.kind)}" draggable="true" title="Broadcast: ${esc(b.message || '')}">
    <span class="cal-chip-time">${hhmm(b.scheduledAt)}</span>
    <span class="cal-chip-text">${icon} ${esc(snippet)}</span>
  </button>`);
  c.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', b.id);
    e.dataTransfer.effectAllowed = 'move';
    c.classList.add('dragging');
    DRAGGING.set(b.id, b);
  });
  c.addEventListener('dragend', () => c.classList.remove('dragging'));
  c.addEventListener('click', () => openBroadcastModal(b, reload));
  return c;
}

function aiChip(schedule, times, pages, reload) {
  const more = times.length > 1 ? ` ×${times.length}` : '';
  const name = (schedule.name || '').slice(0, 18);
  const c = el(`<button class="cal-chip cal-chip-ai" title="ตารางโพสต์ AI: ${esc(schedule.name)} (${esc(schedule.cronExpression)})">
    <span class="cal-chip-time">${esc(times[0])}${more}</span>
    <span class="cal-chip-text">🤖 ${esc(name)}</span>
  </button>`);
  // AI schedules recur — editing one occurrence edits the whole schedule, so open its editor.
  c.addEventListener('click', () => openScheduleEditor(schedule, pages, reload));
  return c;
}

// Broadcasts currently mid-drag, so a drop target can resolve the id → object.
const DRAGGING = new Map();

function wireDropTarget(cell, y, m, dayNum, reload) {
  cell.addEventListener('dragover', (e) => { e.preventDefault(); cell.classList.add('drop-over'); });
  cell.addEventListener('dragleave', () => cell.classList.remove('drop-over'));
  cell.addEventListener('drop', async (e) => {
    e.preventDefault();
    cell.classList.remove('drop-over');
    const id = e.dataTransfer.getData('text/plain');
    const b = DRAGGING.get(id);
    DRAGGING.delete(id);
    if (!b) return;

    const orig = new Date(b.scheduledAt);
    const target = new Date(y, m, dayNum, orig.getHours(), orig.getMinutes(), 0, 0);
    if (keyOfDate(target) === keyOfDate(orig)) return; // same day → no-op
    if (target.getTime() <= Date.now()) { toast('ย้ายไปวัน/เวลาในอดีตไม่ได้', 'err'); return; }
    try {
      await Endpoints.updateBroadcast(b.id, { scheduledAt: target.toISOString() });
      toast(`ย้ายไป ${target.getDate()} ${TH_MONTHS[target.getMonth()]} ${hhmm(target.toISOString())} แล้ว`, 'ok');
      reload();
    } catch (err) {
      toast(err.message || 'ย้ายไม่สำเร็จ', 'err');
    }
  });
}

function openBroadcastModal(b, reload) {
  const parts = localParts(b.scheduledAt);
  const kindLabel = b.kind === 'messenger' ? '💬 Messenger' : '📄 โพสต์ลงเพจ';
  const maxLen = b.kind === 'messenger' ? 2000 : 60000;

  const body = el(`<div>
    <div class="muted" style="margin-top:0">${kindLabel}</div>
    <div class="field" style="margin-top:16px">
      <label>ข้อความ</label>
      <textarea data-msg maxlength="${maxLen}"></textarea>
    </div>
    <div class="field">
      <label>ตั้งเวลาส่ง</label>
      <div class="sched-row">
        <div><div class="sched-sub">วันที่</div><input type="date" data-date value="${parts.date}" /></div>
        <div><div class="sched-sub">เวลา</div><input type="time" data-time value="${parts.time}" /></div>
      </div>
    </div>
  </div>`);
  body.querySelector('[data-msg]').value = b.message || '';

  const foot = el(`<div class="modal-foot">
    <button class="btn danger" data-del>ยกเลิกกำหนดการ</button>
    <div style="flex:1"></div>
    <button class="btn" data-cancel>ปิด</button>
    <button class="btn primary" data-save>บันทึก</button>
  </div>`);

  const modal = openModal('แก้ไข Broadcast ที่ตั้งเวลา', body, foot);
  foot.querySelector('[data-cancel]').addEventListener('click', modal.close);

  bindAsync(foot.querySelector('[data-del]'), async () => {
    if (!(await confirmDialog('ยกเลิกกำหนดการ Broadcast นี้?'))) return;
    await Endpoints.cancelBroadcast(b.id);
    toast('ยกเลิกแล้ว', 'ok');
    modal.close();
    reload();
  });

  bindAsync(foot.querySelector('[data-save]'), async () => {
    const message = body.querySelector('[data-msg]').value.trim();
    const date = body.querySelector('[data-date]').value;
    const time = body.querySelector('[data-time]').value;
    if (!message) return toast('กรุณาใส่ข้อความ', 'err');
    if (!date || !time) return toast('กรุณาเลือกทั้งวันที่และเวลา', 'err');
    const when = new Date(`${date}T${time}`);
    if (isNaN(when.getTime())) return toast('รูปแบบวันเวลาไม่ถูกต้อง', 'err');
    if (when.getTime() <= Date.now()) return toast('เวลาที่ตั้งต้องเป็นเวลาในอนาคต', 'err');
    await Endpoints.updateBroadcast(b.id, { message, scheduledAt: when.toISOString() });
    toast('บันทึกแล้ว', 'ok');
    modal.close();
    reload();
  });
}
