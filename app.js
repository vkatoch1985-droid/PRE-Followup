/* ============================================================================
 *  SIDRA HOME HEALTHCARE — CRM FRONTEND (app.js)
 *  Single-page app for GitHub Pages. All data comes from the Apps Script API.
 * ==========================================================================*/
'use strict';

const CFG = Object.assign({ API_URL: '', POLL_SECONDS: 60, PAGE_SIZE: 25, UPLOAD_CHUNK: 150 }, window.SIDRA_CONFIG || {});
const ROLE = { SUPER: 'super_admin', ADMIN: 'admin', AGENT: 'agent' };
const ADM = [ROLE.SUPER, ROLE.ADMIN], ALL = [ROLE.SUPER, ROLE.ADMIN, ROLE.AGENT];
const S = { token: localStorage.getItem('sidra_token') || '', user: null, boot: null, agents: null, portal: 'admin',
  notifSince: '', unread: 0, notified: new Set(), charts: [], route: '', pollTimer: null, todayCount: 0 };

/* ------------------------------- DOM helpers ------------------------------ */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isAdmin = () => S.user && ADM.includes(S.user.role);
const isSuper = () => S.user && S.user.role === ROLE.SUPER;
const isAgent = () => S.user && S.user.role === ROLE.AGENT;
const debounce = (fn, ms = 350) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(s) { if (!s) return '—'; const [y, m, d] = String(s).slice(0, 10).split('-'); return y && m ? `${d} ${MONTHS[+m - 1]} ${y}` : s; }
function fmtDT(s) { if (!s) return '—'; return fmtDate(s) + (String(s).length > 10 ? ' · ' + String(s).slice(11, 16) : ''); }
function aed(n) { return 'AED ' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
function nf(n) { return Number(n || 0).toLocaleString('en-US'); }
function today() { return dubaiNow().slice(0, 10); }
function dubaiNow() { // yyyy-MM-dd HH:mm in Asia/Dubai regardless of the device timezone
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
function addDays(s, n) { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z]/g, '').replace('followuprequired', 'followup').replace('callbackscheduled', 'callback').replace('newbooking', 'new').replace('pendingpayment', 'pending').replace('completedwitherrors', 'failed'); }
function badge(s) { return s ? `<span class="badge b-${slug(s)}">${esc(s)}</span>` : ''; }
function roleLabel(r) { return { super_admin: 'Super Admin', admin: 'Admin', agent: 'Agent' }[r] || r; }
function initials(n) { return String(n || '?').split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase(); }
function waNumber(phone) { return String(phone || '').replace(/\D/g, ''); }
function fill(tpl, v) { return String(tpl || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => v[k] ?? ''); }
function serviceOptions(sel, { all = true, activeOnly = false } = {}) {
  return (all ? '<option value="">All services</option>' : '') + (S.boot.services || []).filter(s => !activeOnly || s.status === 'Active')
    .map(s => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)}${s.status !== 'Active' ? ' (inactive)' : ''}</option>`).join('');
}
function statusOptions(list, sel, allLabel) { return (allLabel ? `<option value="">${allLabel}</option>` : '') + list.map(s => `<option ${s === sel ? 'selected' : ''}>${esc(s)}</option>`).join(''); }
async function agentList(force) { if (!isAdmin()) return []; if (!S.agents || force) S.agents = await api('listAgents', {}, { quiet: true }); return S.agents; }
function agentOptions(sel, { all = 'All agents', unassigned = false, activeOnly = false } = {}) {
  return (all ? `<option value="">${all}</option>` : '') + (unassigned ? `<option value="unassigned" ${sel === 'unassigned' ? 'selected' : ''}>Unassigned queue</option>` : '') +
    (S.agents || []).filter(a => !activeOnly || a.status === 'Active').map(a => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.name)}${a.status !== 'Active' ? ' (disabled)' : ''}</option>`).join('');
}

/* ------------------------------- Icons ------------------------------------ */
const ICON_PATHS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
  agent: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7" cy="7" r="1.5"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  wa: '<path d="M21 11.5a8.4 8.4 0 0 1-12.5 7.3L3 21l2.3-5.3A8.4 8.4 0 1 1 21 11.5z"/>',
  note: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  swap: '<path d="m16 3 4 4-4 4M20 7H4M8 21l-4-4 4-4M4 17h16"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  aed: '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'
};
const icon = (n, s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[n] || ''}</svg>`;

/* ------------------------------- API -------------------------------------- */
let pending = 0;
function loading(d) { pending = Math.max(0, pending + d); $('#loader').classList.toggle('hidden', pending === 0); }
async function api(action, payload = {}, opt = {}) {
  if (!CFG.API_URL || /PASTE|YOUR/i.test(CFG.API_URL)) throw new Error('The API URL is not configured. Edit config.js and paste your Apps Script Web App URL.');
  if (!opt.quiet) loading(1);
  try {
    // text/plain body = "simple" CORS request → no preflight, works with Apps Script web apps
    const res = await fetch(CFG.API_URL, { method: 'POST', body: JSON.stringify({ action, token: S.token, payload }), redirect: 'follow' });
    let j;
    try { j = await res.json(); } catch (e) { throw new Error('The server returned an unexpected response. Check the Web App deployment.'); }
    if (!j.success) {
      if (j.code === 'AUTH' && action !== 'login') { clearSession(); showAuth(); }
      const err = new Error(j.message || 'Request failed'); err.code = j.code; throw err;
    }
    return j.data;
  } catch (e) {
    if (e instanceof TypeError) throw new Error('Network error — check your internet connection and the API URL.');
    throw e;
  } finally { if (!opt.quiet) loading(-1); }
}
async function run(fn, okMsg) { // wraps an async action with toast feedback
  try { const r = await fn(); if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg, 'ok'); return r; }
  catch (e) { toast(e.message, 'error'); throw e; }
}

/* ------------------------------- Toast / modal ---------------------------- */
function toast(msg, type = '') {
  const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg;
  $('#toastRoot').appendChild(t); setTimeout(() => t.remove(), type === 'error' ? 6500 : 4000);
}
function modal({ title, body, foot = '', size = '', onMount, onClose, dismissable = true, autofocus = true }) {
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true"><div class="modal-head"><h3>${title}</h3><span class="spacer"></span>
    ${dismissable ? `<button class="icon-btn" data-close aria-label="Close">${icon('x', 18)}</button>` : ''}</div>
    <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div>`;
  $('#modalRoot').appendChild(bg);
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); if (onClose) onClose(); };
  const onKey = (e) => { if (e.key === 'Escape' && dismissable) close(); };
  document.addEventListener('keydown', onKey);
  bg.addEventListener('click', (e) => { if (dismissable && (e.target === bg || e.target.closest('[data-close]'))) close(); });
  const m = { el: bg, close, $: (s) => $(s, bg), $$: (s) => $$(s, bg) };
  if (onMount) onMount(m);
  const first = autofocus && $('input:not([type=hidden]):not([readonly]), select, textarea', bg); if (first) setTimeout(() => first.focus(), 30);
  return m;
}
function confirmBox(message, { title = 'Please confirm', ok = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    const m = modal({ title, body: `<p>${message}</p>`, foot: `<button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-brand'}" id="cfOk">${ok}</button>` });
    m.el.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === m.el) resolve(false); });
    m.$('#cfOk').onclick = () => { m.close(); resolve(true); };
  });
}
function formData(root) {
  const o = {};
  $$('[name]', root).forEach(el => {
    if (el.type === 'checkbox') { if (el.dataset.multi !== undefined) { (o[el.name] = o[el.name] || []); if (el.checked) o[el.name].push(el.value); } else o[el.name] = el.checked; }
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
    else if (el.multiple) o[el.name] = Array.from(el.selectedOptions).map(x => x.value);
    else o[el.name] = el.value.trim();
  });
  return o;
}

/* ------------------------------- CSV export ------------------------------- */
function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?\d/.test(s)) s = "'" + s; // spreadsheet formula-injection guard
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function downloadCSV(name, cols, rows) {
  const csv = [cols.map(c => csvCell(c.label)).join(',')].concat(rows.map(r => cols.map(c => csvCell(typeof c.value === 'function' ? c.value(r) : r[c.key])).join(','))).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = name.replace(/\s+/g, '_') + '_' + today() + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ------------------------------- Data table ------------------------------- */
/**
 * Generic server-paginated table.
 * opts: { columns:[{key,label,sort,num,render}], load(params), params, selectable, rowClass(r), onAction(act,row,el), empty }
 */
function dataTable(host, opts) {
  const st = { params: Object.assign({ page: 1, pageSize: CFG.PAGE_SIZE }, opts.params || {}), selected: new Set(), data: { rows: [], total: 0 } };
  host.innerHTML = '<div class="table-wrap"></div><div class="pager"></div>';
  const wrap = $('.table-wrap', host), pager = $('.pager', host);
  async function reload() {
    try { st.data = await opts.load(st.params); } catch (e) { toast(e.message, 'error'); st.data = { rows: [], total: 0 }; }
    draw();
  }
  function draw() {
    const rows = st.data.rows || [], cols = opts.columns;
    const allSel = rows.length && rows.every(r => st.selected.has(r.id));
    wrap.innerHTML = `<table class="tbl"><thead><tr>${opts.selectable ? `<th style="width:34px"><input type="checkbox" data-selall ${allSel ? 'checked' : ''} aria-label="Select all"></th>` : ''}
      ${cols.map(c => `<th class="${c.sort ? 'sortable' : ''} ${c.num ? 'num' : ''}" ${c.sort ? `data-sort="${c.sort === true ? c.key : c.sort}"` : ''}>${esc(c.label)}${st.params.sort === (c.sort === true ? c.key : c.sort) ? `<span class="arr">${st.params.dir === 'asc' ? ' ▲' : ' ▼'}</span>` : ''}</th>`).join('')}</tr></thead>
      <tbody>${rows.length ? rows.map((r, i) => `<tr data-i="${i}" class="${st.selected.has(r.id) ? 'sel' : ''} ${opts.rowClass ? opts.rowClass(r) : ''}">
        ${opts.selectable ? `<td><input type="checkbox" data-sel="${esc(r.id)}" ${st.selected.has(r.id) ? 'checked' : ''} aria-label="Select row"></td>` : ''}
        ${cols.map(c => `<td class="${c.num ? 'num' : ''}">${c.render ? c.render(r) : esc(r[c.key] ?? '')}</td>`).join('')}</tr>`).join('')
        : `<tr><td colspan="${cols.length + (opts.selectable ? 1 : 0)}"><div class="empty">${opts.empty || '<b>Nothing here yet</b>No records match the current filters.'}</div></td></tr>`}</tbody></table>`;
    const pages = Math.max(1, Math.ceil((st.data.total || 0) / (st.data.pageSize || st.params.pageSize)));
    pager.innerHTML = `<span>${nf(st.data.total || 0)} record(s)${st.selected.size ? ` · <b>${st.selected.size} selected</b>` : ''}</span><span class="spacer"></span>
      <select data-size style="width:auto;padding:4px 6px">${[10, 25, 50, 100, 250].map(n => `<option ${n === +st.params.pageSize ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <button class="btn btn-sm" data-pg="-1" ${st.params.page <= 1 ? 'disabled' : ''}>‹ Prev</button><span>Page ${st.params.page} of ${pages}</span>
      <button class="btn btn-sm" data-pg="1" ${st.params.page >= pages ? 'disabled' : ''}>Next ›</button>`;
    if (opts.onDraw) opts.onDraw(st);
  }
  host.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (th) { const k = th.dataset.sort; st.params.dir = st.params.sort === k && st.params.dir === 'asc' ? 'desc' : 'asc'; st.params.sort = k; st.params.page = 1; return reload(); }
    const pg = e.target.closest('[data-pg]'); if (pg) { st.params.page += +pg.dataset.pg; return reload(); }
    const act = e.target.closest('[data-act]');
    if (act && opts.onAction) { e.preventDefault(); const tr = act.closest('tr'); const row = st.data.rows[+tr.dataset.i]; return opts.onAction(act.dataset.act, row, act); }
    if (opts.onRowClick && !e.target.closest('input,button,a,select')) { const tr = e.target.closest('tbody tr[data-i]'); if (tr) opts.onRowClick(st.data.rows[+tr.dataset.i]); }
  });
  host.addEventListener('change', (e) => {
    if (e.target.matches('[data-size]')) { st.params.pageSize = +e.target.value; st.params.page = 1; return reload(); }
    if (e.target.matches('[data-sel]')) { e.target.checked ? st.selected.add(e.target.dataset.sel) : st.selected.delete(e.target.dataset.sel); draw(); }
    if (e.target.matches('[data-selall]')) { (st.data.rows || []).forEach(r => e.target.checked ? st.selected.add(r.id) : st.selected.delete(r.id)); draw(); }
  });
  return { st, reload, draw, set(p) { Object.assign(st.params, p, { page: 1 }); return reload(); }, clearSel() { st.selected.clear(); draw(); } };
}

/* ------------------------------- Charts ----------------------------------- */
const PALETTE = ['#E50D07', '#F7931E', '#FFB800', '#AA2502', '#F26A1B', '#7E1C00', '#FFD27A', '#C2410C', '#FDBA74', '#5B1300'];
function chart(canvas, type, labels, datasets, extra = {}) {
  if (!window.Chart || !canvas) return;
  const c = new Chart(canvas, { type, data: { labels, datasets: datasets.map((d, i) => Object.assign({
    backgroundColor: type === 'doughnut' || type === 'pie' ? PALETTE : (type === 'line' ? PALETTE[i] + '22' : PALETTE[i % PALETTE.length]),
    borderColor: type === 'doughnut' ? '#fff' : PALETTE[i % PALETTE.length], borderWidth: type === 'line' ? 2.5 : (type === 'doughnut' ? 2 : 0),
    borderRadius: type === 'bar' ? 6 : 0, tension: .35, fill: type === 'line' && datasets.length === 1, pointRadius: type === 'line' ? 2 : 0, maxBarThickness: 38 }, d)) },
    options: Object.assign({ responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: datasets.length > 1 || type === 'doughnut', position: 'bottom', labels: { boxWidth: 10, font: { family: 'Inter', size: 11 } } },
        tooltip: { callbacks: extra.money ? { label: (x) => ` ${x.dataset.label ? x.dataset.label + ': ' : ''}${aed(x.parsed.y ?? x.parsed)}` } : {} } },
      scales: type === 'doughnut' ? {} : { x: { grid: { display: false }, ticks: { font: { size: 11 }, maxRotation: 0, autoSkip: true } },
        y: { beginAtZero: true, grid: { color: '#F4EEEB' }, ticks: { precision: 0, font: { size: 11 }, callback: extra.money ? (v) => 'AED ' + nf(v) : (extra.pct ? (v) => v + '%' : undefined) } } } }, extra.options || {}) });
  S.charts.push(c); return c;
}
function destroyCharts() { S.charts.forEach(c => { try { c.destroy(); } catch (e) { /* ignore */ } }); S.charts = []; }
function whenChartsReady(fn) { if (window.Chart) fn(); else setTimeout(() => whenChartsReady(fn), 120); }

/* ============================================================================
 *  AUTHENTICATION
 * ==========================================================================*/
function clearSession() { S.token = ''; S.user = null; localStorage.removeItem('sidra_token'); clearInterval(S.pollTimer); }
function showAuth() {
  $('#app').classList.add('hidden'); $('#auth').classList.remove('hidden');
  const setup = new URLSearchParams(location.search).get('setup');
  $('#loginForm').classList.toggle('hidden', !!setup); $('#setupForm').classList.toggle('hidden', !setup);
  setPortal(S.portal);
}
function setPortal(p) {
  S.portal = p;
  $('#portalLabel').textContent = p === 'admin' ? 'Admin sign in' : 'Team member sign in';
  $('#portalSwitch').innerHTML = p === 'admin' ? 'Team member? <a href="#" data-portal="member">Go to member sign in</a>' : 'Administrator? <a href="#" data-portal="admin">Go to admin sign in</a>';
}
document.addEventListener('click', (e) => {
  const p = e.target.closest('[data-portal]'); if (p) { e.preventDefault(); setPortal(p.dataset.portal); $('#loginError').textContent = ''; }
  const t = e.target.closest('[data-toggle-pw]'); if (t) { const i = document.getElementById(t.dataset.togglePw); i.type = i.type === 'password' ? 'text' : 'password'; t.textContent = i.type === 'password' ? 'Show' : 'Hide'; }
});
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#loginBtn'); $('#loginError').textContent = ''; btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const r = await api('login', { email: $('#loginEmail').value, password: $('#loginPassword').value, portal: S.portal });
    S.token = r.token; localStorage.setItem('sidra_token', r.token); $('#loginPassword').value = '';
    startApp(r.user, r.boot);
  } catch (err) { $('#loginError').textContent = err.message; }
  finally { btn.disabled = false; btn.textContent = 'Sign in'; }
});
$('#setupForm').addEventListener('submit', async (e) => {
  e.preventDefault(); $('#setupError').textContent = '';
  const a = $('#setupPw').value, b = $('#setupPw2').value;
  if (a !== b) { $('#setupError').textContent = 'Passwords do not match.'; return; }
  try {
    const r = await api('completeSetup', { token: new URLSearchParams(location.search).get('setup'), password: a });
    history.replaceState(null, '', location.pathname);
    S.portal = r.role === ROLE.AGENT ? 'member' : 'admin'; showAuth(); $('#loginEmail').value = r.email;
    toast('Password saved. You can now sign in.', 'ok');
  } catch (err) { $('#setupError').textContent = err.message; }
});

function changePasswordModal(forced) {
  const m = modal({ title: forced ? 'Please set a new password' : 'Change password', dismissable: !forced,
    body: `${forced ? '<p class="muted">You signed in with a temporary password. Choose a new one to continue.</p>' : ''}
      <label class="field"><span>Current password</span><input type="password" name="currentPassword" autocomplete="current-password"></label>
      <label class="field"><span>New password (min 8 chars, letters + numbers)</span><input type="password" name="newPassword" autocomplete="new-password"></label>
      <label class="field"><span>Confirm new password</span><input type="password" name="confirm" autocomplete="new-password"></label><div class="form-error" id="cpErr"></div>`,
    foot: `${forced ? '' : '<button class="btn" data-close>Cancel</button>'}<button class="btn btn-brand" id="cpSave">Save password</button>` });
  m.$('#cpSave').onclick = async () => {
    const f = formData(m.el);
    if (f.newPassword !== f.confirm) { m.$('#cpErr').textContent = 'Passwords do not match.'; return; }
    try { await api('changePassword', f); S.user.mustChangePassword = false; m.close(); toast('Password updated.', 'ok'); }
    catch (e) { m.$('#cpErr').textContent = e.message; }
  };
}

async function logout() {
  try { await api('logout', {}, { quiet: true }); } catch (e) { /* ignore */ }
  clearSession(); destroyCharts(); location.hash = ''; showAuth();
}

/* ============================================================================
 *  APP SHELL, NAVIGATION & ROUTER
 * ==========================================================================*/
const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'grid', roles: ALL },
  { id: 'leads', label: 'Leads', icon: 'inbox', roles: ALL },
  { id: 'clients', label: 'Clients', icon: 'users', roles: ALL },
  { id: 'today', label: "Today's Follow-ups", icon: 'phone', roles: ALL, count: true },
  { id: 'followups', label: 'All Follow-ups', icon: 'list', roles: ALL },
  { id: 'journeys', label: 'Client Journeys', icon: 'route', roles: ALL },
  { id: 'agents', label: 'Agents', icon: 'agent', roles: ADM },
  { id: 'services', label: 'Services', icon: 'tag', roles: ADM },
  { id: 'bookings', label: 'Bookings', icon: 'calendar', roles: ALL },
  { id: 'upload', label: 'Bulk Upload', icon: 'upload', roles: ADM },
  { id: 'email', label: 'Bulk Email', icon: 'mail', roles: ADM },
  { id: 'requests', label: 'Client Requests', icon: 'hand', roles: ALL },
  { id: 'reports', label: 'Reports', icon: 'chart', roles: ADM },
  { id: 'notifications', label: 'Notifications', icon: 'bell', roles: ALL },
  { id: 'settings', label: 'Settings', icon: 'cog', roles: [ROLE.SUPER] },
  { id: 'users', label: 'User Management', icon: 'shield', roles: [ROLE.SUPER] }
];
const VIEWS = {}; // filled in below: id -> async (host, query) => void

function startApp(user, boot) {
  S.user = user; S.boot = boot; S.agents = null;
  $('#auth').classList.add('hidden'); $('#app').classList.remove('hidden');
  $('#userName').textContent = user.name; $('#userRole').textContent = roleLabel(user.role); $('#userAvatar').textContent = initials(user.name);
  renderNav(); route();
  if (user.mustChangePassword) changePasswordModal(true);
  startPolling();
  if (isAgent()) setTimeout(dailyPlanPopup, 600);
  if ('Notification' in window && Notification.permission === 'default') setTimeout(() => toast('Tip: enable browser notifications from your profile menu (top right) to get follow-up reminders.'), 2500);
}
function renderNav() {
  const items = NAV.filter(n => n.roles.includes(S.user.role));
  $('#nav').innerHTML = items.map(n => `<a href="#/${n.id}" data-nav="${n.id}">${icon(n.icon, 18)}<span>${n.label}</span>${n.count ? `<span class="count ${S.todayCount ? '' : 'hidden'}" id="navCount">${S.todayCount}</span>` : ''}</a>`).join('');
}
function parseHash() {
  const h = location.hash.replace(/^#\/?/, ''); const [path, qs] = h.split('?');
  return { id: path || 'dashboard', q: Object.fromEntries(new URLSearchParams(qs || '')) };
}
async function route() {
  if (!S.user) return;
  const { id, q } = parseHash();
  const item = NAV.find(n => n.id === id && n.roles.includes(S.user.role)) || NAV[0];
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === item.id));
  $('#pageTitle').textContent = item.label; $('#pageSub').textContent = '';
  closeSidebar(); destroyCharts();
  const host = $('#view'); host.innerHTML = '<div class="empty">Loading…</div>';
  S.route = item.id; S.reload = null; S.profileOpen = null;
  try { await VIEWS[item.id](host, q); } catch (e) { host.innerHTML = `<div class="card card-pad"><div class="empty"><b>Could not load this page</b>${esc(e.message)}</div></div>`; }
}
window.addEventListener('hashchange', route);
function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
function closeSidebar() { $('#sidebar').classList.remove('open'); $('#backdrop').classList.remove('open'); }
$('#openSidebar').onclick = () => { $('#sidebar').classList.add('open'); $('#backdrop').classList.add('open'); };
$('#closeSidebar').onclick = closeSidebar; $('#backdrop').onclick = closeSidebar;
$('#userChip').onclick = (e) => { e.stopPropagation(); $('#userDropdown').classList.toggle('hidden'); };
document.addEventListener('click', () => $('#userDropdown').classList.add('hidden'));
$('#userDropdown').addEventListener('click', (e) => {
  const a = e.target.closest('[data-action]')?.dataset.action;
  if (a === 'logout') logout();
  if (a === 'change-password') changePasswordModal(false);
  if (a === 'enable-notifications') requestNotifyPermission();
});
$('#bellBtn').onclick = () => go('#/notifications');

/* ============================================================================
 *  BROWSER NOTIFICATIONS & POLLING
 * ==========================================================================*/
async function requestNotifyPermission() {
  if (!('Notification' in window)) return toast('This browser does not support notifications.', 'error');
  const p = await Notification.requestPermission();
  toast(p === 'granted' ? 'Browser notifications enabled. They work while the CRM is open in a tab.' : 'Notifications were not allowed. You can change this in your browser settings.', p === 'granted' ? 'ok' : 'error');
  if (p === 'granted') browserNotify('Notifications enabled', 'You will be alerted about new leads, follow-ups and callbacks while the CRM is open.');
}
function browserNotify(title, body, key) {
  if (key) { if (S.notified.has(key)) return; S.notified.add(key); }
  if ('Notification' in window && Notification.permission === 'granted') {
    try { const n = new Notification(title, { body, icon: 'assets/favicon.png', tag: key || undefined }); n.onclick = () => { window.focus(); n.close(); }; } catch (e) { /* ignore */ }
  }
}
function startPolling() { clearInterval(S.pollTimer); poll(true); S.pollTimer = setInterval(() => poll(false), CFG.POLL_SECONDS * 1000); }
async function poll(first) {
  if (!S.token) return;
  try {
    const r = await api('listNotifications', { since: S.notifSince }, { quiet: true });
    S.unread = r.unread; $('#bellCount').textContent = r.unread > 99 ? '99+' : r.unread; $('#bellCount').classList.toggle('hidden', !r.unread);
    if (!first) r.fresh.forEach(n => { browserNotify(n.title, n.message, n.id); toast(n.title + ': ' + n.message); });
    S.notifSince = r.serverTime;
    if (r.live) {
      S.todayCount = r.live.dueToday + r.live.overdue;
      const nc = $('#navCount'); if (nc) { nc.textContent = S.todayCount; nc.classList.toggle('hidden', !S.todayCount); }
      const now = dubaiNow(), [d, hm] = now.split(' ');
      r.live.callbacks.forEach(c => { // alert 15 minutes before a scheduled callback (and when it becomes due)
        const mins = (+c.time.slice(0, 2) * 60 + +c.time.slice(3)) - (+hm.slice(0, 2) * 60 + +hm.slice(3));
        if (mins <= 15 && mins > -60) browserNotify('Callback ' + (mins > 0 ? `in ${mins} min` : 'due now'), `${c.clientName} at ${c.time}${c.reason ? ' — ' + c.reason : ''}`, 'cb-' + c.taskId + '-' + d);
      });
      if (r.live.overdue) {
        browserNotify('Overdue follow-ups', `You have ${r.live.overdue} overdue follow-up(s).`, 'overdue-' + d);
        showBanner(`⚠ You have <b>${r.live.overdue}</b> overdue follow-up(s). Please complete them — anything pending after 9:00 PM is reported to management. <a href="#/today">Open list</a>`, 'danger');
      } else if (r.live.dueToday) showBanner(`You have <b>${r.live.dueToday}</b> follow-up(s) due today. <a href="#/today">Start calling</a>`);
      else showBanner('');
      if (first && r.live.dueToday) browserNotify("Today's follow-ups", `${r.live.dueToday} follow-up(s) are due today.`, 'today-' + d);
    }
  } catch (e) { /* silent */ }
}
function showBanner(html, cls = '') { const b = $('#banner'); b.className = 'banner ' + cls + (html ? '' : ' hidden'); b.innerHTML = html ? `<span>${html}</span>` : ''; }
async function dailyPlanPopup() {
  const key = 'sidra_plan_' + S.user.id + '_' + today();
  if (localStorage.getItem(key)) return;
  localStorage.setItem(key, '1');
  try {
    const t = await api('listTasks', { scope: 'today', pageSize: 200 }, { quiet: true });
    const over = t.rows.filter(x => x.overdue).length;
    modal({ title: `Good ${+dubaiNow().slice(11, 13) < 12 ? 'morning' : 'day'}, ${esc(S.user.name.split(' ')[0])} 👋`,
      body: `<div class="kpis" style="grid-template-columns:repeat(3,1fr)"><div class="kpi"><div class="label">Due today</div><div class="value">${t.total - over}</div></div>
        <div class="kpi warn"><div class="label">Overdue</div><div class="value">${over}</div></div><div class="kpi"><div class="label">Callbacks with time</div><div class="value">${t.rows.filter(x => x.dueTime).length}</div></div></div>
        ${t.rows.slice(0, 8).map(x => `<div class="gap" style="padding:6px 0;border-bottom:1px solid var(--line-2)"><b>${esc(x.clientName)}</b><span class="muted small">${esc(x.service)} · ${esc(x.label)}</span><span class="spacer"></span>${x.overdue ? badge('Overdue') : (x.dueTime ? `<span class="tag">${x.dueTime}</span>` : '')}</div>`).join('') || '<p class="muted">No follow-ups scheduled for today. 🎉</p>'}
        ${t.total > 8 ? `<p class="muted small">+ ${t.total - 8} more</p>` : ''}`,
      foot: `<button class="btn" data-close>Later</button><a class="btn btn-brand" href="#/today" data-close>Open today's follow-ups</a>` });
  } catch (e) { /* ignore */ }
}

/* ============================================================================
 *  SHARED CLIENT / LEAD ACTIONS (call, WhatsApp, email, notes, reschedule…)
 * ==========================================================================*/
const OUTCOMES = ['Answered', 'No Answer', 'Busy', 'Interested', 'Not Interested', 'Callback Requested', 'Follow-up Required', 'Wrong Number', 'Booked', 'WhatsApp Sent', 'Email Sent'];
const ctxOf = (r) => ({ leadId: r.leadId || r.id, clientId: r.clientId, clientName: r.clientName, phone: r.phone, email: r.email, service: r.service,
  agentName: r.agentName, status: r.leadStatus || r.status, taskId: r.taskId || (r.label ? r.id : ''), serviceId: r.serviceId });
const afterChange = () => { if (S.profileOpen) S.profileOpen(); if (S.reload) S.reload(); poll(true); };

function callClient(c) {
  if (!c.phone) return toast('No phone number on file.', 'error');
  api('logContact', { leadId: c.leadId, channel: 'call' }, { quiet: true }).catch(() => {});
  location.href = 'tel:' + c.phone;
  setTimeout(() => toast('After the call, add a note to record the outcome.'), 1200);
}
function openWhatsApp(c) {
  if (!c.phone) return toast('No phone number on file.', 'error');
  const msg = fill(S.boot.whatsappTemplate, { clientName: c.clientName, agentName: S.user.name, service: c.service });
  const m = modal({ title: 'WhatsApp ' + esc(c.clientName), body: `<p class="muted small">Edit the message, then open WhatsApp. The message is <b>not</b> sent automatically — you press Send inside WhatsApp.</p>
      <label class="field"><span>To</span><input value="${esc(c.phone)}" readonly></label>
      <label class="field"><span>Message</span><textarea id="waMsg" rows="6">${esc(msg)}</textarea></label>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn btn-brand" id="waGo">${icon('wa')} Open WhatsApp</button>` });
  m.$('#waGo').onclick = () => {
    const text = m.$('#waMsg').value;
    window.open(`https://wa.me/${waNumber(c.phone)}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    api('logContact', { leadId: c.leadId, channel: 'whatsapp', message: text }, { quiet: true }).catch(() => {});
    m.close(); toast('WhatsApp opened. Remember to add a call note with the outcome.');
  };
}
async function openEmail(c) {
  let d; try { d = await api('emailDraft', { leadId: c.leadId }); } catch (e) { return toast(e.message, 'error'); }
  const m = modal({ title: 'Email ' + esc(c.clientName), size: 'wide',
    body: `<div class="form-grid"><label class="field full"><span>To</span><input value="${esc(d.to)}" readonly></label>
      <label class="field full"><span>Subject</span><input id="emSub" value="${esc(d.subject)}"></label>
      <label class="field"><span>Message (editable)</span><textarea id="emBody" rows="14">${esc(d.body)}</textarea></label>
      <div class="field"><span style="display:block;font-size:12px;font-weight:600;margin-bottom:6px">Preview</span><div class="preview-box" id="emPrev"></div></div></div>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn btn-brand" id="emSend">${icon('mail')} Send email</button>` });
  const prev = () => { m.$('#emPrev').innerHTML = `<b>${esc(m.$('#emSub').value)}</b><hr style="border:0;border-top:1px solid var(--line)">${esc(m.$('#emBody').value).replace(/\n/g, '<br>')}`; };
  m.$('#emSub').oninput = prev; m.$('#emBody').oninput = prev; prev();
  m.$('#emSend').onclick = async () => {
    m.$('#emSend').disabled = true;
    try { await run(() => api('sendClientEmail', { leadId: c.leadId, subject: m.$('#emSub').value, body: m.$('#emBody').value }), 'Email sent and saved to the client history.'); m.close(); afterChange(); }
    catch (e) { m.$('#emSend').disabled = false; }
  };
}
function openNote(c, { complete = false } = {}) {
  const m = modal({ title: (complete ? 'Complete follow-up · ' : 'Add call note · ') + esc(c.clientName),
    body: `<div class="form-grid">
      <label class="field"><span>Call outcome *</span><select name="outcome"><option value="">Select…</option>${OUTCOMES.map(o => `<option>${o}</option>`).join('')}</select></label>
      <label class="field"><span>Client interest level</span><select name="interest"><option value="">—</option><option>High</option><option>Medium</option><option>Low</option><option>None</option></select></label>
      <label class="field"><span>Call date</span><input type="date" name="callDate" value="${today()}"></label>
      <label class="field"><span>Call time</span><input type="time" name="callTime" value="${dubaiNow().slice(11)}"></label>
      <label class="field full"><span>Notes</span><textarea name="notes" placeholder="What did the client say? (no clinical details)"></textarea></label>
      <label class="field"><span>Next follow-up date (optional)</span><input type="date" name="nextFollowUp" min="${today()}"></label>
      <label class="field"><span>Next follow-up time</span><input type="time" name="nextTime"></label>
      <label class="field full"><span>Reschedule reason</span><input name="rescheduleReason" placeholder="e.g. Client asked to call after 6 PM"></label>
      <label class="field full"><span>Update lead status (optional)</span><select name="leadStatus"><option value="">Set automatically from outcome</option>${S.boot.leadStatuses.filter(s => !['Closed', 'Overdue'].includes(s)).map(s => `<option>${s}</option>`).join('')}</select></label></div>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn btn-brand" id="noteSave">${complete ? icon('check') + ' Save & complete' : 'Save note'}</button>` });
  m.$('#noteSave').onclick = async () => {
    const f = formData(m.el);
    if (!f.outcome) return toast('Please choose the call outcome.', 'error');
    if (!f.notes && !(await confirmBox('You have not written any notes. Notes help the team understand the client history. Save without notes?', { ok: 'Save anyway' }))) return;
    try {
      if (complete) await run(() => api('completeTask', Object.assign(f, { taskId: c.taskId })), 'Follow-up completed and note saved.');
      else await run(() => api('addNote', Object.assign(f, { leadId: c.leadId, taskId: c.taskId })), 'Note saved.');
      m.close(); afterChange();
      if (f.outcome === 'Booked' && await confirmBox('Create the booking now?', { ok: 'Create booking' })) openBooking(c);
    } catch (e) { /* toast shown */ }
  };
}
function openReschedule(c) {
  const t = today(), nextMon = addDays(t, 7);
  const quick = [['Tomorrow', addDays(t, 1)], ['In 2 days', addDays(t, 2)], ['In 3 days', addDays(t, 3)], ['Next week', nextMon]];
  const m = modal({ title: 'Reschedule · ' + esc(c.clientName),
    body: `<div class="quick">${quick.map(([l, d]) => `<button class="chip" data-d="${d}">${l}<br><small class="muted">${fmtDate(d)}</small></button>`).join('')}</div>
      <div class="form-grid"><label class="field"><span>Date *</span><input type="date" name="date" min="${t}" value="${addDays(t, 1)}"></label>
      <label class="field"><span>Time (optional)</span><input type="time" name="time"></label>
      <label class="field full"><span>Reason</span><input name="reason" placeholder="Client requested a callback tomorrow at 11 AM."></label></div>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn btn-brand" id="rsSave">${icon('clock')} Reschedule</button>` });
  m.$$('[data-d]').forEach(b => b.onclick = () => { m.$('[name=date]').value = b.dataset.d; m.$$('[data-d]').forEach(x => x.classList.toggle('on', x === b)); });
  m.$('#rsSave').onclick = async () => {
    const f = formData(m.el);
    try { await run(() => api('rescheduleTask', Object.assign(f, { taskId: c.taskId, leadId: c.leadId })), `Rescheduled to ${fmtDate(f.date)}${f.time ? ' ' + f.time : ''}.`); m.close(); afterChange(); } catch (e) { /* toast */ }
  };
}
function openBooking(c, b) {
  b = b || {};
  const m = modal({ title: (b.id ? 'Edit booking · ' : 'Convert to booking · ') + esc(c.clientName || b.clientName),
    body: `<div class="form-grid">
      <label class="field"><span>Client</span><input value="${esc(c.clientName || b.clientName)}" readonly></label>
      <label class="field"><span>Service</span><select name="serviceId">${serviceOptions(b.serviceId || c.serviceId || (S.boot.services.find(s => s.name === c.service) || {}).id, { all: false })}</select></label>
      <label class="field"><span>Booking date *</span><input type="date" name="bookingDate" value="${b.bookingDate || today()}"></label>
      <label class="field"><span>Booking amount (AED) *</span><input type="number" name="amount" min="0" step="0.01" value="${b.amount ?? ''}" placeholder="0.00"></label>
      <label class="field"><span>Booking status</span><select name="status">${statusOptions(S.boot.bookingStatuses, b.status || 'New Booking')}</select></label>
      <label class="field"><span>Payment status</span><select name="paymentStatus">${statusOptions(S.boot.paymentStatuses, b.paymentStatus || 'Unpaid')}</select></label>
      <label class="field full"><span>Booking reference</span><input name="reference" value="${esc(b.reference || '')}" placeholder="Auto-generated if empty"></label>
      <label class="field full"><span>Additional notes</span><textarea name="notes">${esc(b.notes || '')}</textarea></label></div>
      ${b.history && b.history.length ? `<h4 class="mt">Change history</h4><ul class="timeline mt">${b.history.slice().reverse().map(h => `<li><div class="when">${fmtDT(h.at)} · ${esc(h.by)}</div><div class="det">${Object.entries(h.changes).map(([k, v]) => `${esc(k)}: <s>${esc(v.from)}</s> → <b>${esc(v.to)}</b>`).join('<br>')}</div></li>`).join('')}</ul>` : ''}`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn btn-brand" id="bkSave">${icon('aed')} Save booking</button>` });
  m.$('#bkSave').onclick = async () => {
    const f = formData(m.el);
    if (f.amount === '') return toast('Enter the booking amount in AED.', 'error');
    try { await run(() => api('saveBooking', Object.assign(f, { id: b.id, leadId: c.leadId || b.leadId })), b.id ? 'Booking updated.' : 'Booking created — lead marked Converted.'); m.close(); afterChange(); } catch (e) { /* toast */ }
  };
}
async function openReassign(leadIds, onDone) {
  await agentList();
  const m = modal({ title: `Reassign ${leadIds.length} lead(s)`,
    body: `<label class="field"><span>Move to agent</span><select name="agentId">${agentOptions('', { all: 'Select agent…', activeOnly: true })}</select></label>
      <label class="field"><span>Reason</span><input name="reason" placeholder="e.g. Agent on leave"></label>
      <p class="muted small">The client journeys and all open follow-up tasks move with the leads. Assignment history is kept.</p>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn btn-brand" id="raGo">${icon('swap')} Reassign</button>` });
  m.$('#raGo').onclick = async () => {
    const f = formData(m.el); if (!f.agentId) return toast('Choose an agent.', 'error');
    try { await run(() => api('assignLeads', { leadIds, agentId: f.agentId, reason: f.reason }), r => `${r.moved} lead(s) reassigned${r.outsideServices ? ` (${r.outsideServices} outside the agent's services)` : ''}.`); m.close(); (onDone || afterChange)(); } catch (e) { /* toast */ }
  };
}
function openCloseJourney(c) {
  const needsApproval = isAgent() && S.boot.closureRequiresApproval;
  const reasons = ['Client does not want further calls', 'Client requested no further contact', 'Client is no longer interested', 'Client unreachable after the approved contact process', 'Other'];
  const m = modal({ title: 'Close journey · ' + esc(c.clientName),
    body: `${needsApproval ? '<p class="muted small">Your request will be sent to an admin for approval. Follow-ups continue until it is approved.</p>' : '<p class="muted small">Closing stops all future follow-ups and notifications for this lead.</p>'}
      <label class="field"><span>Reason *</span><select name="code">${reasons.map(r => `<option>${r}</option>`).join('')}</select></label>
      <label class="field"><span>Details</span><textarea name="details" placeholder="Add any details"></textarea></label>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn btn-danger" id="cjGo">${needsApproval ? 'Request closure' : 'Close journey'}</button>` });
  m.$('#cjGo').onclick = async () => {
    const f = formData(m.el), reason = f.code + (f.details ? ' — ' + f.details : '');
    if (f.code === 'Other' && !f.details) return toast('Please describe the reason.', 'error');
    try { await run(() => api('closeJourney', { leadId: c.leadId, reason }), r => r.requested ? 'Closure request sent for approval.' : 'Journey closed.'); m.close(); afterChange(); } catch (e) { /* toast */ }
  };
}
async function openEditLead(l) {
  const m = modal({ title: 'Edit lead · ' + esc(l.id), size: 'wide',
    body: `<div class="form-grid">
      <label class="field"><span>Client name</span><input name="name" value="${esc(l.clientName)}"></label>
      <label class="field"><span>Phone</span><input name="phone" value="${esc(l.phone)}"></label>
      <label class="field"><span>Email</span><input name="email" value="${esc(l.email)}"></label>
      <label class="field"><span>Service</span><select name="serviceId">${serviceOptions(l.serviceId, { all: false })}</select></label>
      <label class="field"><span>Lead source</span><input name="source" value="${esc(l.source)}"></label>
      <label class="field"><span>Lead entry date</span><input type="date" name="entryDate" value="${esc(l.entryDate)}"></label>
      <label class="field"><span>Status</span><select name="status">${statusOptions(S.boot.leadStatuses.filter(s => !['Closed', 'Overdue'].includes(s) || s === l.status), l.status)}</select></label>
      <label class="field"><span>Interest</span><select name="interest">${statusOptions(['', 'High', 'Medium', 'Low', 'None'], l.interest)}</select></label>
      <label class="field full"><span>Additional information</span><textarea name="additionalInfo">${esc(l.additionalInfo || '')}</textarea></label></div>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn btn-brand" id="elSave">Save changes</button>` });
  m.$('#elSave').onclick = async () => {
    const f = formData(m.el);
    const p = { id: l.id, serviceId: f.serviceId, source: f.source, entryDate: f.entryDate, additionalInfo: f.additionalInfo, interest: f.interest, client: { name: f.name, phone: f.phone, email: f.email } };
    if (f.status !== l.status) p.status = f.status;
    try { await run(() => api('updateLead', p), 'Lead updated.'); m.close(); afterChange(); } catch (e) { /* toast */ }
  };
}
function leadActionButtons(r, { complete = false } = {}) {
  const closed = (r.leadStatus || r.status) === 'Closed';
  return `<button class="act call" data-act="call" title="Call">${icon('phone', 14)} Call</button>
    <button class="act wa" data-act="wa" title="WhatsApp">${icon('wa', 14)} WhatsApp</button>
    ${r.email ? `<button class="act mail" data-act="email" title="Email">${icon('mail', 14)} Email</button>` : ''}
    <button class="act" data-act="note">${icon('note', 14)} Add note</button>
    ${closed ? '' : `<button class="act" data-act="resched">${icon('clock', 14)} Reschedule</button>`}
    ${complete ? `<button class="act" data-act="complete" style="color:var(--green)">${icon('check', 14)} Mark completed</button>` : ''}
    <button class="act book" data-act="book">${icon('aed', 14)} Convert to booking</button>
    <button class="act" data-act="profile">${icon('eye', 14)} Profile</button>`;
}
function handleLeadAction(act, row) {
  const c = ctxOf(row);
  ({ call: () => callClient(c), wa: () => openWhatsApp(c), email: () => openEmail(c), note: () => openNote(c), complete: () => openNote(c, { complete: true }),
    resched: () => openReschedule(c), book: () => openBooking(c), profile: () => openProfile({ clientId: c.clientId, leadId: c.leadId }),
    close: () => openCloseJourney(c), edit: () => openEditLead(row), reassign: () => openReassign([c.leadId]),
    journey: () => openProfile({ clientId: c.clientId, tab: 'journey' }), notes: () => openProfile({ clientId: c.clientId, tab: 'notes' }),
    booking: () => openProfile({ clientId: c.clientId, tab: 'bookings' }) }[act] || (() => {}))();
}

/* ------------------------------- Client profile --------------------------- */
async function openProfile({ clientId, leadId, tab = 'overview' }) {
  let p; try { p = await api('clientProfile', { clientId, leadId }); } catch (e) { return toast(e.message, 'error'); }
  const c = p.client, main = p.leads[0] || {};
  const tabs = [['overview', 'Overview'], ['followups', `Follow-ups (${p.tasks.filter(t => t.status === 'Pending').length})`], ['notes', `Call notes (${p.notes.length})`],
    ['bookings', `Bookings (${p.bookings.length})`], ['journey', 'Journey'], ['timeline', 'Activity timeline'], ['emails', `Emails (${p.emails.length})`]];
  const m = modal({ title: 'Client profile', size: 'xwide', autofocus: false, onClose: () => { if (S.profileOpen === reopen) S.profileOpen = null; }, body: `
    <div class="profile-head"><span class="avatar">${initials(c.name)}</span><div><h3 style="font-size:18px">${esc(c.name)}</h3>
      <div class="muted small">${esc(c.id)} · ${esc(c.phone)}${c.email ? ' · ' + esc(c.email) : ''}</div></div><span class="spacer"></span>
      <div class="menu-actions" id="pfActs">${leadActionButtons(Object.assign({}, main, { leadId: main.id, email: c.email })).replace(/<button class="act" data-act="profile">[\s\S]*?<\/button>/, '')}</div></div>
    <div class="kv"><div><small>Lead status</small>${badge(main.status)}</div><div><small>Assigned agent</small>${esc(main.agentName || '—')}</div>
      <div><small>Assigned admin</small>${esc(main.adminName || '—')}</div><div><small>Last contact</small>${fmtDate(main.lastContact)}</div>
      <div><small>Next follow-up</small>${fmtDate(main.nextFollowUp)}${main.overdue ? ' ' + badge('Overdue') : ''}</div><div><small>Total bookings</small><b>${aed(p.bookingTotal)}</b></div>
      <div><small>Marketing consent</small>${c.marketingConsent === 'Yes' ? 'Yes' : 'No'}${c.unsubscribed === 'Yes' ? ' · unsubscribed' : ''}</div><div><small>Created / updated</small>${fmtDate(c.createdAt)} / ${fmtDate(c.updatedAt)}</div></div>
    <div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${k === tab ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div><div id="pfBody"></div>` });
  const T = {
    overview: () => `<table class="tbl"><thead><tr><th>Lead</th><th>Service</th><th>Source</th><th>Entry date</th><th>Agent</th><th>Status</th><th>Journey end</th><th class="num">Bookings</th><th></th></tr></thead><tbody>
      ${p.leads.map((l, i) => `<tr data-i="${i}"><td>${esc(l.id)}</td><td>${esc(l.service)}</td><td>${esc(l.source)}</td><td>${fmtDate(l.entryDate)}</td><td>${esc(l.agentName)}</td><td>${badge(l.status)}</td><td>${fmtDate(l.journeyEnd)}</td><td class="num">${aed(l.bookingTotal)}</td>
      <td class="nowrap">${isAdmin() ? `<button class="btn btn-sm" data-l="edit">Edit</button> <button class="btn btn-sm" data-l="reassign">Reassign</button> ` : ''}${l.status !== 'Closed' ? '<button class="btn btn-sm btn-danger" data-l="close">Close</button>' : ''}</td></tr>
      ${l.additionalInfo ? `<tr><td colspan="9" class="muted small">ℹ ${esc(l.additionalInfo)}</td></tr>` : ''}`).join('')}</tbody></table>
      ${isAdmin() ? `<div class="mt"><label class="field"><span>Client notes</span><textarea id="pfNotes">${esc(c.notes || '')}</textarea></label>
        <div class="gap"><label class="check"><input type="checkbox" id="pfConsent" ${c.marketingConsent === 'Yes' ? 'checked' : ''}> Marketing consent</label><span class="spacer"></span><button class="btn btn-sm" id="pfSaveNotes">Save client notes</button></div></div>` : (c.notes ? `<p class="mt"><b>Client notes:</b> ${esc(c.notes)}</p>` : '')}`,
    followups: () => p.tasks.length ? `<table class="tbl"><thead><tr><th>Due</th><th>Task</th><th>Service</th><th>Agent</th><th>Status</th><th>Reschedule reason</th><th></th></tr></thead><tbody>${p.tasks.map(t => `<tr>
      <td class="nowrap">${fmtDate(t.dueDate)}${t.dueTime ? ' ' + t.dueTime : ''}</td><td>${esc(t.label)}</td><td>${esc(t.service)}</td><td>${esc(t.agentName)}</td>
      <td>${t.status === 'Pending' && t.dueDate < today() ? badge('Overdue') : badge(t.status)}${+t.rescheduleCount ? ' ' + badge('Rescheduled') : ''}</td><td class="small">${esc(t.rescheduleReason)}</td>
      <td>${t.status === 'Pending' ? `<button class="btn btn-sm" data-t="${t.id}" data-lead="${t.leadId}">Complete</button>` : (t.completedAt ? `<span class="muted small">${fmtDT(t.completedAt)}</span>` : '')}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No follow-ups.</div>',
    notes: () => p.notes.length ? `<ul class="timeline">${p.notes.map(n => `<li><div class="when">${fmtDate(n.callDate)} ${esc(n.callTime)} · ${esc(n.agentName)}</div>
      <div class="what">${badge(n.outcome)} ${n.interest ? `<span class="tag">Interest: ${esc(n.interest)}</span>` : ''}</div><div class="det">${esc(n.notes)}${n.nextFollowUp ? `<br>Next follow-up: ${fmtDate(n.nextFollowUp)}` : ''}${n.rescheduleReason ? `<br>Reason: ${esc(n.rescheduleReason)}` : ''}</div></li>`).join('')}</ul>` : '<div class="empty">No call notes yet.</div>',
    bookings: () => p.bookings.length ? `<table class="tbl"><thead><tr><th>Reference</th><th>Date</th><th>Service</th><th>Agent</th><th class="num">Amount</th><th>Status</th><th>Payment</th><th></th></tr></thead><tbody>${p.bookings.map((b, i) => `<tr>
      <td>${esc(b.reference)}</td><td>${fmtDate(b.bookingDate)}</td><td>${esc(b.service)}</td><td>${esc(b.agentName)}</td><td class="num">${aed(b.amount)}</td><td>${badge(b.status)}</td><td>${badge(b.paymentStatus)}</td>
      <td><button class="btn btn-sm" data-b="${i}">Edit</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">No bookings yet.</div>',
    journey: () => p.journeys.map(j => `<div class="card card-pad mb"><div class="gap"><b>${esc(j.id)}</b>${badge(j.status)}<span class="muted small">Period ${j.period} · ${fmtDate(j.startDate)} → ${fmtDate(j.endDate)} · ${esc(j.agentName)}</span></div>
      ${j.closeReason ? `<p class="small">Closed: ${esc(j.closeReason)}</p>` : ''}<ul class="timeline mt">${j.history.slice().reverse().map(h => `<li><div class="when">${fmtDT(h.at)}</div><div class="what">${esc(h.event)}</div>
      <div class="det">${h.start ? `${fmtDate(h.start)} → ${fmtDate(h.end)}` : ''}${h.reason ? esc(h.reason) : ''}</div></li>`).join('')}</ul></div>`).join('') || '<div class="empty">No journey.</div>',
    timeline: () => `<ul class="timeline">${p.timeline.map(a => `<li><div class="when">${fmtDT(a.at)} · ${esc(a.by)}</div><div class="what">${esc(a.action)}</div><div class="det">${esc(prettyDetails(a.details))}</div></li>`).join('')}</ul>`,
    emails: () => p.emails.length ? `<table class="tbl"><thead><tr><th>Sent</th><th>Subject</th><th>By</th><th>Type</th><th>Status</th></tr></thead><tbody>${p.emails.map(e => `<tr><td>${fmtDT(e.sentAt)}</td><td>${esc(e.subject)}</td><td>${esc(e.by)}</td><td>${e.campaignId ? 'Campaign' : 'Direct'}</td><td>${badge(e.status)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No emails.</div>'
  };
  const show = (k) => { m.$$('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === k)); m.$('#pfBody').innerHTML = T[k](); };
  show(tab);
  function reopen() { const cur = m.$('.tab.on')?.dataset.tab; m.close(); openProfile({ clientId: c.id, tab: cur }); }
  S.profileOpen = reopen;
  m.el.addEventListener('click', async (e) => {
    const tb = e.target.closest('[data-tab]'); if (tb) return show(tb.dataset.tab);
    const a = e.target.closest('#pfActs [data-act]');
    if (a) return handleLeadAction(a.dataset.act, Object.assign({}, main, { leadId: main.id, email: c.email, clientId: c.id }));
    const l = e.target.closest('[data-l]');
    if (l) return handleLeadAction(l.dataset.l, p.leads[+l.closest('tr').dataset.i]);
    const t = e.target.closest('[data-t]');
    if (t) return openNote({ leadId: t.dataset.lead, taskId: t.dataset.t, clientName: c.name }, { complete: true });
    const b = e.target.closest('[data-b]');
    if (b) { const bk = p.bookings[+b.dataset.b]; return openBooking({ clientName: c.name, leadId: bk.leadId }, bk); }
    if (e.target.id === 'pfSaveNotes') { await run(() => api('updateClient', { id: c.id, notes: m.$('#pfNotes').value, marketingConsent: m.$('#pfConsent').checked ? 'Yes' : 'No' }), 'Client notes saved.'); }
  });
}
function prettyDetails(d) {
  if (!d || d[0] !== '{') return d || '';
  try { const o = JSON.parse(d); return Object.entries(o).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · '); } catch (e) { return d; }
}

/* ============================================================================
 *  VIEWS
 * ==========================================================================*/

/* ------------------------------- Dashboard -------------------------------- */
function rangeFor(key) {
  const t = today(), first = t.slice(0, 8) + '01';
  return { today: [t, t], yesterday: [addDays(t, -1), addDays(t, -1)], d7: [addDays(t, -6), t], d30: [addDays(t, -29), t], month: [first, t],
    lastMonth: [addDays(first, -1).slice(0, 8) + '01', addDays(first, -1)] }[key] || [addDays(t, -29), t];
}
const RANGE_CHIPS = [['today', 'Today'], ['yesterday', 'Yesterday'], ['d7', 'Last 7 days'], ['d30', 'Last 30 days'], ['month', 'This month'], ['lastMonth', 'Last month'], ['custom', 'Custom']];

VIEWS.dashboard = async (host) => {
  if (isAgent()) return agentDashboard(host);
  await agentList();
  const admins = isSuper() ? (await api('listUsers', { role: 'admin' }, { quiet: true })) : [];
  const f = { key: 'd30', from: rangeFor('d30')[0], to: rangeFor('d30')[1], serviceId: '', agentId: '', adminId: '' };
  host.innerHTML = `<div class="toolbar"><div class="chips" id="rng">${RANGE_CHIPS.map(([k, l]) => `<button class="chip ${k === f.key ? 'on' : ''}" data-k="${k}">${l}</button>`).join('')}</div>
    <span id="custom" class="gap hidden"><input type="date" id="dFrom" value="${f.from}"><input type="date" id="dTo" value="${f.to}"></span>
    <select id="dSvc">${serviceOptions('')}</select><select id="dAgent">${agentOptions('')}</select>
    ${isSuper() ? `<select id="dAdmin"><option value="">All admins</option>${admins.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select>` : ''}</div><div id="dash"></div>`;
  async function load() {
    const d = await api('dashboard', { from: f.from, to: f.to, serviceId: f.serviceId, agentId: f.agentId, adminId: f.adminId });
    const k = d.kpis; destroyCharts();
    $('#pageSub').textContent = `${fmtDate(f.from)} – ${fmtDate(f.to)} · backlog figures are live`;
    $('#dash').innerHTML = `<div class="kpis">
      ${kpi('Total leads', nf(k.totalLeads), '', '#/leads')}${kpi('New leads today', nf(k.newToday))}${kpi('New leads (period)', nf(k.newLeads))}
      ${kpi('Assigned leads', nf(k.assignedLeads), '', '#/leads')}${kpi('Unassigned leads', nf(k.unassigned), k.unassigned ? 'warn' : '', '#/leads?agentId=unassigned')}
      ${kpi('Pending follow-ups', nf(k.pending), '', '#/followups?scope=today')}${kpi('Completed calls', nf(k.callsCompleted))}
      ${kpi('Overdue leads', nf(k.overdue), k.overdue ? 'warn' : 'good', '#/followups?scope=overdue')}${kpi('Converted leads', nf(k.convertedLeads), 'good')}
      ${kpi('Total bookings', nf(k.bookings), '', '#/bookings')}${kpi('Total revenue (AED)', aed(k.revenue), 'good', '#/bookings')}
      ${kpi('Follow-up completion', k.followUpCompletionRate + '%')}${kpi('Conversion rate', k.conversionRate + '%')}</div>
      <div class="card mb"><div class="card-head"><h3>Agent performance</h3><span class="spacer"></span><button class="btn btn-sm" id="expAg">Export CSV</button></div>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>#</th><th>Agent</th><th class="num">Assigned</th><th class="num">Called</th><th class="num">Pending</th><th class="num">Overdue</th><th class="num">Converted</th><th class="num">Completion</th><th class="num">Revenue</th></tr></thead>
      <tbody>${d.perAgent.map(a => `<tr><td>${a.rank}</td><td class="cell-main">${esc(a.name)}</td><td class="num">${nf(a.assigned)}</td><td class="num">${nf(a.called)}</td><td class="num">${nf(a.pending)}</td>
        <td class="num" style="${a.overdue ? 'color:var(--red);font-weight:700' : ''}">${nf(a.overdue)}</td><td class="num">${nf(a.converted)}</td><td class="num">${a.completionRate}%</td><td class="num"><b>${aed(a.revenue)}</b></td></tr>`).join('') || '<tr><td colspan="9"><div class="empty">No agents yet. Create agents in the Agents section.</div></td></tr>'}</tbody></table></div></div>
      <div class="charts">${['Leads by service', 'Leads by agent', 'Daily lead assignments', 'Follow-up completion trend', 'Monthly conversion rate', 'Revenue by agent', 'Revenue by service', 'Pending vs completed follow-ups']
        .map((t, i) => `<div class="card chart-card"><h4>${t}</h4><div class="chart-box"><canvas id="c${i}"></canvas></div></div>`).join('')}</div>`;
    $('#expAg').onclick = () => downloadCSV('agent_performance', [{ label: 'Rank', key: 'rank' }, { label: 'Agent', key: 'name' }, { label: 'Assigned', key: 'assigned' }, { label: 'Called', key: 'called' }, { label: 'Pending', key: 'pending' }, { label: 'Overdue', key: 'overdue' }, { label: 'Converted', key: 'converted' }, { label: 'Completion %', key: 'completionRate' }, { label: 'Revenue AED', key: 'revenue' }], d.perAgent);
    const C = d.charts, L = (a) => a.map(x => x.label), V = (a, k = 'value') => a.map(x => x[k]);
    whenChartsReady(() => {
      chart($('#c0'), 'doughnut', L(C.leadsByService), [{ data: V(C.leadsByService) }]);
      chart($('#c1'), 'bar', L(C.leadsByAgent), [{ label: 'New leads', data: V(C.leadsByAgent) }]);
      chart($('#c2'), 'bar', L(C.dailyAssignments), [{ label: 'Assignments', data: V(C.dailyAssignments), backgroundColor: '#F7931E' }]);
      chart($('#c3'), 'line', L(C.followUpTrend), [{ label: 'Due', data: V(C.followUpTrend, 'due'), borderColor: '#FFB800', backgroundColor: '#FFB80022' }, { label: 'Completed', data: V(C.followUpTrend, 'completed'), borderColor: '#E50D07', backgroundColor: '#E50D0722' }]);
      chart($('#c4'), 'line', L(C.monthlyConversion), [{ label: 'Conversion %', data: V(C.monthlyConversion, 'rate') }], { pct: true });
      chart($('#c5'), 'bar', L(C.revenueByAgent), [{ label: 'Revenue', data: V(C.revenueByAgent), backgroundColor: '#AA2502' }], { money: true, options: { indexAxis: 'y' } });
      chart($('#c6'), 'bar', L(C.revenueByService), [{ label: 'Revenue', data: V(C.revenueByService) }], { money: true });
      chart($('#c7'), 'doughnut', L(C.pendingVsCompleted), [{ data: V(C.pendingVsCompleted), backgroundColor: ['#F7931E', '#E50D07'] }]);
    });
  }
  host.addEventListener('click', (e) => {
    const k = e.target.closest('#rng [data-k]'); if (k) {
      f.key = k.dataset.k; $$('#rng .chip').forEach(c => c.classList.toggle('on', c === k)); $('#custom').classList.toggle('hidden', f.key !== 'custom');
      if (f.key !== 'custom') { [f.from, f.to] = rangeFor(f.key); load(); }
    }
    const g = e.target.closest('[data-go]'); if (g) go(g.dataset.go);
  });
  host.addEventListener('change', (e) => {
    if (e.target.id === 'dFrom' || e.target.id === 'dTo') { f.from = $('#dFrom').value; f.to = $('#dTo').value; if (f.from && f.to) load(); }
    if (e.target.id === 'dSvc') { f.serviceId = e.target.value; load(); }
    if (e.target.id === 'dAgent') { f.agentId = e.target.value; load(); }
    if (e.target.id === 'dAdmin') { f.adminId = e.target.value; load(); }
  });
  S.reload = load; await load();
};
function kpi(label, value, cls = '', goHash = '', hint = '') {
  return `<div class="kpi ${cls}" ${goHash ? `data-go="${goHash}"` : ''}><div class="label">${label}</div><div class="value">${value}</div>${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
}

async function agentDashboard(host) {
  const d = await api('agentDashboard', {}), k = d.kpis;
  host.innerHTML = `<div class="kpis">${kpi('Total assigned leads', nf(k.totalAssigned), '', '#/leads')}${kpi("Today's follow-ups", nf(k.todaysFollowUps), '', '#/today')}
    ${kpi('Pending calls', nf(k.pending), '', '#/today')}${kpi('Completed calls (month)', nf(k.completedMonth), 'good', '', `${k.completedToday} today`)}
    ${kpi('Overdue calls', nf(k.overdue), k.overdue ? 'warn' : 'good', '#/followups?scope=overdue')}${kpi('Rescheduled calls', nf(k.rescheduled), '', '#/followups?scope=rescheduled')}
    ${kpi('Converted clients', nf(k.converted), 'good')}${kpi('Uncontacted clients', nf(k.uncontacted), k.uncontacted ? 'warn' : '', '#/leads?status=New')}
    ${kpi('Total bookings', nf(k.totalBookings), '', '#/bookings')}${kpi('Total booking revenue', aed(k.totalRevenue), 'good', '#/bookings', `${aed(k.monthRevenue)} this month`)}</div>
    <div class="card mb"><div class="card-head"><h3>Today's follow-up list</h3><span class="spacer"></span><a class="btn btn-sm" href="#/today">Open full list</a></div><div class="card-pad" id="tl"></div></div>
    <div class="charts"><div class="card chart-card"><h4>My follow-ups — last 14 days</h4><div class="chart-box"><canvas id="a1"></canvas></div></div>
      <div class="card chart-card"><h4>My conversions by month</h4><div class="chart-box"><canvas id="a2"></canvas></div></div></div>`;
  host.addEventListener('click', (e) => { const g = e.target.closest('[data-go]'); if (g) go(g.dataset.go); });
  await renderTaskCards($('#tl'), { scope: 'today', pageSize: 10 });
  const C = d.charts;
  whenChartsReady(() => {
    chart($('#a1'), 'bar', C.followUpTrend.map(x => x.label), [{ label: 'Due', data: C.followUpTrend.map(x => x.due), backgroundColor: '#FFB800' }, { label: 'Completed', data: C.followUpTrend.map(x => x.completed), backgroundColor: '#E50D07' }]);
    chart($('#a2'), 'bar', C.monthlyConversion.map(x => x.label), [{ label: 'Leads', data: C.monthlyConversion.map(x => x.leads), backgroundColor: '#FFD27A' }, { label: 'Converted', data: C.monthlyConversion.map(x => x.converted), backgroundColor: '#AA2502' }]);
  });
  S.reload = () => route();
}

/* ------------------------------- Follow-up cards -------------------------- */
async function renderTaskCards(el, params) {
  const r = await api('listTasks', params);
  if (!r.rows.length) { el.innerHTML = '<div class="empty"><b>All caught up 🎉</b>No follow-ups are due right now.</div>'; return r; }
  el.innerHTML = `<div class="task-list">${r.rows.map((t, i) => `<div class="task ${t.overdue ? 'overdue' : ''} ${t.rescheduled ? 'resched' : ''}" data-i="${i}">
    <div><div class="task-name">${esc(t.clientName)} ${badge(t.leadStatus)} ${t.overdue ? badge('Overdue') : ''} ${t.rescheduled ? badge('Rescheduled') : ''}</div>
      <div class="task-meta"><span>${icon('phone', 12)} ${esc(t.phone)}</span>${t.email ? `<span>${icon('mail', 12)} ${esc(t.email)}</span>` : ''}<span>${icon('tag', 12)} ${esc(t.service)}</span>
      <span>${icon('calendar', 12)} ${esc(t.label)} · due ${fmtDate(t.dueDate)}${t.dueTime ? ' at <b>' + t.dueTime + '</b>' : ''}</span>${isAdmin() ? `<span>${icon('agent', 12)} ${esc(t.agentName)}</span>` : ''}
      <span>Last contact: ${fmtDate(t.lastContact)}</span></div>
      ${t.rescheduleReason ? `<div class="task-note">🕑 ${esc(t.rescheduleReason)}</div>` : ''}${t.lastNote ? `<div class="task-note">📝 Last note: ${esc(t.lastNote)}</div>` : ''}</div>
    <div class="right">${t.interest ? `<span class="tag">Interest: ${esc(t.interest)}</span>` : ''}</div>
    <div class="task-actions">${leadActionButtons(t, { complete: true })}</div></div>`).join('')}</div>
    ${r.total > r.rows.length ? `<p class="muted small mt">Showing ${r.rows.length} of ${r.total}.</p>` : ''}`;
  el.onclick = (e) => { const a = e.target.closest('[data-act]'); if (!a) return; const t = r.rows[+a.closest('.task').dataset.i]; handleLeadAction(a.dataset.act, Object.assign({}, t, { taskId: t.id })); };
  return r;
}

VIEWS.today = async (host) => {
  if (isAdmin()) await agentList();
  host.innerHTML = `<div class="toolbar"><input type="search" id="tq" placeholder="Search client, phone or email…">${isAdmin() ? `<select id="ta">${agentOptions('')}</select>` : ''}
    <span class="spacer"></span><span class="muted small">Overdue items are shown first. Rescheduled items move to their new date automatically.</span></div><div id="tlist"></div>`;
  const p = { scope: 'today', pageSize: 200, q: '', agentId: '' };
  const load = async () => { const r = await renderTaskCards($('#tlist'), p); $('#pageSub').textContent = `${r.total} follow-up(s) due · ${r.rows.filter(x => x.overdue).length} overdue`; };
  $('#tq').oninput = debounce(() => { p.q = $('#tq').value; load(); });
  if ($('#ta')) $('#ta').onchange = () => { p.agentId = $('#ta').value; load(); };
  S.reload = load; await load();
};

VIEWS.followups = async (host, q) => {
  if (isAdmin()) await agentList();
  const scopes = [['pending', 'All pending'], ['today', 'Due now'], ['overdue', 'Overdue'], ['upcoming', 'Upcoming'], ['rescheduled', 'Rescheduled'], ['completed', 'Completed'], ['all', 'All']];
  const scope = q.scope || 'pending';
  host.innerHTML = `<div class="tabs">${scopes.map(([k, l]) => `<button class="tab ${k === scope ? 'on' : ''}" data-s="${k}">${l}</button>`).join('')}</div>
    <div class="toolbar"><input type="search" id="fq" placeholder="Search client…"><span class="lbl">Due from</span><input type="date" id="ff"><span class="lbl">to</span><input type="date" id="ft">
    ${isAdmin() ? `<select id="fa">${agentOptions('')}</select>` : ''}<span class="spacer"></span><button class="btn" id="fx">Export CSV</button></div><div class="card" id="ftbl"></div>`;
  const dt = dataTable($('#ftbl'), { params: { scope, sort: 'dueDate' }, load: (p) => api('listTasks', p),
    columns: [{ key: 'dueDate', label: 'Due', render: r => `<span class="nowrap">${fmtDate(r.dueDate)}${r.dueTime ? ' · ' + r.dueTime : ''}</span>` },
      { key: 'clientName', label: 'Client', render: r => `<div class="cell-main">${esc(r.clientName)}</div><div class="cell-sub">${esc(r.phone)}</div>` },
      { key: 'service', label: 'Service' }, { key: 'label', label: 'Task' }, ...(isAdmin() ? [{ key: 'agentName', label: 'Agent' }] : []),
      { key: 'status', label: 'Status', render: r => (r.overdue ? badge('Overdue') : badge(r.status)) + (r.rescheduled ? ' ' + badge('Rescheduled') : '') },
      { key: 'lastContact', label: 'Last contact', render: r => fmtDate(r.lastContact) }, { key: 'nextFollowUp', label: 'Next contact', render: r => fmtDate(r.nextFollowUp) },
      { key: 'a', label: '', render: r => r.status === 'Pending' ? `<span class="menu-actions"><button class="act" data-act="complete">${icon('check', 13)}</button><button class="act" data-act="resched">${icon('clock', 13)}</button><button class="act call" data-act="call">${icon('phone', 13)}</button><button class="act" data-act="profile">${icon('eye', 13)}</button></span>` : `<button class="act" data-act="profile">${icon('eye', 13)}</button>` }],
    onAction: (act, r) => handleLeadAction(act, Object.assign({}, r, { taskId: r.id })) });
  host.addEventListener('click', (e) => { const t = e.target.closest('[data-s]'); if (t) { $$('.tab', host).forEach(x => x.classList.toggle('on', x === t)); dt.set({ scope: t.dataset.s }); } });
  $('#fq').oninput = debounce(() => dt.set({ q: $('#fq').value }));
  $('#ff').onchange = $('#ft').onchange = () => dt.set({ from: $('#ff').value, to: $('#ft').value });
  if ($('#fa')) $('#fa').onchange = () => dt.set({ agentId: $('#fa').value });
  $('#fx').onclick = async () => { const r = await api('listTasks', Object.assign({}, dt.st.params, { pageSize: 'all', page: 1 }));
    downloadCSV('followups', [{ label: 'Due date', key: 'dueDate' }, { label: 'Time', key: 'dueTime' }, { label: 'Client', key: 'clientName' }, { label: 'Phone', key: 'phone' }, { label: 'Email', key: 'email' }, { label: 'Service', key: 'service' }, { label: 'Task', key: 'label' }, { label: 'Agent', key: 'agentName' }, { label: 'Status', value: x => x.overdue ? 'Overdue' : x.status }, { label: 'Last contact', key: 'lastContact' }, { label: 'Next contact', key: 'nextFollowUp' }], r.rows); };
  S.reload = dt.reload; await dt.reload();
};

/* ------------------------------- Leads ------------------------------------ */
VIEWS.leads = async (host, q) => {
  if (isAdmin()) await agentList();
  host.innerHTML = `<div class="toolbar"><input type="search" id="lq" placeholder="Search name, phone, email, ID…" value="${esc(q.q || '')}">
    <select id="ls">${serviceOptions(q.serviceId || '')}</select>${isAdmin() ? `<select id="la">${agentOptions(q.agentId || '', { unassigned: true })}</select>` : ''}
    <select id="lst">${statusOptions(S.boot.leadStatuses, q.status || '', 'All statuses')}</select>
    <select id="lf"><option value="">Any follow-up</option><option value="today">Due today</option><option value="overdue">Overdue</option><option value="upcoming">Upcoming</option><option value="none">No follow-up</option></select>
    <select id="lj"><option value="">All journeys</option><option>Active</option><option>Closed</option></select>
    <span class="lbl">Entry</span><input type="date" id="lfrom"><input type="date" id="lto"></div>
    <div class="toolbar"><span class="spacer"></span>${isAdmin() ? `<button class="btn" id="lAdd">+ Add lead</button><button class="btn" id="lAuto">Auto-assign unassigned</button><button class="btn" id="lAll">${icon('swap')} Transfer all leads</button>` : ''}
    <button class="btn" id="lExp">Export CSV</button></div><div id="bulk"></div><div class="card" id="ltbl"></div>`;
  const cols = [
    { key: 'clientId', label: 'Client ID', sort: true, render: r => `<span class="small">${esc(r.clientId)}</span><div class="cell-sub">${esc(r.id)}</div>` },
    { key: 'clientName', label: 'Client name', sort: true, render: r => `<a href="#" data-act="profile">${esc(r.clientName)}</a>` },
    { key: 'phone', label: 'Phone', render: r => `<span class="nowrap">${esc(r.phone)}</span>` }, { key: 'email', label: 'Email', render: r => `<span class="small">${esc(r.email)}</span>` },
    { key: 'service', label: 'Service', sort: true }, { key: 'entryDate', label: 'Entry date', sort: true, render: r => `<span class="nowrap">${fmtDate(r.entryDate)}</span>` },
    { key: 'agentName', label: 'Assigned agent', sort: true, render: r => r.agentId ? esc(r.agentName) : badge('Unassigned') },
    { key: 'status', label: 'Status', sort: true, render: r => badge(r.status) + (r.overdue ? ' ' + badge('Overdue') : '') },
    { key: 'lastContact', label: 'Last contact', sort: true, render: r => fmtDate(r.lastContact) },
    { key: 'nextFollowUp', label: 'Next follow-up', sort: true, render: r => `<span style="${r.overdue ? 'color:var(--red);font-weight:700' : ''}">${fmtDate(r.nextFollowUp)}</span>` },
    { key: 'journeyEnd', label: 'Journey end', sort: true, render: r => fmtDate(r.journeyEnd) },
    { key: 'bookingTotal', label: 'Booking amount', sort: true, num: true, render: r => r.bookingTotal ? aed(r.bookingTotal) : '—' },
    { key: 'actions', label: 'Actions', render: r => `<span class="menu-actions">
      <button class="act btn-icon" data-act="profile" title="View profile">${icon('eye', 14)}</button>
      ${isAdmin() ? `<button class="act btn-icon" data-act="edit" title="Edit lead">${icon('edit', 14)}</button><button class="act btn-icon" data-act="reassign" title="Reassign lead">${icon('swap', 14)}</button>` : ''}
      <button class="act btn-icon" data-act="journey" title="View journey">${icon('route', 14)}</button><button class="act btn-icon" data-act="notes" title="View notes">${icon('note', 14)}</button>
      <button class="act btn-icon" data-act="booking" title="View booking">${icon('aed', 14)}</button>
      ${r.status !== 'Closed' ? `<button class="act btn-icon" data-act="close" title="Close journey" style="color:var(--rose)">${icon('x', 14)}</button>` : ''}</span>` }];
  const dt = dataTable($('#ltbl'), { selectable: isAdmin(), params: { q: q.q || '', serviceId: q.serviceId || '', agentId: q.agentId || '', status: q.status || '', sort: 'createdAt', dir: 'desc' },
    load: (p) => api('listLeads', p), columns: cols, onAction: (act, r) => handleLeadAction(act, r),
    onDraw: (st) => { $('#bulk').innerHTML = st.selected.size ? `<div class="bulkbar"><b>${st.selected.size} selected</b><span class="spacer"></span>
      <select id="bAgent">${agentOptions('', { all: 'Move to agent…', activeOnly: true })}</select><button class="btn btn-sm btn-brand" id="bGo">Reassign selected</button><button class="btn btn-sm" id="bClr">Clear</button></div>` : ''; } });
  host.addEventListener('click', async (e) => {
    if (e.target.id === 'bClr') dt.clearSel();
    if (e.target.id === 'bGo') { const a = $('#bAgent').value; if (!a) return toast('Choose an agent.', 'error');
      if (!(await confirmBox(`Reassign ${dt.st.selected.size} lead(s) to ${esc(S.agents.find(x => x.id === a).name)}?`))) return;
      await run(() => api('assignLeads', { leadIds: [...dt.st.selected], agentId: a, reason: 'Bulk reassignment' }), r => `${r.moved} lead(s) reassigned.`); dt.st.selected.clear(); dt.reload(); }
  });
  const sync = () => dt.set({ q: $('#lq').value, serviceId: $('#ls').value, agentId: $('#la') ? $('#la').value : '', status: $('#lst').value, followUp: $('#lf').value, journey: $('#lj').value, from: $('#lfrom').value, to: $('#lto').value });
  $('#lq').oninput = debounce(sync); ['#ls', '#la', '#lst', '#lf', '#lj', '#lfrom', '#lto'].forEach(s => { if ($(s)) $(s).onchange = sync; });
  $('#lExp').onclick = async () => { const r = await api('listLeads', Object.assign({}, dt.st.params, { pageSize: 'all', page: 1 }));
    downloadCSV('leads', [{ label: 'Client ID', key: 'clientId' }, { label: 'Lead ID', key: 'id' }, { label: 'Client name', key: 'clientName' }, { label: 'Phone', key: 'phone' }, { label: 'Email', key: 'email' }, { label: 'Service', key: 'service' }, { label: 'Lead source', key: 'source' }, { label: 'Entry date', key: 'entryDate' }, { label: 'Assigned agent', key: 'agentName' }, { label: 'Admin', key: 'adminName' }, { label: 'Status', key: 'status' }, { label: 'Overdue', value: x => x.overdue ? 'Yes' : 'No' }, { label: 'Last contact', key: 'lastContact' }, { label: 'Next follow-up', key: 'nextFollowUp' }, { label: 'Journey end', key: 'journeyEnd' }, { label: 'Booking amount AED', key: 'bookingTotal' }], r.rows); };
  if (isAdmin()) {
    $('#lAuto').onclick = async () => { const r = await run(() => api('autoAssignUnassigned', {}), r => r.assigned ? `${r.assigned} lead(s) assigned. ${r.unassigned ? r.unassigned + ' still have no eligible agent.' : ''}` : 'No unassigned leads could be assigned (no eligible active agents).'); dt.reload(); };
    $('#lAll').onclick = () => transferAllModal(dt.reload);
    $('#lAdd').onclick = () => addLeadModal(dt.reload);
  }
  S.reload = dt.reload; await dt.reload();
};
async function transferAllModal(onDone) {
  await agentList();
  const m = modal({ title: 'Transfer all leads from one agent to another',
    body: `<label class="field"><span>From agent</span><select name="fromAgentId">${agentOptions('', { all: 'Select…' })}</select></label>
      <label class="field"><span>To agent</span><select name="toAgentId">${agentOptions('', { all: 'Select…', activeOnly: true })}</select></label>
      <label class="check"><input type="checkbox" name="includeClosed"> Include closed journeys</label>
      <label class="field mt"><span>Reason</span><input name="reason" placeholder="e.g. Agent resigned"></label>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn btn-brand" id="taGo">Transfer</button>` });
  m.$('#taGo').onclick = async () => { const f = formData(m.el); try { await run(() => api('reassignAll', f), r => `${r.moved} lead(s) transferred.`); m.close(); S.agents = null; onDone(); } catch (e) { /* toast */ } };
}
function addLeadModal(onDone) {
  const m = modal({ title: 'Add a single lead', size: 'wide', body: `<div class="form-grid">
    <label class="field"><span>Client name *</span><input name="name"></label><label class="field"><span>Phone number *</span><input name="phone" placeholder="05XXXXXXXX or +9715XXXXXXXX"></label>
    <label class="field"><span>Email</span><input name="email" type="email"></label><label class="field"><span>Service *</span><select name="serviceId">${serviceOptions('', { all: false, activeOnly: true })}</select></label>
    <label class="field"><span>Lead entry date</span><input type="date" name="entryDate" value="${today()}"></label><label class="field"><span>Lead source</span><input name="source" placeholder="Website, Instagram, Referral…"></label>
    <label class="field full"><span>Additional information (no clinical details)</span><textarea name="info"></textarea></label>
    <label class="check full"><input type="checkbox" name="consent"> Client has consented to marketing emails</label></div>
    <p class="muted small">If the phone or email already belongs to a client, a new enquiry is added to that existing client profile.</p>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn btn-brand" id="alGo">Create lead</button>` });
  m.$('#alGo').onclick = async () => { const f = formData(m.el); f.consent = f.consent ? 'Yes' : 'No';
    try { await run(() => api('createLead', f), r => r.assigned ? `Lead created and assigned to ${Object.keys(r.perAgent)[0]}.` : 'Lead created — placed in the Unassigned queue.'); m.close(); onDone(); } catch (e) { /* toast */ } };
}

/* ------------------------------- Clients ---------------------------------- */
VIEWS.clients = async (host) => {
  if (isAdmin()) await agentList();
  const admins = isSuper() ? await api('listUsers', { role: 'admin' }, { quiet: true }) : [];
  host.innerHTML = `<div class="toolbar"><input type="search" id="cq" placeholder="Search name, phone, email, client ID…"><select id="cs">${serviceOptions('')}</select>
    ${isAdmin() ? `<select id="ca">${agentOptions('')}</select>` : ''}${isSuper() ? `<select id="cad"><option value="">All admins</option>${admins.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select>` : ''}
    <select id="cst">${statusOptions(S.boot.leadStatuses, '', 'All lead statuses')}</select><select id="cj"><option value="">Any follow-up status</option><option value="Active">Journey active</option><option value="Closed">Journey closed</option></select>
    <span class="lbl">Entry</span><input type="date" id="cf"><input type="date" id="ct"><span class="spacer"></span><button class="btn" id="cx">Export CSV</button></div><div class="card" id="ctbl"></div>`;
  const dt = dataTable($('#ctbl'), { load: (p) => api('listClients', p), params: { sort: 'createdAt', dir: 'desc' }, onRowClick: r => openProfile({ clientId: r.id }),
    columns: [{ key: 'id', label: 'Client ID', sort: true }, { key: 'name', label: 'Full name', sort: true, render: r => `<a href="#" data-act="p">${esc(r.name)}</a>` },
      { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email', render: r => `<span class="small">${esc(r.email)}</span>` }, { key: 'services', label: 'Services', render: r => r.services.split(', ').map(s => `<span class="tag">${esc(s)}</span>`).join('') },
      { key: 'source', label: 'Lead source' }, { key: 'entryDate', label: 'Entry date', sort: true, render: r => fmtDate(r.entryDate) }, { key: 'agentName', label: 'Agent' },
      { key: 'status', label: 'Status', render: r => badge(r.status) }, { key: 'journeyStatus', label: 'Journey', render: r => badge(r.journeyStatus) },
      { key: 'lastContact', label: 'Last contact', sort: true, render: r => fmtDate(r.lastContact) }, { key: 'nextFollowUp', label: 'Next follow-up', sort: true, render: r => fmtDate(r.nextFollowUp) },
      { key: 'bookingTotal', label: 'Total bookings', sort: true, num: true, render: r => r.bookingTotal ? aed(r.bookingTotal) : '—' }],
    onAction: (a, r) => openProfile({ clientId: r.id }) });
  const sync = () => dt.set({ q: $('#cq').value, serviceId: $('#cs').value, agentId: $('#ca')?.value || '', adminId: $('#cad')?.value || '', status: $('#cst').value, journey: $('#cj').value, from: $('#cf').value, to: $('#ct').value });
  $('#cq').oninput = debounce(sync); ['#cs', '#ca', '#cad', '#cst', '#cj', '#cf', '#ct'].forEach(s => { if ($(s)) $(s).onchange = sync; });
  $('#cx').onclick = async () => { const r = await api('listClients', Object.assign({}, dt.st.params, { pageSize: 'all', page: 1 }));
    downloadCSV('clients', [{ label: 'Client ID', key: 'id' }, { label: 'Name', key: 'name' }, { label: 'Phone', key: 'phone' }, { label: 'Email', key: 'email' }, { label: 'Services', key: 'services' }, { label: 'Source', key: 'source' }, { label: 'Entry date', key: 'entryDate' }, { label: 'Agent', key: 'agentName' }, { label: 'Status', key: 'status' }, { label: 'Journey', key: 'journeyStatus' }, { label: 'Last contact', key: 'lastContact' }, { label: 'Next follow-up', key: 'nextFollowUp' }, { label: 'Total bookings AED', key: 'bookingTotal' }, { label: 'Created', key: 'createdAt' }], r.rows); };
  S.reload = dt.reload; await dt.reload();
};

/* ------------------------------- Journeys --------------------------------- */
VIEWS.journeys = async (host) => {
  if (isAdmin()) await agentList();
  host.innerHTML = `<div class="toolbar"><input type="search" id="jq" placeholder="Search client…"><select id="js"><option value="">All journeys</option><option>Active</option><option>Closed</option></select>
    ${isAdmin() ? `<select id="ja">${agentOptions('')}</select>` : ''}<label class="check"><input type="checkbox" id="je"> Ending within 14 days</label>
    <span class="spacer"></span><span class="muted small">Active journeys extend automatically every 6 months with the same agent.</span></div><div class="card" id="jtbl"></div>`;
  const dt = dataTable($('#jtbl'), { load: (p) => api('listJourneys', p), params: { sort: 'endDate', dir: 'asc' },
    columns: [{ key: 'clientName', label: 'Client', sort: true, render: r => `<div class="cell-main">${esc(r.clientName)}</div><div class="cell-sub">${esc(r.phone)}</div>` },
      { key: 'service', label: 'Service' }, { key: 'agentName', label: 'Agent', sort: true }, { key: 'startDate', label: 'Journey start', sort: true, render: r => fmtDate(r.startDate) },
      { key: 'endDate', label: 'Current period ends', sort: true, render: r => fmtDate(r.endDate) }, { key: 'period', label: 'Period', num: true, sort: true },
      { key: 'status', label: 'Status', render: r => badge(r.status) + (r.closeReason ? `<div class="cell-sub">${esc(r.closeReason)}</div>` : '') },
      { key: 'pendingTasks', label: 'Open tasks', num: true }, { key: 'nextFollowUp', label: 'Next follow-up', render: r => fmtDate(r.nextFollowUp) },
      { key: 'a', label: '', render: r => `<span class="menu-actions"><button class="act" data-act="journey">${icon('eye', 13)} History</button>${r.status === 'Active' ? `<button class="act" data-act="close" style="color:var(--rose)">Close</button>` : ''}</span>` }],
    onAction: (act, r) => handleLeadAction(act, { leadId: r.leadId, clientId: r.clientId, clientName: r.clientName, phone: r.phone, service: r.service }) });
  const sync = () => dt.set({ q: $('#jq').value, status: $('#js').value, agentId: $('#ja')?.value || '', endingSoon: $('#je').checked });
  $('#jq').oninput = debounce(sync); ['#js', '#ja', '#je'].forEach(s => { if ($(s)) $(s).onchange = sync; });
  S.reload = dt.reload; await dt.reload();
};

/* ------------------------------- Agents ----------------------------------- */
VIEWS.agents = async (host) => {
  const admins = isSuper() ? await api('listUsers', { role: 'admin' }, { quiet: true }) : [];
  host.innerHTML = `<div class="toolbar"><input type="search" id="aq" placeholder="Search agents…"><span class="spacer"></span><button class="btn btn-brand" id="aNew">+ New agent</button></div><div class="card" id="atbl"></div>`;
  let rows = [];
  const draw = () => {
    const q = $('#aq').value.toLowerCase();
    const list = rows.filter(a => !q || (a.name + a.email).toLowerCase().includes(q));
    $('#atbl').innerHTML = `<div class="table-wrap"><table class="tbl"><thead><tr><th>Agent</th><th>Services</th>${isSuper() ? '<th>Admin</th>' : ''}<th>Status</th><th class="num">Assigned</th><th class="num">Completed</th><th class="num">Pending</th><th class="num">Overdue</th><th class="num">Converted</th><th class="num">Revenue</th><th></th></tr></thead><tbody>
      ${list.map((a, i) => `<tr data-i="${rows.indexOf(a)}"><td><div class="cell-main">${esc(a.name)}</div><div class="cell-sub">${esc(a.email)} · ${esc(a.phone || '')}${a.pendingSetup ? ' · <b style="color:var(--amber)">awaiting password setup</b>' : ''}</div></td>
        <td>${a.serviceNames.map(s => `<span class="tag">${esc(s)}</span>`).join('') || '<span class="muted small">None</span>'}</td>${isSuper() ? `<td>${esc(a.adminName || '—')}</td>` : ''}<td>${badge(a.status)}</td>
        <td class="num"><a href="#/leads?agentId=${a.id}">${nf(a.stats.assigned)}</a></td><td class="num">${nf(a.stats.completed)}</td><td class="num">${nf(a.stats.pending)}</td>
        <td class="num" style="${a.stats.overdue ? 'color:var(--red);font-weight:700' : ''}">${nf(a.stats.overdue)}</td><td class="num">${nf(a.stats.converted)}</td><td class="num"><b>${aed(a.stats.revenue)}</b></td>
        <td class="nowrap"><button class="btn btn-sm" data-a="edit">Edit</button> <button class="btn btn-sm" data-a="toggle">${a.status === 'Active' ? 'Deactivate' : 'Activate'}</button> <button class="btn btn-sm" data-a="reset">Reset password</button> <button class="btn btn-sm" data-a="leads">Leads</button></td></tr>`).join('')
      || '<tr><td colspan="11"><div class="empty"><b>No agents yet</b>Create your first agent and choose the services they handle.</div></td></tr>'}</tbody></table></div>`;
  };
  const load = async () => { rows = await agentList(true); draw(); };
  $('#aq').oninput = draw;
  $('#aNew').onclick = () => userModal({ role: 'agent' }, admins, load);
  $('#atbl').onclick = async (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return; const a = rows[+b.closest('tr').dataset.i];
    if (b.dataset.a === 'edit') userModal(a, admins, load);
    if (b.dataset.a === 'leads') go('#/leads?agentId=' + a.id);
    if (b.dataset.a === 'toggle' && await confirmBox(`${a.status === 'Active' ? 'Deactivate' : 'Activate'} ${esc(a.name)}?${a.status === 'Active' ? ' They will not receive new leads and cannot sign in. Existing leads stay with them until you reassign them.' : ''}`)) {
      await run(() => api('setUserStatus', { id: a.id, status: a.status === 'Active' ? 'Disabled' : 'Active' }), 'Status updated.'); load(); }
    if (b.dataset.a === 'reset' && await confirmBox(`Send ${esc(a.name)} a secure link to set a new password? Their current password stops working immediately.`)) {
      const r = await run(() => api('resetPassword', { id: a.id })); showLinkResult(r, 'Password reset email sent.'); }
  };
  S.reload = load; await load();
};
function showLinkResult(r, okMsg) {
  if (r.emailSent) return toast(okMsg, 'ok');
  modal({ title: 'Email could not be sent', body: `<p>The email could not be delivered. Share this one-time setup link with the user securely (valid 72 hours):</p><input readonly value="${esc(r.setupLink)}" onclick="this.select()">` });
}
function userModal(u, admins, onDone) {
  const isNew = !u.id, role = u.role || 'agent';
  const m = modal({ title: isNew ? `New ${roleLabel(role).toLowerCase()} account` : 'Edit ' + esc(u.name), size: 'wide',
    body: `<div class="form-grid"><label class="field"><span>Full name *</span><input name="name" value="${esc(u.name || '')}"></label>
      <label class="field"><span>Email address *</span><input name="email" type="email" value="${esc(u.email || '')}"></label>
      <label class="field"><span>Phone number</span><input name="phone" value="${esc(u.phone || '')}"></label>
      <label class="field"><span>Account status</span><select name="status">${statusOptions(['Active', 'Disabled'], u.status || 'Active')}</select></label>
      ${role === 'agent' && isSuper() ? `<label class="field"><span>Reporting admin (team)</span><select name="adminId"><option value="">— None —</option>${admins.map(a => `<option value="${a.id}" ${a.id === u.adminId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>` : ''}</div>
      ${role === 'agent' ? `<div class="field"><span style="display:block;font-size:12px;font-weight:600;margin-bottom:6px">Services this agent handles (leads are distributed equally among agents per service)</span>
      <div class="check-grid">${S.boot.services.map(s => `<label class="check"><input type="checkbox" name="services" data-multi value="${s.id}" ${(u.services || []).includes(s.id) ? 'checked' : ''}> ${esc(s.name)}${s.status !== 'Active' ? ' <span class="muted small">(inactive)</span>' : ''}</label>`).join('')}</div></div>` : ''}
      ${isNew ? '<p class="muted small">A welcome email with a secure password-setup link will be sent automatically. Passwords are never emailed.</p>' : ''}`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn btn-brand" id="uSave">${isNew ? 'Create account & send welcome email' : 'Save changes'}</button>` });
  m.$('#uSave').onclick = async () => {
    const f = formData(m.el); f.role = role; f.id = u.id; if (role === 'agent' && !f.services) f.services = [];
    try { const r = await run(() => api('saveUser', f)); m.close(); S.agents = null;
      if (isNew) showLinkResult(r, 'Account created and welcome email sent.'); else toast('Account updated.', 'ok'); onDone(); } catch (e) { /* toast */ }
  };
}

/* ------------------------------- Services --------------------------------- */
VIEWS.services = async (host) => {
  host.innerHTML = `<div class="toolbar"><span class="muted">Services are used for lead upload, agent skills and reporting.</span><span class="spacer"></span><button class="btn btn-brand" id="sNew">+ New service</button></div><div class="card" id="stbl"></div>`;
  const load = async () => {
    const [svcs, agents] = await Promise.all([api('listServices'), agentList(true)]);
    S.boot.services = svcs;
    $('#stbl').innerHTML = `<table class="tbl"><thead><tr><th>Service</th><th>Status</th><th>Agents handling it</th><th>Created</th><th></th></tr></thead><tbody>${svcs.map(s => {
      const ag = agents.filter(a => (a.services || []).includes(s.id));
      return `<tr data-id="${s.id}"><td class="cell-main">${esc(s.name)}</td><td>${badge(s.status)}</td><td>${ag.map(a => `<span class="tag">${esc(a.name)}</span>`).join('') || '<span class="badge b-overdue">No agent — leads go to Unassigned</span>'}</td>
        <td>${fmtDate(s.createdAt)}</td><td class="nowrap"><button class="btn btn-sm" data-s="edit">Rename</button> <button class="btn btn-sm" data-s="toggle">${s.status === 'Active' ? 'Deactivate' : 'Activate'}</button></td></tr>`; }).join('')}</tbody></table>`;
    $('#stbl').onclick = async (e) => {
      const b = e.target.closest('[data-s]'); if (!b) return; const s = svcs.find(x => x.id === b.closest('tr').dataset.id);
      if (b.dataset.s === 'toggle') { await run(() => api('saveService', { id: s.id, name: s.name, status: s.status === 'Active' ? 'Inactive' : 'Active' }), 'Service updated.'); load(); }
      else svcModal(s, load);
    };
  };
  $('#sNew').onclick = () => svcModal({}, load);
  S.reload = load; await load();
};
function svcModal(s, onDone) {
  const m = modal({ title: s.id ? 'Rename service' : 'New service', body: `<label class="field"><span>Service name</span><input name="name" value="${esc(s.name || '')}"></label>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn btn-brand" id="svSave">Save</button>` });
  m.$('#svSave').onclick = async () => { try { await run(() => api('saveService', { id: s.id, name: formData(m.el).name, status: s.status }), 'Service saved.'); m.close(); onDone(); } catch (e) { /* toast */ } };
}

/* ------------------------------- Bookings --------------------------------- */
VIEWS.bookings = async (host) => {
  if (isAdmin()) await agentList();
  host.innerHTML = `<div class="kpis" id="bk"></div><div class="toolbar"><input type="search" id="bq" placeholder="Search client or reference…"><select id="bs">${serviceOptions('')}</select>
    ${isAdmin() ? `<select id="ba">${agentOptions('')}</select>` : ''}<select id="bst">${statusOptions(S.boot.bookingStatuses, '', 'All booking statuses')}</select>
    <select id="bp">${statusOptions(S.boot.paymentStatuses, '', 'All payment statuses')}</select><span class="lbl">Date</span><input type="date" id="bf"><input type="date" id="bt">
    <span class="spacer"></span><button class="btn" id="bx">Export CSV</button></div><div class="card" id="btbl"></div>
    <div class="charts mt"><div class="card chart-card"><h4>Revenue by month (AED)</h4><div class="chart-box"><canvas id="bc1"></canvas></div></div>
    ${isAdmin() ? '<div class="card chart-card"><h4>Revenue by agent</h4><div class="chart-box"><canvas id="bc2"></canvas></div></div>' : ''}<div class="card chart-card"><h4>Revenue by service</h4><div class="chart-box"><canvas id="bc3"></canvas></div></div></div>`;
  const dt = dataTable($('#btbl'), { params: { sort: 'bookingDate', dir: 'desc' },
    load: async (p) => { const r = await api('listBookings', p); summary(r.summary); return r; },
    columns: [{ key: 'reference', label: 'Reference', sort: true }, { key: 'clientName', label: 'Client', sort: true, render: r => `<div class="cell-main">${esc(r.clientName)}</div><div class="cell-sub">${esc(r.phone)}</div>` },
      { key: 'service', label: 'Service' }, ...(isAdmin() ? [{ key: 'agentName', label: 'Agent', sort: true }] : []), { key: 'bookingDate', label: 'Booking date', sort: true, render: r => fmtDate(r.bookingDate) },
      { key: 'amount', label: 'Amount (AED)', sort: true, num: true, render: r => `<b style="${r.status === 'Cancelled' ? 'text-decoration:line-through;color:var(--faint)' : ''}">${aed(r.amount)}</b>` },
      { key: 'status', label: 'Status', render: r => badge(r.status) }, { key: 'paymentStatus', label: 'Payment', render: r => badge(r.paymentStatus) },
      { key: 'notes', label: 'Notes', render: r => `<span class="small">${esc(r.notes)}</span>` }, { key: 'a', label: '', render: () => `<button class="btn btn-sm" data-act="edit">Edit</button> <button class="btn btn-sm" data-act="profile">Client</button>` }],
    onAction: (act, r) => act === 'edit' ? openBooking({ clientName: r.clientName, leadId: r.leadId }, r) : openProfile({ clientId: r.clientId, tab: 'bookings' }) });
  function summary(s) {
    $('#bk').innerHTML = kpi('Total bookings', nf(s.count)) + kpi('Total booking value', aed(s.total), 'good') + kpi('Completed / paid revenue', aed(s.completedRevenue), 'good') + kpi('Cancelled (excluded)', nf(s.cancelled));
    destroyCharts();
    whenChartsReady(() => {
      const months = Object.keys(s.byMonth).sort();
      chart($('#bc1'), 'bar', months, [{ label: 'Revenue', data: months.map(m => s.byMonth[m]) }], { money: true });
      if ($('#bc2')) chart($('#bc2'), 'bar', Object.keys(s.byAgent), [{ label: 'Revenue', data: Object.values(s.byAgent), backgroundColor: '#AA2502' }], { money: true, options: { indexAxis: 'y' } });
      chart($('#bc3'), 'doughnut', Object.keys(s.byService), [{ data: Object.values(s.byService) }]);
    });
  }
  const sync = () => dt.set({ q: $('#bq').value, serviceId: $('#bs').value, agentId: $('#ba')?.value || '', status: $('#bst').value, paymentStatus: $('#bp').value, from: $('#bf').value, to: $('#bt').value });
  $('#bq').oninput = debounce(sync); ['#bs', '#ba', '#bst', '#bp', '#bf', '#bt'].forEach(s => { if ($(s)) $(s).onchange = sync; });
  $('#bx').onclick = async () => { const r = await api('listBookings', Object.assign({}, dt.st.params, { pageSize: 'all', page: 1 }));
    downloadCSV('bookings', [{ label: 'Reference', key: 'reference' }, { label: 'Client', key: 'clientName' }, { label: 'Phone', key: 'phone' }, { label: 'Service', key: 'service' }, { label: 'Agent', key: 'agentName' }, { label: 'Booking date', key: 'bookingDate' }, { label: 'Amount AED', key: 'amount' }, { label: 'Status', key: 'status' }, { label: 'Payment', key: 'paymentStatus' }, { label: 'Notes', key: 'notes' }], r.rows); };
  S.reload = dt.reload; await dt.reload();
};

/* ------------------------------- Bulk upload ------------------------------ */
const TEMPLATE_HEADERS = ['Client Name', 'Phone Number', 'Email Address', 'Service', 'Lead Entry Date', 'Lead Source', 'Additional Information', 'Marketing Consent'];
const HEADER_MAP = { clientname: 'name', name: 'name', fullname: 'name', phonenumber: 'phone', phone: 'phone', mobile: 'phone', emailaddress: 'email', email: 'email', service: 'service',
  leadentrydate: 'entryDate', entrydate: 'entryDate', date: 'entryDate', leadsource: 'source', source: 'source', additionalinformation: 'info', notes: 'info', info: 'info', marketingconsent: 'consent', consent: 'consent' };
function normPhone(v) {
  let d = String(v || '').replace(/\D/g, ''); if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2); else if (d.length === 10 && d[0] === '0') d = '971' + d.slice(1); else if (d.length === 9 && d[0] === '5') d = '971' + d;
  return d.length >= 9 && d.length <= 15 ? '+' + d : '';
}
function normDateIn(v) {
  const s = String(v || '').trim(); let m;
  if (!s) return '';
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return check(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/))) return check(+m[3], +m[2], +m[1]);
  return null;
  function check(y, mo, d) { const dt = new Date(Date.UTC(y, mo - 1, d)); return dt.getUTCMonth() === mo - 1 && y > 1990 ? dt.toISOString().slice(0, 10) : null; }
}
function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim()));
}
function downloadTemplate() {
  const sample = [TEMPLATE_HEADERS, ['Aisha Khan', '0501234567', 'aisha@example.com', 'IV Therapy', today(), 'Instagram', 'Prefers evening calls', 'Yes'],
    ['Omar Ali', '+971551112233', '', 'Laboratory Tests', today(), 'Website', '', 'No'], ['Sara Ahmed', '0529876543', 'sara@example.com', 'Doctor at Home', today(), 'Referral', 'Lives in Dubai Marina', 'Yes']];
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + sample.map(r => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv' }));
  a.download = 'sidra_lead_upload_template.csv'; a.click();
}

VIEWS.upload = async (host) => {
  const U = { rows: [], step: 1 };
  const svcByName = Object.fromEntries(S.boot.services.map(s => [s.name.toLowerCase(), s]));
  host.innerHTML = `<div class="steps"><div class="step on" data-st="1"><span>1</span>Upload file</div><div class="step" data-st="2"><span>2</span>Review & fix</div><div class="step" data-st="3"><span>3</span>Import & assign</div></div><div id="up"></div>`;
  const setStep = (n) => { U.step = n; $$('.step', host).forEach(s => s.classList.toggle('on', +s.dataset.st <= n)); };
  function step1() {
    setStep(1);
    $('#up').innerHTML = `<div class="card card-pad"><div class="gap mb"><div><h3>Upload leads in bulk</h3><p class="muted small">CSV or Excel (.xlsx). Columns: ${TEMPLATE_HEADERS.join(', ')}. Dates as YYYY-MM-DD or DD/MM/YYYY.</p></div><span class="spacer"></span>
      <button class="btn" id="tpl">⬇ Download template</button></div>
      <label class="dropzone" id="dz"><input type="file" id="file" accept=".csv,.xlsx,.xls" hidden><div style="font-size:32px">📄</div><b>Click to choose a file</b> or drag it here<div class="muted small">Thousands of rows are fine — they are imported in batches.</div></label>
      <p class="muted small mt">Only collect what's needed for follow-up. Do not include clinical notes, diagnoses or lab results.</p></div>`;
    $('#tpl').onclick = downloadTemplate;
    const dz = $('#dz');
    dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('drag'); }; dz.ondragleave = () => dz.classList.remove('drag');
    dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('drag'); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); };
    $('#file').onchange = (e) => e.target.files[0] && readFile(e.target.files[0]);
  }
  async function readFile(file) {
    let grid;
    try {
      if (/\.xlsx?$/i.test(file.name)) {
        if (!window.XLSX) return toast('Excel reader is still loading — try again in a second.', 'error');
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
        grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, dateNF: 'yyyy-mm-dd', defval: '' });
      } else grid = parseCSV(await file.text());
    } catch (e) { return toast('Could not read the file: ' + e.message, 'error'); }
    if (grid.length < 2) return toast('The file has no data rows.', 'error');
    const head = grid[0].map(h => HEADER_MAP[String(h).toLowerCase().replace(/[^a-z]/g, '')] || null);
    if (!head.includes('name') || !head.includes('phone') || !head.includes('service')) return toast('Missing required columns. Use the template: Client Name, Phone Number and Service are required.', 'error');
    U.rows = grid.slice(1).map((r, i) => { const o = { i, action: 'new' }; head.forEach((k, j) => { if (k) o[k] = String(r[j] ?? '').trim(); }); return o; });
    U.fileName = file.name;
    await validate();
  }
  async function validate() {
    const seen = {};
    U.rows.forEach(r => {
      r.errors = []; r.phoneN = normPhone(r.phone);
      if (!r.name) r.errors.push('Name required');
      if (!r.phoneN) r.errors.push('Invalid phone');
      if (r.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(r.email)) r.errors.push('Invalid email');
      const s = svcByName[String(r.service || '').toLowerCase()];
      if (!s) r.errors.push(`Unknown service "${r.service || ''}"`); else if (s.status !== 'Active') r.errors.push('Inactive service');
      if (r.entryDate && !normDateIn(r.entryDate)) r.errors.push('Invalid date');
      r.inFileDup = false;
      const k1 = r.phoneN && 'p' + r.phoneN, k2 = r.email && 'e' + r.email.toLowerCase();
      if ((k1 && seen[k1] !== undefined) || (k2 && seen[k2] !== undefined)) r.inFileDup = true;
      if (k1 && seen[k1] === undefined) seen[k1] = r.i; if (k2 && seen[k2] === undefined) seen[k2] = r.i;
    });
    // ask the server which rows match existing clients (batched)
    const valid = U.rows.filter(r => !r.errors.length);
    for (let k = 0; k < valid.length; k += 1000) {
      const res = await api('checkDuplicates', { rows: valid.slice(k, k + 1000).map(r => ({ i: r.i, phone: r.phoneN, email: r.email })) });
      res.forEach(x => { const r = U.rows[x.i]; r.match = x.match; if (x.match && r.action === 'new') r.action = 'skip'; });
    }
    U.rows.forEach(r => { if (r.inFileDup && !r.match && r.action === 'new') r.action = 'skip'; });
    step2();
  }
  function step2() {
    setStep(2);
    const inv = U.rows.filter(r => r.errors.length), dup = U.rows.filter(r => !r.errors.length && (r.match || r.inFileDup));
    const filter = U.filter || 'all';
    const list = U.rows.filter(r => filter === 'all' || (filter === 'invalid' && r.errors.length) || (filter === 'dup' && !r.errors.length && (r.match || r.inFileDup)) || (filter === 'ok' && !r.errors.length && !r.match && !r.inFileDup));
    $('#up').innerHTML = `<div class="summary-grid mb">${kpi('Rows in file', nf(U.rows.length))}${kpi('Ready to import', nf(U.rows.length - inv.length - dup.length), 'good')}${kpi('Possible duplicates', nf(dup.length), dup.length ? 'warn' : '')}${kpi('Invalid rows', nf(inv.length), inv.length ? 'warn' : '')}</div>
      <div class="card"><div class="card-head"><h3>${esc(U.fileName)}</h3><div class="chips">${[['all', 'All'], ['ok', 'Ready'], ['dup', 'Duplicates'], ['invalid', 'Invalid']].map(([k, l]) => `<button class="chip ${k === filter ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}</div><span class="spacer"></span>
        ${dup.length ? `<select id="dupAll" style="width:auto"><option value="">Set all duplicates to…</option><option value="skip">Skip duplicate</option><option value="update">Update existing client info</option><option value="newlead">Create a separate lead for existing client</option></select>` : ''}
        <button class="btn" id="back">Choose another file</button><button class="btn btn-brand" id="go" ${U.rows.length === inv.length ? 'disabled' : ''}>Confirm import</button></div>
      <div class="table-wrap" style="max-height:60vh"><table class="tbl"><thead><tr><th>#</th><th>Client</th><th>Phone</th><th>Email</th><th>Service</th><th>Entry date</th><th>Source</th><th>Check</th><th>Action</th></tr></thead><tbody>
      ${list.slice(0, 1000).map(r => `<tr class="${r.errors.length ? 'row-err' : (r.match || r.inFileDup ? 'row-dup' : '')}" data-i="${r.i}"><td>${r.i + 2}</td><td>${esc(r.name)}</td><td class="nowrap">${esc(r.phone)}</td><td class="small">${esc(r.email)}</td><td>${esc(r.service)}</td>
        <td>${esc(r.entryDate || 'Today')}</td><td>${esc(r.source)}</td>
        <td class="small">${r.errors.length ? `<b style="color:var(--rose)">${esc(r.errors.join('; '))}</b>` : r.match ? `Existing client <b>${esc(r.match.name)}</b> (${esc(r.match.clientId)})${r.match.services.length ? '<br>Has: ' + esc(r.match.services.join(', ')) : ''}` : r.inFileDup ? 'Repeated in this file' : '<span style="color:var(--green)">✓ OK</span>'}</td>
        <td>${r.errors.length ? `<button class="btn btn-sm" data-fix>Fix</button> <button class="btn btn-sm" data-skip>${r.action === 'skip' ? 'Skipped' : 'Skip'}</button>` : (r.match || r.inFileDup) ? `<select data-act style="width:auto;padding:4px">${[['skip', 'Skip duplicate'], ['update', 'Update existing client'], ['newlead', 'Create separate lead']].filter(o => r.match || o[0] !== 'update').map(([v, l]) => `<option value="${v}" ${r.action === v ? 'selected' : ''}>${l}</option>`).join('')}</select>` : 'Import'}</td></tr>`).join('')}
      </tbody></table></div>${list.length > 1000 ? `<p class="muted small card-pad">Showing first 1,000 rows of ${list.length}.</p>` : ''}</div>`;
    $('#back').onclick = step1;
    $('#go').onclick = confirmImport;
    if ($('#dupAll')) $('#dupAll').onchange = (e) => { if (!e.target.value) return; dup.forEach(r => { r.action = (!r.match && e.target.value === 'update') ? 'newlead' : e.target.value; }); step2(); };
    $('#up').onclick = (e) => {
      const f = e.target.closest('[data-f]'); if (f) { U.filter = f.dataset.f; return step2(); }
      const tr = e.target.closest('tr[data-i]'); if (!tr) return; const r = U.rows[+tr.dataset.i];
      if (e.target.closest('[data-skip]')) { r.action = 'skip'; r.skipInvalid = true; step2(); }
      if (e.target.closest('[data-fix]')) fixRow(r);
    };
    $('#up').onchange = (e) => { if (e.target.matches('[data-act]')) U.rows[+e.target.closest('tr').dataset.i].action = e.target.value; };
  }
  function fixRow(r) {
    const m = modal({ title: `Fix row ${r.i + 2}`, body: `<div class="form-grid"><label class="field"><span>Client name</span><input name="name" value="${esc(r.name)}"></label><label class="field"><span>Phone</span><input name="phone" value="${esc(r.phone)}"></label>
      <label class="field"><span>Email</span><input name="email" value="${esc(r.email)}"></label><label class="field"><span>Service</span><select name="service">${S.boot.services.filter(s => s.status === 'Active').map(s => `<option ${s.name.toLowerCase() === String(r.service).toLowerCase() ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      <label class="field"><span>Entry date</span><input name="entryDate" value="${esc(r.entryDate)}" placeholder="YYYY-MM-DD"></label><label class="field"><span>Source</span><input name="source" value="${esc(r.source)}"></label></div>
      <p class="form-error">${esc(r.errors.join('; '))}</p>`, foot: `<button class="btn" data-close>Cancel</button><button class="btn btn-brand" id="fxSave">Save & re-check</button>` });
    m.$('#fxSave').onclick = async () => { Object.assign(r, formData(m.el), { action: 'new', match: null }); m.close(); await validate(); };
  }
  async function confirmImport() {
    const send = U.rows.filter(r => !r.errors.length && r.action !== 'skip');
    const skipped = U.rows.length - send.length;
    if (!send.length) return toast('Nothing to import — every row is skipped or invalid.', 'error');
    if (!(await confirmBox(`Import <b>${nf(send.length)}</b> row(s)? ${skipped ? nf(skipped) + ' row(s) will be skipped. ' : ''}${send.filter(r => r.action === 'update').length ? 'Existing client information will be updated for rows marked "Update". ' : ''}New leads are assigned automatically to eligible agents.`, { ok: 'Import now' }))) return;
    setStep(3);
    const total = { imported: 0, updated: 0, skipped: skipped, duplicates: U.rows.filter(r => r.match || r.inFileDup).length, invalid: U.rows.filter(r => r.errors.length).length, assigned: 0, unassigned: 0, perAgent: {}, errors: [] };
    $('#up').innerHTML = `<div class="card card-pad"><h3>Importing…</h3><p class="muted" id="pmsg">Starting</p><div class="progress"><div id="pbar"></div></div><p class="muted small mt">Keep this tab open until the import finishes.</p></div>`;
    const batchId = 'BAT-' + Date.now().toString(36).toUpperCase();
    for (let k = 0; k < send.length; k += CFG.UPLOAD_CHUNK) {
      const chunk = send.slice(k, k + CFG.UPLOAD_CHUNK).map(r => ({ i: r.i, name: r.name, phone: r.phoneN, email: r.email, service: r.service, entryDate: r.entryDate ? normDateIn(r.entryDate) : '', source: r.source, info: r.info, consent: r.consent, action: r.match ? r.action : (r.action === 'update' ? 'newlead' : r.action) }));
      let res, tries = 0;
      while (!res) {
        try { res = await api('importLeads', { rows: chunk, batchId }, { quiet: true }); }
        catch (e) { if (++tries >= 3) { toast('Import stopped: ' + e.message + '. Rows already imported are saved; re-upload the remainder.', 'error'); return finish(total, true); } await new Promise(r => setTimeout(r, 2500)); }
      }
      total.imported += res.imported; total.updated += res.updated; total.assigned += res.assigned; total.unassigned += res.unassigned; total.errors.push(...res.errors);
      total.skipped += res.skipped; total.invalid += res.invalid;
      Object.entries(res.perAgent).forEach(([n, c]) => total.perAgent[n] = (total.perAgent[n] || 0) + c);
      const done = Math.min(k + CFG.UPLOAD_CHUNK, send.length);
      $('#pbar').style.width = (done / send.length * 100) + '%'; $('#pmsg').textContent = `${nf(done)} of ${nf(send.length)} rows processed · ${nf(total.imported)} leads created`;
    }
    finish(total);
  }
  function finish(t, partial) {
    S.agents = null;
    $('#up').innerHTML = `<div class="card card-pad"><h3>${partial ? 'Import partially completed' : 'Import complete ✓'}</h3><div class="summary-grid mt">
      ${kpi('Total records uploaded', nf(U.rows.length))}${kpi('Successfully imported leads', nf(t.imported), 'good')}${kpi('Clients updated', nf(t.updated))}${kpi('Duplicate records', nf(t.duplicates))}
      ${kpi('Invalid records', nf(t.invalid), t.invalid ? 'warn' : '')}${kpi('Assigned leads', nf(t.assigned), 'good')}${kpi('Unassigned leads', nf(t.unassigned), t.unassigned ? 'warn' : '')}</div>
      <h4 class="mt">Leads assigned to each agent</h4><table class="tbl" style="max-width:520px"><tbody>${Object.entries(t.perAgent).map(([n, c]) => `<tr><td>${esc(n)}</td><td class="num"><b>${nf(c)}</b></td></tr>`).join('') || '<tr><td class="muted">No leads were assigned.</td></tr>'}</tbody></table>
      ${t.unassigned ? '<p class="banner">Some leads have no active agent for their service. They are waiting in the <a href="#/leads?agentId=unassigned">Unassigned queue</a> — add the service to an agent and they will be distributed automatically.</p>' : ''}
      ${t.errors.length ? `<h4 class="mt">Server-side errors</h4><ul class="small">${t.errors.slice(0, 50).map(e => `<li>Row ${e.i + 2}: ${esc(e.msg)}</li>`).join('')}</ul>` : ''}
      <div class="gap mt"><button class="btn btn-brand" id="again">Upload another file</button><a class="btn" href="#/leads">View leads</a></div></div>`;
    $('#again').onclick = () => { U.rows = []; U.filter = 'all'; step1(); };
  }
  step1(); S.reload = null;
};

/* ------------------------------- Bulk email ------------------------------- */
VIEWS.email = async (host) => {
  await agentList();
  host.innerHTML = `<div class="tabs"><button class="tab on" data-t="new">New campaign</button><button class="tab" data-t="hist">Campaign history</button></div><div id="em"></div>`;
  const draft = { filters: {} };
  const showNew = () => {
    $('#em').innerHTML = `<div class="grid" style="grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);align-items:start">
      <div class="card card-pad"><h3 class="mb">Compose</h3><div class="form-grid">
        <label class="field"><span>Campaign name *</span><input name="name" value="${esc(draft.name || '')}" placeholder="e.g. Ramadan IV Therapy offer"></label>
        <label class="field"><span>Email type</span><select name="type">${statusOptions(['Promotional', 'Informational', 'Follow-up'], draft.type || 'Promotional')}</select></label>
        <label class="field full"><span>Subject *</span><input name="subject" value="${esc(draft.subject || '')}" placeholder="Hello {{clientName}}, …"></label></div>
        <div class="gap mb"><button class="btn btn-sm" data-ins="b"><b>B</b></button><button class="btn btn-sm" data-ins="i"><i>I</i></button><button class="btn btn-sm" data-ins="p">¶ Paragraph</button>
          <button class="btn btn-sm" data-ins="ul">• List</button><button class="btn btn-sm" data-ins="link">🔗 Link</button><button class="btn btn-sm" data-ins="cta">▶ Call-to-action button</button><button class="btn btn-sm" data-ins="name">{{clientName}}</button></div>
        <label class="field"><span>Body (basic HTML allowed)</span><textarea name="body" rows="12" id="emBody">${esc(draft.body || '<p>Dear {{clientName}},</p>\n<p>Write your message here.</p>\n<p>Kind regards,<br>Sidra Home Healthcare</p>')}</textarea></label>
        <label class="field"><span>Schedule (optional, Dubai time)</span><input type="datetime-local" name="scheduledAt" value="${esc(draft.scheduledAt || '')}"></label>
        <div class="gap"><button class="btn" id="pv">${icon('eye')} Preview email</button><button class="btn" id="test">Send test to me</button><span class="spacer"></span><button class="btn btn-brand" id="send">Review & send…</button></div></div>
      <div class="card card-pad"><h3 class="mb">Recipients</h3>
        <div class="field"><span style="font-size:12px;font-weight:600">Services</span><div class="check-grid">${S.boot.services.map(s => `<label class="check"><input type="checkbox" data-multi name="serviceIds" value="${s.id}" ${(draft.filters.serviceIds || []).includes(s.id) ? 'checked' : ''}> ${esc(s.name)}</label>`).join('')}</div><p class="muted small">None selected = all clients.</p></div>
        <label class="field"><span>Agents</span><select name="agentIds" multiple size="4">${S.agents.map(a => `<option value="${a.id}" ${(draft.filters.agentIds || []).includes(a.id) ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
        <div class="form-grid"><label class="field"><span>Lead entry from</span><input type="date" name="from" value="${esc(draft.filters.from || '')}"></label><label class="field"><span>to</span><input type="date" name="to" value="${esc(draft.filters.to || '')}"></label>
        <label class="field"><span>Activity</span><select name="activity"><option value="">Active & inactive</option><option value="active">Active clients</option><option value="inactive">Inactive (closed) clients</option></select></label>
        <label class="field"><span>Conversion</span><select name="conversion"><option value="">Converted & unconverted</option><option value="converted">Converted clients</option><option value="unconverted">Unconverted clients</option></select></label>
        <label class="field"><span>Lead status</span><select name="status">${statusOptions(S.boot.leadStatuses, '', 'Any')}</select></label><label class="field"><span>Lead source contains</span><input name="source"></label>
        <label class="field full"><span>Custom filter (name / email / phone contains)</span><input name="q"></label></div>
        <button class="btn btn-block" id="cnt">Count & preview recipients</button><div id="rc" class="mt"></div></div></div>`;
    const collect = () => { const f = formData($('#em')); draft.name = f.name; draft.type = f.type; draft.subject = f.subject; draft.body = f.body; draft.scheduledAt = f.scheduledAt;
      draft.filters = { serviceIds: f.serviceIds || [], agentIds: f.agentIds || [], from: f.from, to: f.to, activity: f.activity, conversion: f.conversion, status: f.status, source: f.source, q: f.q }; return draft; };
    $$('[data-ins]', host).forEach(b => b.onclick = () => {
      const ta = $('#emBody'), s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e) || 'text';
      let ins = { b: `<strong>${sel}</strong>`, i: `<em>${sel}</em>`, p: `<p>${sel}</p>`, ul: `<ul>\n  <li>${sel}</li>\n</ul>`, name: '{{clientName}}' }[b.dataset.ins];
      if (b.dataset.ins === 'link' || b.dataset.ins === 'cta') { const url = prompt('Link URL (https://…)', 'https://'); if (!url || !/^https?:\/\//.test(url)) return;
        ins = b.dataset.ins === 'link' ? `<a href="${esc(url)}">${sel}</a>` : `<p><a href="${esc(url)}" style="display:inline-block;padding:12px 22px;border-radius:8px;background:#E50D07;color:#fff;font-weight:bold;text-decoration:none">${sel === 'text' ? 'Book now' : sel}</a></p>`; }
      ta.setRangeText(ins, s, e, 'end'); ta.focus();
    });
    $('#cnt').onclick = async () => { const d = collect(); const r = await api('previewCampaign', { filters: d.filters, type: d.type }); draft.count = r.count;
      $('#rc').innerHTML = `<div class="kpi"><div class="label">Eligible recipients</div><div class="value">${nf(r.count)}</div><div class="hint">Excluded: ${r.excluded.noEmail} without email · ${r.excluded.unsubscribed} unsubscribed${d.type === 'Promotional' ? ` · ${r.excluded.noConsent} without marketing consent` : ''}</div></div>
        <div class="preview-box mt small">${r.sample.map(x => `${esc(x.name)} &lt;${esc(x.email)}&gt;`).join('<br>') || 'No recipients'}${r.count > r.sample.length ? `<br>…and ${r.count - r.sample.length} more` : ''}</div>`; };
    $('#pv').onclick = () => { const d = collect(); previewEmail(d.subject, d.body); };
    $('#test').onclick = async () => { const d = collect(); await run(() => api('sendTestEmail', { subject: d.subject, body: d.body }), r => 'Test email sent to ' + r.to); };
    $('#send').onclick = async () => {
      const d = collect();
      if (!d.name || !d.subject || !d.body) return toast('Campaign name, subject and body are required.', 'error');
      const r = await api('previewCampaign', { filters: d.filters, type: d.type });
      if (!r.count) return toast('No eligible recipients match these filters.', 'error');
      const svcNames = (d.filters.serviceIds || []).map(id => S.boot.services.find(s => s.id === id)?.name).join(', ') || 'All services';
      const m = modal({ title: 'Confirm bulk email', size: 'wide', body: `<div class="kv"><div><small>Campaign</small>${esc(d.name)}</div><div><small>Type</small>${esc(d.type)}</div><div><small>Recipients</small><b>${nf(r.count)}</b></div>
        <div><small>Selected service</small>${esc(svcNames)}</div><div><small>Send</small>${d.scheduledAt ? 'Scheduled ' + esc(d.scheduledAt.replace('T', ' ')) : 'Now, in batches'}</div></div>
        <p><b>Subject:</b> ${esc(d.subject)}</p><iframe sandbox="" style="width:100%;height:320px;border:1px solid var(--line);border-radius:10px" srcdoc="${esc(emailPreviewHtml(d.subject, d.body))}"></iframe>
        <p class="muted small">Emails are sent in batches to respect Google quotas (remaining batches go out every 10 minutes). Every email includes an unsubscribe link.</p>
        <label class="check"><input type="checkbox" id="ok1"> I confirm these recipients may receive this ${esc(d.type.toLowerCase())} email.</label>`,
        foot: `<button class="btn" data-close>Back</button><button class="btn btn-brand" id="fin">Send campaign</button>` });
      m.$('#fin').onclick = async () => { if (!m.$('#ok1').checked) return toast('Please tick the confirmation box.', 'error');
        try { const c = await run(() => api('createCampaign', Object.assign({}, d, { confirm: true })), c => `Campaign "${c.name}" ${c.status === 'Scheduled' ? 'scheduled' : 'started'} — ${c.sent} sent so far.`); m.close(); Object.assign(draft, { name: '', subject: '', body: '', filters: {} }); showHist(); } catch (e) { /* toast */ } };
    };
  };
  const showHist = async () => {
    $$('.tab', host).forEach(t => t.classList.toggle('on', t.dataset.t === 'hist'));
    const list = await api('listCampaigns');
    $('#em').innerHTML = `<div class="card"><table class="tbl"><thead><tr><th>Campaign</th><th>Subject</th><th>Type</th><th>Created</th><th class="num">Recipients</th><th class="num">Sent</th><th class="num">Failed</th><th>Status</th><th>By</th></tr></thead><tbody>
      ${list.map(c => `<tr><td class="cell-main">${esc(c.name)}</td><td>${esc(c.subject)}</td><td>${esc(c.type)}</td><td>${fmtDT(c.createdAt)}${c.scheduledAt ? `<div class="cell-sub">Scheduled ${fmtDT(c.scheduledAt)}</div>` : ''}</td><td class="num">${nf(c.recipientCount)}</td><td class="num">${nf(c.sent)}</td><td class="num">${nf(c.failed)}</td><td>${badge(c.status)}</td><td>${esc(c.createdByName)}</td></tr>`).join('') || '<tr><td colspan="9"><div class="empty">No campaigns yet.</div></td></tr>'}</tbody></table></div>`;
  };
  host.querySelector('.tabs').onclick = (e) => { const t = e.target.closest('[data-t]'); if (!t) return; $$('.tab', host).forEach(x => x.classList.toggle('on', x === t)); t.dataset.t === 'new' ? showNew() : showHist(); };
  showNew(); S.reload = null;
};
function emailPreviewHtml(subject, body) {
  const safe = String(body || '').replace(/<\s*(script|style|iframe)[\s\S]*?<\s*\/\s*\1\s*>/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '').replace(/\{\{\s*clientName\s*\}\}/g, 'Aisha');
  return `<div style="font-family:Arial;background:#f6f3f1;padding:16px"><div style="max-width:600px;margin:auto;background:#fff;border-radius:10px;overflow:hidden"><div style="height:6px;background:linear-gradient(90deg,#FFB800,#F26A1B,#E50D07)"></div><div style="padding:20px;font-size:14px;line-height:1.6;color:#1f2937"><h2 style="color:#AA2502;font-size:18px">${esc(subject.replace(/\{\{\s*clientName\s*\}\}/g, 'Aisha'))}</h2>${safe}<p style="font-size:11px;color:#94a3b8;margin-top:24px">You are receiving this email because you enquired with Sidra Home Healthcare. <u>Unsubscribe</u></p></div></div></div>`;
}
function previewEmail(subject, body) { modal({ title: 'Email preview', size: 'wide', body: `<iframe sandbox="" style="width:100%;height:480px;border:0" srcdoc="${esc(emailPreviewHtml(subject, body))}"></iframe>` }); }

/* ------------------------------- Client requests -------------------------- */
VIEWS.requests = async (host) => {
  if (isAdmin()) await agentList();
  host.innerHTML = `${isAgent() ? `<div class="card card-pad mb"><h3>Request a client</h3><p class="muted small">Want to manage a particular client? Enter their client ID, phone number or email and explain why.</p>
    <div class="form-grid"><label class="field"><span>Client ID, phone or email *</span><input id="rqRef" placeholder="CL-000123 or 0501234567"></label><label class="field"><span>Service (optional)</span><select id="rqSvc">${serviceOptions('', { all: true })}</select></label>
    <label class="field full"><span>Reason *</span><input id="rqReason" placeholder="e.g. I handled this client's previous booking"></label></div><button class="btn btn-brand" id="rqGo">Submit request</button></div>` : ''}
    <div class="toolbar"><div class="chips" id="rqf">${[['Pending', 'Pending'], ['Approved', 'Approved'], ['Rejected', 'Rejected'], ['', 'All']].map(([k, l], i) => `<button class="chip ${i === 0 ? 'on' : ''}" data-s="${k}">${l}</button>`).join('')}</div></div><div class="card" id="rqt"></div>`;
  const dt = dataTable($('#rqt'), { params: { status: 'Pending' }, load: (p) => api('listRequests', p),
    columns: [{ key: 'createdAt', label: 'Requested', render: r => fmtDT(r.createdAt) }, { key: 'type', label: 'Type', render: r => r.type === 'Closure' ? '<span class="tag">Journey closure</span>' : '<span class="tag">Client request</span>' },
      { key: 'clientName', label: 'Client', render: r => `<div class="cell-main">${esc(r.clientName)}</div><div class="cell-sub">${esc(r.clientId)}${r.phone ? ' · ' + esc(r.phone) : ''}</div>` }, { key: 'service', label: 'Service' },
      ...(isAdmin() ? [{ key: 'requestedByName', label: 'Requested by' }, { key: 'currentAgent', label: 'Current agent' }] : []), { key: 'reason', label: 'Reason', render: r => `<span class="small" style="display:inline-block;min-width:200px">${esc(r.reason)}</span>` },
      { key: 'status', label: 'Status', render: r => badge(r.status) + (r.reviewNote ? `<div class="cell-sub">${esc(r.reviewNote)}</div>` : '') + (r.reviewedByName ? `<div class="cell-sub">by ${esc(r.reviewedByName)}</div>` : '') },
      ...(isAdmin() ? [{ key: 'a', label: '', render: r => r.status === 'Pending' ? `<button class="btn btn-sm btn-brand" data-act="approve">Approve</button> <button class="btn btn-sm btn-danger" data-act="reject">Reject</button>` : '' }] : [])],
    onAction: (act, r) => reviewModal(r, act === 'approve', dt.reload) });
  $('#rqf').onclick = (e) => { const c = e.target.closest('[data-s]'); if (!c) return; $$('#rqf .chip').forEach(x => x.classList.toggle('on', x === c)); dt.set({ status: c.dataset.s }); };
  if ($('#rqGo')) $('#rqGo').onclick = async () => { await run(() => api('createRequest', { clientRef: $('#rqRef').value, serviceId: $('#rqSvc').value, reason: $('#rqReason').value }), 'Request submitted to your admin.'); $('#rqRef').value = $('#rqReason').value = ''; dt.reload(); };
  S.reload = dt.reload; await dt.reload();
};
function reviewModal(r, approve, onDone) {
  const m = modal({ title: (approve ? 'Approve ' : 'Reject ') + (r.type === 'Closure' ? 'journey closure' : 'client request'),
    body: `<p><b>${esc(r.requestedByName)}</b> — ${esc(r.reason)}</p>${approve && r.type === 'Client' ? `<label class="field"><span>Assign client to</span><select name="agentId">${agentOptions(r.requestedBy, { all: false, activeOnly: true })}</select></label>` : ''}
      ${approve && r.type === 'Closure' ? '<p class="muted small">All future follow-ups and notifications for this lead will stop.</p>' : ''}<label class="field"><span>Note to the agent (optional)</span><input name="note"></label>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn ${approve ? 'btn-brand' : 'btn-danger'}" id="rvGo">${approve ? 'Approve' : 'Reject'}</button>` });
  m.$('#rvGo').onclick = async () => { const f = formData(m.el); try { await run(() => api('reviewRequest', Object.assign(f, { id: r.id, approve })), 'Request ' + (approve ? 'approved.' : 'rejected.')); m.close(); onDone(); } catch (e) { /* toast */ } };
}

/* ------------------------------- Reports ---------------------------------- */
VIEWS.reports = async (host) => {
  await agentList();
  const st = { type: 'daily', current: false, from: '', to: '' };
  host.innerHTML = `<div class="tabs" id="rt">${[['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['custom', 'Custom range'], ['runs', 'Sent reports']].map(([k, l], i) => `<button class="tab ${i === 0 ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')}</div>
    <div class="toolbar no-print" id="rbar"></div><div id="rep"></div>`;
  const bar = () => {
    $('#rbar').innerHTML = st.type === 'runs' ? '' : `${st.type === 'custom' ? `<span class="lbl">From</span><input type="date" id="rf" value="${st.from}"><span class="lbl">to</span><input type="date" id="rto" value="${st.to}">` : ''}
      ${['weekly', 'monthly'].includes(st.type) ? `<label class="check"><input type="checkbox" id="rcur" ${st.current ? 'checked' : ''}> ${st.type === 'weekly' ? 'Week' : 'Month'} to date (instead of last complete ${st.type === 'weekly' ? 'week' : 'month'})</label>` : ''}
      <select id="rs">${serviceOptions('')}</select><select id="ra">${agentOptions('')}</select><span class="spacer"></span>
      <button class="btn" id="rcsv">Export CSV</button><button class="btn" id="rpdf">Export PDF</button>${st.type !== 'custom' ? `<button class="btn btn-brand" id="rmail">Email ${st.type} report now</button>` : ''}`;
  };
  async function load() {
    if (st.type === 'runs') return runs();
    bar();
    const d = await api('reportData', { type: st.type === 'custom' ? 'daily' : st.type, current: st.current, from: st.type === 'custom' ? st.from || today() : '', to: st.type === 'custom' ? st.to || today() : '', serviceId: $('#rs')?.value, agentId: $('#ra')?.value });
    const k = d.kpis; destroyCharts();
    const rows = st.type === 'daily' ? [['Total new leads', k.newLeads], ['Total assigned leads', k.assignedNew], ['Calls completed', k.callsCompleted], ['Pending calls', k.pending], ['Overdue calls', k.overdue], ['Rescheduled calls', k.rescheduled], ['Converted leads', k.convertedLeads], ['Bookings created', k.bookings], ['Booking revenue', aed(k.revenue)], ['Unassigned leads', k.unassigned]]
      : st.type === 'weekly' ? [['Weekly lead volume', k.newLeads], ['Weekly calls', k.callsLogged], ['Follow-up completion rate', k.followUpCompletionRate + '%'], ['Conversion rate', k.conversionRate + '%'], ['Booking revenue', aed(k.revenue)], ['Overdue leads', k.overdue]]
        : [['Total leads received', k.newLeads], ['Total conversions', k.convertedLeads], ['Conversion percentage', k.conversionRate + '%'], ['Total booking revenue', aed(k.revenue)], ['Follow-up completion percentage', k.followUpCompletionRate + '%'], ['Outstanding leads', k.pending]];
    $('#rep').innerHTML = `<div class="print-head"><img src="assets/logo.png" alt=""><h2>${st.type[0].toUpperCase() + st.type.slice(1)} report — ${esc(d.label)}</h2><div class="muted small">Generated ${esc(dubaiNow())} (Asia/Dubai)</div></div>
      <p class="muted">Period: <b>${esc(d.label)}</b></p><div class="kpis">${rows.map(([l, v]) => kpi(l, typeof v === 'number' ? nf(v) : v)).join('')}</div>
      <div class="card mb"><div class="card-head"><h3>Agent performance${st.type === 'weekly' ? ' & rankings' : ' comparison'}</h3></div><div class="table-wrap"><table class="tbl"><thead><tr><th>Rank</th><th>Agent</th><th class="num">Active leads</th><th class="num">New assigned</th><th class="num">Calls</th><th class="num">Completed</th><th class="num">Pending</th><th class="num">Overdue</th><th class="num">Completion</th><th class="num">Converted</th><th class="num">Revenue</th></tr></thead><tbody>
      ${d.perAgent.map(a => `<tr><td>${a.rank}</td><td class="cell-main">${esc(a.name)}</td><td class="num">${nf(a.assigned)}</td><td class="num">${nf(a.newAssigned)}</td><td class="num">${nf(a.called)}</td><td class="num">${nf(a.completed)}</td><td class="num">${nf(a.pending)}</td><td class="num">${nf(a.overdue)}</td><td class="num">${a.completionRate}%</td><td class="num">${nf(a.converted)}</td><td class="num"><b>${aed(a.revenue)}</b></td></tr>`).join('')}</tbody></table></div></div>
      <div class="card mb"><div class="card-head"><h3>Service-wise performance</h3></div><table class="tbl"><thead><tr><th>Service</th><th class="num">New leads</th><th class="num">Total leads</th><th class="num">Converted</th><th class="num">Bookings</th><th class="num">Revenue</th></tr></thead><tbody>
      ${d.perService.map(s => `<tr><td>${esc(s.name)}</td><td class="num">${nf(s.newLeads)}</td><td class="num">${nf(s.totalLeads)}</td><td class="num">${nf(s.converted)}</td><td class="num">${nf(s.bookings)}</td><td class="num">${aed(s.revenue)}</td></tr>`).join('')}</tbody></table></div>
      <div class="charts mb"><div class="card chart-card"><h4>Revenue by agent</h4><div class="chart-box"><canvas id="r1"></canvas></div></div><div class="card chart-card"><h4>Leads by service</h4><div class="chart-box"><canvas id="r2"></canvas></div></div></div>
      <div class="card"><div class="card-head"><h3>Outstanding follow-ups (${nf(d.outstanding.length)})</h3></div><div class="table-wrap" style="max-height:420px"><table class="tbl"><thead><tr><th>Agent</th><th>Client</th><th>Service</th><th>Task</th><th>Assigned date</th><th>Due</th><th>Status</th></tr></thead><tbody>
      ${d.outstanding.map(o => `<tr><td>${esc(o.agentName)}</td><td>${esc(o.clientName)}</td><td>${esc(o.service)}</td><td>${esc(o.label)}</td><td>${fmtDate(o.assignedDate)}</td><td>${fmtDate(o.dueDate)}</td><td>${o.overdue ? badge('Overdue') + ` <span class="small">${o.daysOverdue}d</span>` : badge('Pending')}</td></tr>`).join('') || '<tr><td colspan="7"><div class="empty">No outstanding follow-ups 🎉</div></td></tr>'}</tbody></table></div></div>`;
    whenChartsReady(() => {
      chart($('#r1'), 'bar', d.perAgent.map(a => a.name), [{ label: 'Revenue', data: d.perAgent.map(a => a.revenue), backgroundColor: '#AA2502' }], { money: true });
      chart($('#r2'), 'doughnut', d.perService.map(s => s.name), [{ data: d.perService.map(s => s.newLeads) }]);
    });
    $('#rcsv').onclick = () => downloadCSV(`${st.type}_report_agents`, [{ label: 'Rank', key: 'rank' }, { label: 'Agent', key: 'name' }, { label: 'Active leads', key: 'assigned' }, { label: 'New assigned', key: 'newAssigned' }, { label: 'Calls', key: 'called' }, { label: 'Completed', key: 'completed' }, { label: 'Pending', key: 'pending' }, { label: 'Overdue', key: 'overdue' }, { label: 'Completion %', key: 'completionRate' }, { label: 'Converted', key: 'converted' }, { label: 'Bookings', key: 'bookings' }, { label: 'Revenue AED', key: 'revenue' }], d.perAgent);
    $('#rpdf').onclick = () => window.print();
    if ($('#rmail')) $('#rmail').onclick = async () => { if (await confirmBox(`Email the ${st.type} report to all admins and super admins now?`)) await run(() => api('sendReportNow', { type: st.type }), r => `Report sent to ${r.sentTo.length} recipient(s).`); };
    ['#rs', '#ra', '#rcur', '#rf', '#rto'].forEach(s => { if ($(s)) $(s).onchange = () => { st.current = $('#rcur')?.checked || false; st.from = $('#rf')?.value || st.from; st.to = $('#rto')?.value || st.to; load(); }; });
  }
  async function runs() {
    $('#rbar').innerHTML = isAdmin() ? `<span class="muted">Automatic schedule (Asia/Dubai): reminder emails ${'6 PM'}, 9 PM pending-lead escalation, daily report 10 PM, weekly report Monday 8 AM, monthly report on the 1st at 8 AM.</span><span class="spacer"></span><button class="btn" id="escNow">Send 9 PM escalation now</button>` : '';
    const list = await api('listReportRuns');
    $('#rep').innerHTML = `<div class="card"><table class="tbl"><thead><tr><th>Sent</th><th>Type</th><th>Period</th><th>Recipients</th><th>Summary</th><th>Status</th></tr></thead><tbody>
      ${list.map(r => `<tr><td>${fmtDT(r.createdAt)}</td><td>${esc(r.type)}</td><td>${esc(r.periodKey)}</td><td class="small">${esc(r.sentTo)}</td><td class="small">${esc(Object.entries(r.summary).map(([k, v]) => k + ': ' + v).join(' · '))}</td><td>${badge(r.status)}</td></tr>`).join('') || '<tr><td colspan="6"><div class="empty">No reports sent yet.</div></td></tr>'}</tbody></table></div>`;
    if ($('#escNow')) $('#escNow').onclick = async () => { if (await confirmBox('Email the pending-leads escalation report now?')) { await run(() => api('sendReportNow', { type: 'escalation' }), r => `Escalation sent (${r.pending} pending).`); runs(); } };
  }
  $('#rt').onclick = (e) => { const t = e.target.closest('[data-t]'); if (!t) return; $$('#rt .tab').forEach(x => x.classList.toggle('on', x === t)); st.type = t.dataset.t; st.current = false; if (st.type === 'custom' && !st.from) { st.from = addDays(today(), -29); st.to = today(); } load(); };
  S.reload = load; await load();
};

/* ------------------------------- Notifications ---------------------------- */
VIEWS.notifications = async (host) => {
  const load = async () => {
    const r = await api('listNotifications', {});
    host.innerHTML = `${isAdmin() ? `<div class="card card-pad mb"><h3 class="mb">Send an announcement</h3><div class="form-grid"><label class="field"><span>Title</span><input id="anT"></label>
      <label class="field"><span>Audience</span><select id="anA"><option value="all">Everyone in my scope</option><option value="agents">Agents only</option>${isSuper() ? '<option value="admins">Admins only</option>' : ''}</select></label>
      <label class="field full"><span>Message</span><textarea id="anM" rows="3"></textarea></label></div><button class="btn btn-brand" id="anGo">Send announcement</button></div>` : ''}
      <div class="card"><div class="card-head"><h3>Your notifications</h3><span class="muted small">${r.unread} unread</span><span class="spacer"></span>
      <button class="btn btn-sm" id="perm">${'Notification' in window && Notification.permission === 'granted' ? '✓ Browser notifications on' : 'Enable browser notifications'}</button><button class="btn btn-sm" id="allRead">Mark all as read</button></div>
      ${r.items.map(n => `<div class="notif ${n.read === 'Yes' ? 'read' : 'unread'}"><span class="dot"></span><div style="flex:1"><b>${esc(n.title)}</b><div>${esc(n.message)}</div><div class="muted small">${fmtDT(n.createdAt)} · ${esc(n.type)}</div></div>${n.link ? `<a class="btn btn-sm" href="${esc(n.link)}">Open</a>` : ''}</div>`).join('') || '<div class="empty">No notifications yet.</div>'}
      <p class="muted small card-pad">Browser notifications appear while the CRM is open in a browser tab and you have allowed notifications. They cannot appear when the browser is completely closed.</p></div>`;
    $('#perm').onclick = requestNotifyPermission;
    $('#allRead').onclick = async () => { await api('markNotificationsRead', { all: true }); poll(true); load(); };
    if ($('#anGo')) $('#anGo').onclick = async () => { await run(() => api('announce', { title: $('#anT').value, message: $('#anM').value, audience: $('#anA').value }), r => `Announcement sent to ${r.recipients} user(s).`); };
  };
  S.reload = load; await load();
};

/* ------------------------------- Settings --------------------------------- */
VIEWS.settings = async (host) => {
  const s = await api('getSettings');
  const days = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  host.innerHTML = `<div class="grid" style="grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);align-items:start">
    <div class="card card-pad" id="setf"><h3 class="mb">Follow-up journey</h3><div class="form-grid">
      <label class="field"><span>Follow-up schedule (days after lead entry)</span><input name="followUpOffsets" value="${esc(s.followUpOffsets)}"></label>
      <label class="field"><span>Then repeat every (days) until journey ends</span><input type="number" min="1" name="recurringIntervalDays" value="${esc(s.recurringIntervalDays)}"></label>
      <label class="field"><span>Journey length (months, auto-extends)</span><input type="number" min="1" max="24" name="journeyMonths" value="${esc(s.journeyMonths)}"></label>
      <label class="field"><span>Agent journey closure needs admin approval</span><select name="closureRequiresApproval">${statusOptions(['Yes', 'No'], s.closureRequiresApproval)}</select></label></div>
      <p class="muted small">Default: 0,1,3,7,14,30 then every 30 days — i.e. initial contact, +1, +3, +7, +14, +30 days. Changes apply to new journeys and extensions.</p>
      <h3 class="mb mt">Automation times (Asia/Dubai, 24h)</h3><div class="form-grid">
      <label class="field"><span>Agent pending-reminder email hour</span><input type="number" min="0" max="23" name="reminderHour" value="${esc(s.reminderHour)}"></label>
      <label class="field"><span>Pending-lead escalation hour</span><input type="number" min="0" max="23" name="escalationHour" value="${esc(s.escalationHour)}"></label>
      <label class="field"><span>Daily report hour</span><input type="number" min="0" max="23" name="dailyReportHour" value="${esc(s.dailyReportHour)}"></label>
      <label class="field"><span>Weekly report day</span><select name="weeklyReportDay">${days.map((d, i) => i ? `<option value="${i}" ${+s.weeklyReportDay === i ? 'selected' : ''}>${d}</option>` : '').join('')}</select></label>
      <label class="field"><span>Weekly / monthly report hour</span><input type="number" min="0" max="23" name="reportHour" value="${esc(s.reportHour)}"></label>
      <label class="field"><span>Bulk email batch size (per 10 min)</span><input type="number" min="1" max="100" name="emailBatchSize" value="${esc(s.emailBatchSize)}"></label>
      <label class="field full"><span>Extra report recipients (comma-separated emails)</span><input name="reportRecipients" value="${esc(s.reportRecipients)}"></label></div>
      <h3 class="mb mt">Templates</h3><p class="muted small">Placeholders: {{clientName}}, {{agentName}}, {{service}}, {{agentPhone}}</p>
      <label class="field"><span>WhatsApp message</span><textarea name="whatsappTemplate" rows="3">${esc(s.whatsappTemplate)}</textarea></label>
      <label class="field"><span>Agent email subject</span><input name="emailSubjectTemplate" value="${esc(s.emailSubjectTemplate)}"></label>
      <label class="field"><span>Agent email body</span><textarea name="emailBodyTemplate" rows="8">${esc(s.emailBodyTemplate)}</textarea></label>
      <h3 class="mb mt">General</h3><div class="form-grid"><label class="field"><span>Company name</span><input name="companyName" value="${esc(s.companyName)}"></label>
      <label class="field"><span>CRM URL (GitHub Pages, used in emails)</span><input name="frontendUrl" value="${esc(s.frontendUrl)}" placeholder="https://username.github.io/sidra-home-healthcare-crm/"></label></div>
      <button class="btn btn-brand" id="saveSet">Save settings</button></div>
    <div><div class="card card-pad mb"><h3 class="mb">System</h3><div class="kv" style="grid-template-columns:1fr"><div><small>API (Web App) URL</small><span class="small" style="word-break:break-all">${esc(s.webAppUrl || '—')}</span></div>
      <div><small>Email quota remaining today</small><b>${nf(s.emailQuotaRemaining)}</b></div><div><small>Timezone · currency</small>Asia/Dubai · AED</div></div></div>
      <div class="card card-pad"><h3 class="mb">Run scheduled jobs now</h3><p class="muted small">Jobs run automatically every hour via Apps Script triggers. Use these buttons for testing.</p><div class="grid">
      ${[['journeys', 'Extend due journeys & generate tasks'], ['morning', 'Send morning task notifications'], ['reminder', 'Send pending-follow-up reminder emails'], ['escalation', 'Send 9 PM escalation report'], ['daily', 'Send daily report'], ['weekly', 'Send weekly report'], ['monthly', 'Send monthly report'], ['emailQueue', 'Process bulk email queue']]
        .map(([k, l]) => `<button class="btn" data-job="${k}">${l}</button>`).join('')}</div></div></div></div>`;
  $('#saveSet').onclick = async () => { const f = formData($('#setf')); const r = await run(() => api('saveSettings', f), 'Settings saved.'); S.boot.whatsappTemplate = r.whatsappTemplate; S.boot.closureRequiresApproval = r.closureRequiresApproval === 'Yes'; };
  host.addEventListener('click', async (e) => { const j = e.target.closest('[data-job]'); if (!j) return; if (await confirmBox(`Run "${j.textContent}" now?`)) await run(() => api('runJob', { job: j.dataset.job }), r => 'Done: ' + JSON.stringify(r)); });
  S.reload = null;
};

/* ------------------------------- User management -------------------------- */
VIEWS.users = async (host) => {
  host.innerHTML = `<div class="tabs" id="ut"><button class="tab on" data-t="users">Users</button><button class="tab" data-t="logs">Activity log</button></div><div id="uv"></div>`;
  async function users() {
    const [list, admins] = await Promise.all([api('listUsers'), api('listUsers', { role: 'admin' }, { quiet: true })]);
    S.boot.services = await api('listServices', {}, { quiet: true });
    $('#uv').innerHTML = `<div class="toolbar"><input type="search" id="uq" placeholder="Search users…"><select id="ur"><option value="">All roles</option><option value="super_admin">Super Admin</option><option value="admin">Admin</option><option value="agent">Agent</option></select>
      <span class="spacer"></span><button class="btn" id="nAgent">+ New agent</button><button class="btn btn-brand" id="nAdmin">+ New admin</button></div><div class="card" id="utbl"></div>`;
    const draw = () => {
      const q = $('#uq').value.toLowerCase(), r = $('#ur').value;
      const rows = list.filter(u => (!r || u.role === r) && (!q || (u.name + u.email).toLowerCase().includes(q)));
      $('#utbl').innerHTML = `<table class="tbl"><thead><tr><th>Name</th><th>Role</th><th>Team admin</th><th>Status</th><th>Last sign in</th><th>Created</th><th></th></tr></thead><tbody>${rows.map(u => `<tr data-id="${u.id}">
        <td><div class="cell-main">${esc(u.name)}${u.id === S.user.id ? ' <span class="tag">You</span>' : ''}</div><div class="cell-sub">${esc(u.email)}${u.pendingSetup ? ' · awaiting password setup' : ''}</div></td><td>${roleLabel(u.role)}</td><td>${esc(u.adminName || '—')}</td>
        <td>${badge(u.status)}</td><td>${fmtDT(u.lastLogin)}</td><td>${fmtDate(u.createdAt)}</td>
        <td class="nowrap">${u.id === S.user.id ? `<button class="btn btn-sm" data-u="edit">Edit</button>` : `<button class="btn btn-sm" data-u="edit">Edit</button> <button class="btn btn-sm" data-u="toggle">${u.status === 'Active' ? 'Disable' : 'Enable'}</button> <button class="btn btn-sm" data-u="reset">Reset password</button> <button class="btn btn-sm btn-danger" data-u="del">Delete</button>`}</td></tr>`).join('')}</tbody></table>`;
    };
    $('#uq').oninput = draw; $('#ur').onchange = draw; draw();
    $('#nAgent').onclick = () => userModal({ role: 'agent' }, admins, users);
    $('#nAdmin').onclick = () => userModal({ role: 'admin' }, admins, users);
    $('#utbl').onclick = async (e) => {
      const b = e.target.closest('[data-u]'); if (!b) return; const u = list.find(x => x.id === b.closest('tr').dataset.id);
      if (b.dataset.u === 'edit') userModal(u, admins, users);
      if (b.dataset.u === 'toggle' && await confirmBox(`${u.status === 'Active' ? 'Disable' : 'Enable'} ${esc(u.name)}?`)) { await run(() => api('setUserStatus', { id: u.id, status: u.status === 'Active' ? 'Disabled' : 'Active' }), 'Updated.'); users(); }
      if (b.dataset.u === 'reset' && await confirmBox(`Send ${esc(u.name)} a password reset link?`)) showLinkResult(await run(() => api('resetPassword', { id: u.id })), 'Reset email sent.');
      if (b.dataset.u === 'del' && await confirmBox(`Permanently delete ${esc(u.name)}? Agents with leads must have their leads reassigned first — or disable the account instead.`, { danger: true, ok: 'Delete' })) { await run(() => api('deleteUser', { id: u.id }), 'Account deleted.'); users(); }
    };
  }
  async function logs() {
    $('#uv').innerHTML = `<div class="toolbar"><input type="search" id="lgq" placeholder="Search actions, users, details…"><span class="lbl">From</span><input type="date" id="lgf"><span class="lbl">to</span><input type="date" id="lgt"><span class="spacer"></span><button class="btn" id="lgx">Export CSV</button></div><div class="card" id="lgtbl"></div>`;
    const dt = dataTable($('#lgtbl'), { params: { pageSize: 50 }, load: (p) => api('listLogs', p),
      columns: [{ key: 'at', label: 'When', render: r => `<span class="nowrap">${fmtDT(r.at)}</span>` }, { key: 'userName', label: 'User' }, { key: 'action', label: 'Action', render: r => `<b>${esc(r.action)}</b>` },
        { key: 'entityType', label: 'Record', render: r => `${esc(r.entityType)} <span class="cell-sub">${esc(r.entityId)}</span>` }, { key: 'details', label: 'Details', render: r => `<span class="small" style="display:inline-block;min-width:280px">${esc(prettyDetails(r.details)).slice(0, 300)}</span>` }] });
    $('#lgq').oninput = debounce(() => dt.set({ q: $('#lgq').value }));
    $('#lgf').onchange = $('#lgt').onchange = () => dt.set({ from: $('#lgf').value, to: $('#lgt').value });
    $('#lgx').onclick = async () => { const r = await api('listLogs', Object.assign({}, dt.st.params, { pageSize: 'all', page: 1 })); downloadCSV('activity_log', [{ label: 'When', key: 'at' }, { label: 'User', key: 'userName' }, { label: 'Action', key: 'action' }, { label: 'Type', key: 'entityType' }, { label: 'ID', key: 'entityId' }, { label: 'Details', key: 'details' }], r.rows); };
    S.reload = dt.reload; await dt.reload();
  }
  $('#ut').onclick = (e) => { const t = e.target.closest('[data-t]'); if (!t) return; $$('#ut .tab').forEach(x => x.classList.toggle('on', x === t)); t.dataset.t === 'users' ? users() : logs(); };
  S.reload = users; await users();
};

/* ============================================================================
 *  BOOT
 * ==========================================================================*/
(async function boot() {
  if (!CFG.API_URL || /PASTE|YOUR/i.test(CFG.API_URL)) {
    showAuth();
    $('#loginError').innerHTML = 'Setup needed: open <b>config.js</b> and paste your Google Apps Script Web App URL (see README).';
    return;
  }
  if (new URLSearchParams(location.search).get('setup')) return showAuth();
  if (S.token) {
    try { const r = await api('me'); return startApp(r.user, r.boot); } catch (e) { clearSession(); }
  }
  showAuth();
})();
