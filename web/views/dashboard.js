import { Endpoints } from '../api.js';
import { el, loadingView } from '../ui.js';

export async function renderDashboard(view) {
  view.innerHTML = '';
  view.appendChild(el(`<div class="page-head"><div>
    <h1>ภาพรวม</h1><div class="sub">สรุปสถานะระบบทั้งหมด</div>
  </div></div>`));
  const loading = loadingView();
  view.appendChild(loading);

  const s = await Endpoints.stats();
  loading.remove();

  const cards = [
    { label: 'เพจที่เชื่อมต่อ', value: s.pages.total, hint: `ใช้งานอยู่ ${s.pages.active} เพจ` },
    { label: 'ตารางโพสต์ AI', value: s.schedules.total, hint: `เปิดใช้งาน ${s.schedules.active}` },
    { label: 'โพสต์สำเร็จ', value: s.posts.published, hint: s.posts.failed ? `ล้มเหลว ${s.posts.failed}` : 'ไม่มีที่ล้มเหลว' },
    { label: 'Broadcast ทั้งหมด', value: s.broadcasts.total, hint: 'ครั้ง' },
    { label: 'ผู้ทักแชท (Messenger)', value: s.messengerRecipients.total, hint: `ส่งได้ตอนนี้ ${s.messengerRecipients.reachableNow} คน` },
  ];
  const grid = el('<div class="grid stat-grid"></div>');
  for (const c of cards) {
    grid.appendChild(el(`<div class="card stat">
      <div class="label">${c.label}</div>
      <div class="value">${c.value}</div>
      <div class="hint">${c.hint}</div>
    </div>`));
  }
  view.appendChild(grid);

  const quick = el(`<div class="card card-pad" style="margin-top:16px">
    <h3 style="margin-bottom:12px">ทางลัด</h3>
    <div class="btn-row">
      <a class="btn primary" href="#/broadcast">📣 ส่ง Broadcast</a>
      <a class="btn" href="#/schedules">🤖 ตั้งโพสต์อัตโนมัติ</a>
      <a class="btn" href="#/pages">📄 จัดการเพจ</a>
    </div>
  </div>`);
  view.appendChild(quick);
}
