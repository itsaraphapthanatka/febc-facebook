import { Endpoints } from '../api.js';
import { el, esc, toast, statusBadge, fmtDate, loadingView } from '../ui.js';

export async function renderHistory(view) {
  view.innerHTML = '';
  view.appendChild(el(`<div class="page-head"><div>
    <h1>ประวัติ</h1><div class="sub">โพสต์ที่ผ่านมา และรายชื่อผู้ทักแชท Messenger</div>
  </div></div>`));

  const tabs = el(`<div class="tabs">
    <button class="tab active" data-tab="posts">โพสต์</button>
    <button class="tab" data-tab="recipients">ผู้ทักแชท</button>
  </div>`);
  view.appendChild(tabs);
  const body = el('<div></div>');
  view.appendChild(body);

  let current = 'posts';
  const draw = () => {
    tabs.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === current));
    body.innerHTML = '';
    if (current === 'posts') loadPosts(body);
    else loadRecipients(body);
  };
  tabs.querySelectorAll('.tab').forEach((t) =>
    t.addEventListener('click', () => { current = t.dataset.tab; draw(); }),
  );
  draw();
}

const SOURCE_LABEL = { broadcast: '📣 Broadcast', schedule: '🤖 AI', api: 'API' };

async function loadPosts(container) {
  container.appendChild(loadingView());
  try {
    const rows = await Endpoints.posts('?limit=100');
    container.innerHTML = '';
    if (!rows.length) {
      container.appendChild(el('<div class="card"><div class="empty">ยังไม่มีโพสต์</div></div>'));
      return;
    }
    const card = el('<div class="card table-wrap"></div>');
    const table = el(`<table><thead><tr>
      <th>ที่มา</th><th>เนื้อหา</th><th>สถานะ</th><th>Facebook Post</th><th>เมื่อ</th>
    </tr></thead><tbody></tbody></table>`);
    const tb = table.querySelector('tbody');
    for (const p of rows) {
      const snippet = (p.content || '').slice(0, 70);
      const link = p.fbPostId
        ? `<a href="https://facebook.com/${esc(p.fbPostId)}" target="_blank" rel="noopener" class="mono">เปิด ↗</a>`
        : (p.error ? `<span class="muted" title="${esc(p.error)}">—</span>` : '—');
      tb.appendChild(el(`<tr>
        <td>${SOURCE_LABEL[p.source] || esc(p.source)}</td>
        <td>${esc(snippet)}${p.content && p.content.length > 70 ? '…' : ''}</td>
        <td>${statusBadge(p.status)}</td>
        <td>${link}</td>
        <td class="muted">${fmtDate(p.publishedAt || p.createdAt)}</td>
      </tr>`));
    }
    card.appendChild(table);
    container.appendChild(card);
  } catch (err) {
    toast(err.message, 'err');
    container.innerHTML = `<div class="card"><div class="empty">${esc(err.message)}</div></div>`;
  }
}

async function loadRecipients(container) {
  container.appendChild(loadingView());
  try {
    const rows = await Endpoints.recipients('?limit=200');
    container.innerHTML = '';
    if (!rows.length) {
      container.appendChild(el(`<div class="card"><div class="empty">
        <div class="big">💬</div>
        <p>ยังไม่มีผู้ทักแชท</p>
        <div class="muted">เมื่อมีคนทักแชทเพจที่สมัคร Webhook แล้ว รายชื่อจะปรากฏที่นี่</div>
      </div></div>`));
      return;
    }
    const card = el('<div class="card table-wrap"></div>');
    const table = el(`<table><thead><tr>
      <th>PSID</th><th>ทักล่าสุด</th><th>สถานะ</th>
    </tr></thead><tbody></tbody></table>`);
    const tb = table.querySelector('tbody');
    const now = Date.now();
    for (const r of rows) {
      const within24h = now - new Date(r.lastInteractionAt).getTime() < 24 * 3600 * 1000;
      const status = r.optedOut
        ? '<span class="badge muted">ยกเลิกรับ</span>'
        : within24h
          ? '<span class="badge ok">ส่งได้ (ใน 24 ชม.)</span>'
          : '<span class="badge warn">นอก 24 ชม.</span>';
      tb.appendChild(el(`<tr>
        <td class="mono">${esc(r.psid)}</td>
        <td class="muted">${fmtDate(r.lastInteractionAt)}</td>
        <td>${status}</td>
      </tr>`));
    }
    card.appendChild(table);
    container.appendChild(card);
  } catch (err) {
    toast(err.message, 'err');
    container.innerHTML = `<div class="card"><div class="empty">${esc(err.message)}</div></div>`;
  }
}
