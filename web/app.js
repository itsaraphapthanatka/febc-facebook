import { Endpoints, getKey, setKey, clearKey, ApiError } from './api.js';
import { el, esc, toast } from './ui.js';
import { renderDashboard } from './views/dashboard.js';
import { renderPages } from './views/pages.js';
import { renderBroadcast } from './views/broadcast.js';
import { renderCalendar } from './views/calendar.js';
import { renderSchedules } from './views/schedules.js';
import { renderHistory } from './views/history.js';

const NAV = [
  { id: 'dashboard', label: 'ภาพรวม', ico: '📊', render: renderDashboard },
  { id: 'pages', label: 'เพจ', ico: '📄', render: renderPages },
  { id: 'broadcast', label: 'Broadcast', ico: '📣', render: renderBroadcast },
  { id: 'calendar', label: 'ปฏิทิน', ico: '📅', render: renderCalendar },
  { id: 'schedules', label: 'ตั้งเวลาโพสต์ (AI)', ico: '🤖', render: renderSchedules },
  { id: 'history', label: 'ประวัติ', ico: '🕑', render: renderHistory },
];

function currentRoute() {
  const h = location.hash.replace(/^#\//, '').split('?')[0];
  return NAV.find((n) => n.id === h) ? h : 'dashboard';
}

function renderShell() {
  const active = currentRoute();
  const app = document.getElementById('app');
  app.innerHTML = '';
  const layout = el(`<div class="layout">
    <aside class="sidebar">
      <div class="brand"><span class="logo">📣</span><span>FEBC Console</span></div>
      <nav class="nav"></nav>
      <div class="sidebar-foot">
        Facebook Page Middleware
        <button class="btn sm" data-logout style="width:100%">ออกจากระบบ</button>
      </div>
    </aside>
    <main class="main" id="view"></main>
  </div>`);
  const nav = layout.querySelector('.nav');
  for (const item of NAV) {
    const b = el(`<button class="nav-item ${item.id === active ? 'active' : ''}">
      <span class="ico">${item.ico}</span><span>${esc(item.label)}</span></button>`);
    b.addEventListener('click', () => { location.hash = `#/${item.id}`; });
    nav.appendChild(b);
  }
  layout.querySelector('[data-logout]').addEventListener('click', () => {
    clearKey();
    location.hash = '';
    renderApp();
  });
  app.appendChild(layout);

  const view = layout.querySelector('#view');
  const route = NAV.find((n) => n.id === active);
  Promise.resolve(route.render(view)).catch((err) => {
    if (err instanceof ApiError && err.status === 401) {
      clearKey();
      renderApp();
      return;
    }
    view.innerHTML = `<div class="empty"><div class="big">⚠️</div><p>${esc(err.message)}</p></div>`;
  });
}

function renderLogin() {
  const app = document.getElementById('app');
  app.innerHTML = '';
  const wrap = el(`<div class="login-wrap"><div class="card login-card">
    <div class="logo">📣</div>
    <h1>FEBC Facebook Console</h1>
    <p>ใส่ Admin API Key เพื่อเข้าใช้งาน</p>
    <div class="field">
      <input type="password" id="key-input" placeholder="Admin API Key" autocomplete="current-password" />
    </div>
    <button class="btn primary" id="login-btn" style="width:100%">เข้าสู่ระบบ</button>
    <p style="margin-top:16px;font-size:12px">คีย์นี้คือค่า <code>ADMIN_API_KEY</code> ในไฟล์ .env ของเซิร์ฟเวอร์</p>
  </div></div>`);
  app.appendChild(wrap);

  const input = wrap.querySelector('#key-input');
  const btn = wrap.querySelector('#login-btn');
  const submit = async () => {
    const val = input.value.trim();
    if (!val) return;
    setKey(val);
    btn.disabled = true;
    btn.textContent = 'กำลังตรวจสอบ…';
    try {
      await Endpoints.stats();
      toast('เข้าสู่ระบบสำเร็จ', 'ok');
      if (!location.hash) location.hash = '#/dashboard';
      renderApp();
    } catch (err) {
      clearKey();
      btn.disabled = false;
      btn.textContent = 'เข้าสู่ระบบ';
      toast(err.status === 401 ? 'API Key ไม่ถูกต้อง' : err.message, 'err');
    }
  };
  btn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  input.focus();
}

export function renderApp() {
  if (!getKey()) {
    renderLogin();
  } else {
    renderShell();
  }
}

// One-time success toast after OAuth redirect (/?connected=N#/pages)
function checkConnectedFlag() {
  const m = location.search.match(/[?&]connected=(\d+)/);
  if (m) {
    const n = Number(m[1]);
    setTimeout(() => toast(n > 0 ? `เชื่อมต่อสำเร็จ ${n} เพจ` : 'เข้าสู่ระบบ Facebook แล้ว แต่ยังไม่ได้เลือกเพจ', n > 0 ? 'ok' : 'err'), 300);
    history.replaceState(null, '', '/' + location.hash);
  }
}

window.addEventListener('hashchange', () => {
  if (getKey()) renderShell();
});

checkConnectedFlag();
renderApp();
