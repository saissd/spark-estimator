/* ============================================================
 * app.js — application controller, state, rendering, interactions.
 *
 * Covers: project management, the room-based estimator, price
 * overrides (per-project + global), add/remove items, progress
 * tracking, photo capture, the Deal Analyzer, and export wiring.
 *
 * Render model: on a state change we re-render #app from scratch
 * (simple + reliable). The one exception is live quantity typing,
 * which patches totals in place so the number field keeps focus.
 * ============================================================ */

const { CATALOG_SEED, GROUPS, ROOM_TYPES, DEFAULT_ROOMS, REQUIRED_GROUP_KEYS } = window.SPARK_DATA;

/* ----------------------------- utils ----------------------------- */
let _idSeq = 0;
function uid(prefix) {
  _idSeq += 1;
  return `${prefix}_${Date.now().toString(36)}_${_idSeq.toString(36)}`;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function money(n) {
  const v = Math.round(Number(n) || 0);
  return '$' + v.toLocaleString('en-US');
}
function moneyExact(n) {
  return '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return ''; }
}
function nowISO() { return new Date().toISOString(); }
const $ = sel => document.querySelector(sel);

/* ----------------------------- state ----------------------------- */
const App = {
  project: null,          // the loaded project object
  view: 'estimate',       // 'estimate' | 'deal' | 'summary'
  activeRoomId: null,
  expanded: new Set(),    // expanded group keys, namespaced by room: `${roomId}:${groupKey}`
  photoCache: new Map(),  // photoId -> { record, url }
  pendingPhoto: null,     // { roomId, itemId } awaiting a camera result
  globalPrices: null,     // id -> cost
};

/* ----------------- global price list (seeded once) ---------------- */
function seedGlobalPricesIfNeeded() {
  let gp = Store.getGlobalPrices();
  if (!gp) {
    gp = {};
    CATALOG_SEED.forEach(it => { gp[it.id] = it.cost; });
    Store.setGlobalPrices(gp);
  }
  App.globalPrices = gp;
}

/* --------------------------- catalog ----------------------------- */
// Resolve an item id -> { id, name, cost(resolved), unit, serial, custom }
const SEED_BY_ID = Object.fromEntries(CATALOG_SEED.map(it => [it.id, it]));

function customById(id) {
  return (App.project.custom || []).find(c => c.id === id) || null;
}
function isDeleted(id) {
  return (App.project.deleted || []).includes(id);
}
function resolvedPrice(id) {
  const ov = App.project.overrides && App.project.overrides[id];
  if (ov != null && ov !== '') return Number(ov);
  if (App.globalPrices[id] != null) return Number(App.globalPrices[id]);
  const seed = SEED_BY_ID[id];
  if (seed) return seed.cost;
  const cu = customById(id);
  return cu ? Number(cu.cost) : 0;
}
function itemDef(id) {
  const seed = SEED_BY_ID[id];
  if (seed) return { ...seed, cost: resolvedPrice(id), custom: false };
  const cu = customById(id);
  if (cu) return { ...cu, cost: resolvedPrice(id), custom: true };
  return null;
}

// Items offered by a group: seed ids in GROUPS + any custom items tagged to it,
// minus anything deleted in this project.
function groupItems(groupKey) {
  const g = GROUPS[groupKey];
  if (!g) return [];
  const ids = [...g.ids];
  (App.project.custom || []).forEach(c => { if (c.group === groupKey) ids.push(c.id); });
  return ids.filter(id => !isDeleted(id)).map(itemDef).filter(Boolean);
}

/* --------------------------- entries ----------------------------- */
function entryKey(roomId, itemId) { return `${roomId}::${itemId}`; }
function getEntry(roomId, itemId) {
  const k = entryKey(roomId, itemId);
  return App.project.entries[k] || { checked: false, qty: '', serial: '', note: '' };
}
function setEntry(roomId, itemId, patch) {
  const k = entryKey(roomId, itemId);
  App.project.entries[k] = { ...getEntry(roomId, itemId), ...patch };
}
function noActionKey(roomId, groupKey) { return `${roomId}::${groupKey}`; }
function isNoAction(roomId, groupKey) {
  return !!(App.project.noAction && App.project.noAction[noActionKey(roomId, groupKey)]);
}
function setNoAction(roomId, groupKey, val) {
  App.project.noAction = App.project.noAction || {};
  if (val) App.project.noAction[noActionKey(roomId, groupKey)] = true;
  else delete App.project.noAction[noActionKey(roomId, groupKey)];
}

/* ------------------------- calculations -------------------------- */
function lineTotal(roomId, item) {
  const e = getEntry(roomId, item.id);
  if (!e.checked) return 0;
  const q = parseFloat(e.qty);
  if (!q || q <= 0) return 0;
  return q * resolvedPrice(item.id);
}
function groupTotal(roomId, groupKey) {
  return groupItems(groupKey).reduce((t, it) => t + lineTotal(roomId, it), 0);
}
function roomTotal(room) {
  const type = ROOM_TYPES[room.type];
  if (!type) return 0;
  return type.groups.reduce((t, gk) => t + groupTotal(room.id, gk), 0);
}
function grandTotal() {
  return App.project.rooms.reduce((t, r) => t + roomTotal(r), 0);
}

// Progress: counted per group across all rooms. A group is "done" if
// No Action Needed is set, or any item in it is checked.
function progress() {
  let total = 0, done = 0;
  App.project.rooms.forEach(room => {
    const type = ROOM_TYPES[room.type];
    if (!type) return;
    type.groups.forEach(gk => {
      total += 1;
      const complete = isNoAction(room.id, gk) ||
        groupItems(gk).some(it => getEntry(room.id, it.id).checked);
      if (complete) done += 1;
    });
  });
  return { total, done, pct: total ? Math.round(done / total * 100) : 0 };
}

/* ----------------------- project lifecycle ----------------------- */
function roomName(type, existing) {
  const t = ROOM_TYPES[type];
  if (t.fixed) return t.label;
  // Next instance number = one past the highest number already in use, so
  // removing then re-adding never collides (e.g. Bathroom 1/2 → remove 1 →
  // add → Bathroom 3, not a duplicate Bathroom 2).
  const sameType = existing.filter(r => r.type === type);
  let maxN = 0;
  sameType.forEach(r => { const m = /(\d+)\s*$/.exec(r.name); if (m) maxN = Math.max(maxN, +m[1]); });
  return `${t.label} ${Math.max(maxN, sameType.length) + 1}`;
}

function newProject(name) {
  const rooms = [];
  DEFAULT_ROOMS.forEach(d => {
    rooms.push({ id: uid('room'), type: d.type, name: roomName(d.type, rooms) });
  });
  return {
    id: uid('proj'),
    name: name || 'New Estimate',
    createdAt: nowISO(),
    updatedAt: nowISO(),
    rooms,
    entries: {},
    noAction: {},
    overrides: {},
    custom: [],
    deleted: [],
    deal: { purchase: '', arv: '', extra: '' },
  };
}

let _saveTimer = null;
function scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(persist, 500);
}
function persist() {
  if (!App.project) return;
  App.project.updatedAt = nowISO();
  Store.saveProject(App.project);
}

async function loadProject(project) {
  // Tear down previous photo object URLs.
  App.photoCache.forEach(v => URL.revokeObjectURL(v.url));
  App.photoCache.clear();

  App.project = project;
  App.activeRoomId = project.rooms[0] ? project.rooms[0].id : null;
  App.view = 'estimate';
  App.expanded = new Set();
  Store.setActiveId(project.id);

  // Hydrate photos for thumbnails.
  try {
    const photos = await Store.Photos.listForProject(project.id);
    photos.forEach(p => {
      App.photoCache.set(p.id, { record: p, url: URL.createObjectURL(p.blob) });
    });
  } catch (e) { console.warn('photo load failed', e); }

  render();
}

function photosFor(roomId, itemId) {
  const out = [];
  App.photoCache.forEach((v, id) => {
    if (v.record.roomId === roomId && v.record.itemId === itemId) out.push({ id, ...v });
  });
  return out;
}

/* ============================================================
 *                          RENDERING
 * ============================================================ */
function render() {
  const app = $('#app');
  if (!App.project) { app.innerHTML = renderEmpty(); bind(); return; }
  if (App.view === 'deal') app.innerHTML = renderDealView();
  else if (App.view === 'summary') app.innerHTML = renderSummaryView();
  else app.innerHTML = renderEstimateView();
  bind();
}

function renderEmpty() {
  return `
  <div class="welcome">
    <div class="welcome__logo"><img src="icons/icon-192.png" alt="Spark Homes"/></div>
    <div class="welcome__brand">Spark Homes</div>
    <h1 class="welcome__title">Repair Estimator</h1>
    <p class="welcome__tag">Walk a property, check off repairs room by room, and get a live cost total — then export Excel + photos. Works fully offline.</p>
    <div class="welcome__actions">
      <button class="btn btn--primary" data-action="new-project">+ Start a new estimate</button>
      <button class="btn btn--ghost" data-action="load-demo">▶ Try a demo walkthrough</button>
    </div>
    <div class="welcome__feats">
      <span>📴 Offline-ready</span><span>📷 Photo + serial OCR</span><span>📈 Deal Analyzer</span><span>📲 Installable</span>
    </div>
  </div>`;
}

function renderAppbar() {
  const p = App.project;
  const total = grandTotal();
  const pg = progress();
  return `
  <header class="appbar">
    <div class="appbar__row">
      <button class="iconbtn" data-action="open-drawer" aria-label="Projects">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>
      <div class="appbar__brand"><img src="icons/icon-192.png" alt=""/> Spark Estimator</div>
      <button class="iconbtn" data-action="open-settings" aria-label="Settings">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>
    </div>
    <div class="appbar__totalwrap">
      <div class="appbar__label">Running Total</div>
      <div class="appbar__total tabnum" id="hdr-total">${money(total)}</div>
      <div class="appbar__meta">
        <span class="name">${esc(p.name)}</span>
        <button class="iconbtn" style="width:28px;height:28px;color:#64748b" data-action="rename-project" aria-label="Rename">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
      </div>
      <div class="progress">
        <div class="progress__track"><div class="progress__fill" id="pgfill" style="width:${pg.pct}%"></div></div>
        <span class="progress__txt" id="pgtxt">${pg.done}/${pg.total} groups · ${pg.pct}%</span>
      </div>
    </div>
  </header>`;
}

function renderRoomTabs() {
  const tabs = App.project.rooms.map(r => {
    const active = r.id === App.activeRoomId;
    const t = roomTotal(r);
    const icon = ROOM_TYPES[r.type] ? ROOM_TYPES[r.type].icon : '🏠';
    return `<button class="roomtab ${active ? 'active' : ''}" data-action="switch-room" data-room="${r.id}">
      <span>${icon}</span><span>${esc(r.name)}</span>${t > 0 ? `<span class="dot"></span>` : ''}
    </button>`;
  }).join('');
  return `<nav class="roomtabs">${tabs}
    <button class="roomtab__add" data-action="add-room">+ Room</button></nav>`;
}

function renderGroup(room, groupKey) {
  const g = GROUPS[groupKey];
  const items = groupItems(groupKey);
  const expKey = `${room.id}:${groupKey}`;
  const open = App.expanded.has(expKey);
  const gt = groupTotal(room.id, groupKey);
  const checkedCount = items.filter(it => getEntry(room.id, it.id).checked).length;
  const na = isNoAction(room.id, groupKey);
  const complete = na || checkedCount > 0;

  return `
  <div class="group ${complete ? 'has-checked' : ''}">
    <button class="group__head" data-action="toggle-group" data-exp="${expKey}">
      <span class="group__chev ${open ? 'open' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><polyline points="9 6 15 12 9 18"/></svg>
      </span>
      <span class="group__name">${esc(g.label)}</span>
      ${checkedCount > 0 ? `<span class="group__badge">${checkedCount} ✓</span>` : (na ? `<span class="group__badge" style="background:var(--green-tint);color:var(--green)">✓ reviewed</span>` : '')}
      <span class="group__total ${gt > 0 ? '' : 'zero'}" data-grouptotal="${expKey}">${gt > 0 ? money(gt) : '—'}</span>
    </button>
    ${open ? `<div class="group__body">
      ${renderNoAction(room, groupKey, na)}
      ${items.map(it => renderItem(room, it)).join('')}
      <button class="additem" data-action="add-item" data-group="${groupKey}">+ Add line item</button>
    </div>` : ''}
  </div>`;
}

function renderNoAction(room, groupKey, na) {
  return `<div class="noaction ${na ? 'on' : ''}" data-action="toggle-noaction" data-room="${room.id}" data-group="${groupKey}">
    <span class="check ${na ? 'on' : ''}">${na ? checkSvg() : ''}</span>
    <span class="noaction__txt">No action needed</span>
  </div>`;
}

function renderItem(room, item) {
  const e = getEntry(room.id, item.id);
  const key = entryKey(room.id, item.id);
  const total = lineTotal(room.id, item);
  const photos = photosFor(room.id, item.id);
  return `
  <div class="item ${e.checked ? 'on' : ''}">
    <div class="item__top">
      <button class="check ${e.checked ? 'on' : ''}" data-action="toggle-item" data-room="${room.id}" data-item="${item.id}" aria-pressed="${e.checked}" aria-label="${e.checked ? 'Uncheck' : 'Check'} ${esc(item.name)}">${e.checked ? checkSvg() : ''}</button>
      <div class="item__main">
        <div class="item__row">
          <div class="item__name">${esc(item.name)}${item.custom ? '<span class="tag">custom</span>' : ''}${item.serial ? '<span class="tag tag--serial">serial</span>' : ''}</div>
          <div class="item__total ${total > 0 ? '' : 'zero'}" data-linetotal="${key}">${total > 0 ? money(total) : '—'}</div>
        </div>
        <div class="item__sub">${moneyExact(resolvedPrice(item.id))} / ${esc(item.unit)}</div>
        ${e.checked ? renderItemControls(room, item, e, photos) : ''}
      </div>
    </div>
  </div>`;
}

function renderItemControls(room, item, e, photos) {
  return `
    <div class="qty">
      <span class="qty__label">Qty</span>
      <div class="stepper">
        <button data-action="qty-step" data-room="${room.id}" data-item="${item.id}" data-delta="-1">−</button>
        <input type="number" inputmode="decimal" min="0" step="any" value="${e.qty}" placeholder="0"
               data-action="qty-input" data-room="${room.id}" data-item="${item.id}" />
        <button data-action="qty-step" data-room="${room.id}" data-item="${item.id}" data-delta="1">+</button>
      </div>
      <span class="qty__unit">${esc(item.unit)}</span>
      <button class="pricebtn" data-action="edit-price" data-item="${item.id}">edit price</button>
    </div>
    <div class="noterow">
      <input class="noteinput" type="text" value="${esc(e.note || '')}" placeholder="📝 Note for the crew (e.g. tub cracked — full tearout)"
             data-action="note-input" data-room="${room.id}" data-item="${item.id}" />
    </div>
    <div class="photos">
      <div class="photos__label">Photos${item.serial ? ' · capture the serial plate' : ''}</div>
      <div class="photos__grid">
        ${photos.map(ph => `
          <div class="thumb">
            <img src="${ph.url}" alt="photo"/>
            <button class="thumb__del" data-action="remove-photo" data-photo="${ph.id}">×</button>
            ${ph.record.serial ? `<div class="thumb__serial">SN: ${esc(ph.record.serial)}</div>` : ''}
          </div>`).join('')}
        <button class="addphoto" data-action="add-photo" data-room="${room.id}" data-item="${item.id}">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l2-3h8l2 3h3a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          Add
        </button>
      </div>
    </div>`;
}

function checkSvg() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
}

function renderEstimateView() {
  const room = App.project.rooms.find(r => r.id === App.activeRoomId) || App.project.rooms[0];
  if (!room) {
    return `${renderAppbar()}${renderRoomTabs()}<div class="content"><div class="empty"><p>No rooms yet. Add one to begin.</p></div></div>${renderBottomBar()}`;
  }
  App.activeRoomId = room.id;
  const type = ROOM_TYPES[room.type];
  const body = type.groups.map(gk => renderGroup(room, gk)).join('');
  return `
    ${renderAppbar()}
    ${renderRoomTabs()}
    <main class="content">
      <div class="roomhead">
        <div class="roomhead__title">${type.icon} ${esc(room.name)}</div>
        <div class="roomhead__actions">
          <button class="minibtn" data-action="rename-room" data-room="${room.id}">✎ Rename</button>
          <button class="minibtn danger" data-action="remove-room" data-room="${room.id}">🗑 Remove</button>
        </div>
      </div>
      ${body}
    </main>
    ${renderBottomBar()}`;
}

function renderBottomBar() {
  return `<div class="bottombar">
    <button class="btn btn--ghost" data-action="open-deal">📈 Deal</button>
    <button class="btn btn--ghost" data-action="open-summary">☰ Summary</button>
    <button class="btn btn--primary" data-action="export">⬇ Export</button>
  </div>`;
}

/* live patch of totals during quantity typing (keeps input focused) */
function patchDerived() {
  const total = grandTotal();
  const t = $('#hdr-total'); if (t) t.textContent = money(total);
  const pg = progress();
  const f = $('#pgfill'); if (f) f.style.width = pg.pct + '%';
  const x = $('#pgtxt'); if (x) x.textContent = `${pg.done}/${pg.total} groups · ${pg.pct}%`;
  const room = App.project.rooms.find(r => r.id === App.activeRoomId);
  if (!room) return;
  document.querySelectorAll('[data-linetotal]').forEach(el => {
    const [rid, iid] = el.getAttribute('data-linetotal').split('::');
    const def = itemDef(iid); if (!def) return;
    const v = lineTotal(rid, def);
    el.textContent = v > 0 ? money(v) : '—';
    el.classList.toggle('zero', !(v > 0));
  });
  document.querySelectorAll('[data-grouptotal]').forEach(el => {
    const [rid, gk] = el.getAttribute('data-grouptotal').split(':');
    const v = groupTotal(rid, gk);
    el.textContent = v > 0 ? money(v) : '—';
    el.classList.toggle('zero', !(v > 0));
  });
}

/* ======================== Deal Analyzer ========================= */
function renderDealView() {
  const d = App.project.deal || {};
  const repair = grandTotal();
  const purchase = parseFloat(d.purchase) || 0;
  const arv = parseFloat(d.arv) || 0;
  const extra = parseFloat(d.extra) || 0;
  const totalCost = purchase + repair + extra;
  const profit = arv - totalCost;
  const roi = totalCost > 0 ? profit / totalCost : null;
  const hasInputs = purchase > 0 || arv > 0;

  // Verdict heuristic (house-flipping rule of thumb): ROI >= 15% go,
  // 5–15% caution, < 5% no-go.
  let cls = 'caution', badge = 'Enter numbers';
  if (hasInputs && roi != null) {
    if (roi >= 0.15) { cls = 'go'; badge = '✅ Good Deal'; }
    else if (roi >= 0.05) { cls = 'caution'; badge = '⚠ Thin Margin'; }
    else { cls = 'nogo'; badge = '⛔ Pass'; }
  }

  return `
  <header class="appbar">
    <div class="appbar__row">
      <button class="iconbtn" data-action="back-estimate" aria-label="Back to estimate">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <div class="appbar__brand">Deal Analyzer</div>
      <span style="width:38px"></span>
    </div>
  </header>
  <main class="content" style="padding-top:18px">
    <div class="deal__verdict ${cls}">
      <div class="deal__badge">${badge}</div>
      <div class="deal__profit">${hasInputs ? money(profit) : '—'}</div>
      <div class="deal__roi">${roi != null && hasInputs ? `Projected profit · ${(roi * 100).toFixed(1)}% return on cost` : 'Estimated profit after repairs'}</div>
    </div>

    <div class="deal__lines">
      <div class="deal__line"><span class="muted">Purchase price</span><span>${money(purchase)}</span></div>
      <div class="deal__line"><span class="muted">Repair estimate</span><span>${money(repair)}</span></div>
      <div class="deal__line"><span class="muted">Other costs (holding, closing, fees)</span><span>${money(extra)}</span></div>
      <div class="deal__line bold"><span>Total cost basis</span><span>${money(totalCost)}</span></div>
      <div class="deal__line"><span class="muted">After Repair Value (ARV)</span><span>${money(arv)}</span></div>
      <div class="deal__line bold"><span>Projected profit</span><span>${hasInputs ? money(profit) : '—'}</span></div>
    </div>

    <div class="field">
      <label>Purchase price</label>
      <input type="number" inputmode="numeric" placeholder="e.g. 95000" value="${d.purchase || ''}" data-action="deal-input" data-field="purchase" />
    </div>
    <div class="field">
      <label>After Repair Value (ARV)</label>
      <input type="number" inputmode="numeric" placeholder="e.g. 185000" value="${d.arv || ''}" data-action="deal-input" data-field="arv" />
      <div class="hint">What the renovated home will sell for.</div>
    </div>
    <div class="field">
      <label>Other costs (optional)</label>
      <input type="number" inputmode="numeric" placeholder="holding, closing, agent fees" value="${d.extra || ''}" data-action="deal-input" data-field="extra" />
      <div class="hint">Repair estimate (${money(repair)}) is pulled in automatically from your walkthrough.</div>
    </div>
  </main>`;
}

/* ========================== Summary ============================= */
function renderSummaryView() {
  const rooms = App.project.rooms.map(room => {
    const type = ROOM_TYPES[room.type];
    const lines = [];
    type.groups.forEach(gk => {
      groupItems(gk).forEach(it => {
        const e = getEntry(room.id, it.id);
        const t = lineTotal(room.id, it);
        if (e.checked && t > 0) lines.push({ name: it.name, qty: e.qty, unit: it.unit, total: t });
      });
    });
    return { label: room.name, lines, subtotal: roomTotal(room) };
  }).filter(r => r.lines.length);

  const total = grandTotal();
  const body = rooms.length ? rooms.map(r => `
    <div class="sumsec">
      <div class="sumsec__head"><span>${esc(r.label)}</span><span>${money(r.subtotal)}</span></div>
      ${r.lines.map(l => `<div class="sumrow"><span>${esc(l.name)} <span style="color:var(--ink-faint)">× ${esc(l.qty)} ${esc(l.unit)}</span></span><span>${money(l.total)}</span></div>`).join('')}
    </div>`).join('') : `<div class="empty"><p>Nothing selected yet. Check off repairs to build the estimate.</p></div>`;

  return `
  <header class="appbar">
    <div class="appbar__row">
      <button class="iconbtn" data-action="back-estimate" aria-label="Back to estimate">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <div class="appbar__brand">Summary</div>
      <button class="iconbtn" data-action="export" aria-label="Export">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      </button>
    </div>
    <div class="appbar__totalwrap">
      <div class="appbar__label">Total Estimate</div>
      <div class="appbar__total tabnum">${money(total)}</div>
    </div>
  </header>
  <main class="content">
    <div class="field" style="margin-bottom:16px">
      <label>📝 Project notes — included in the export for the crew</label>
      <textarea class="projnote" rows="2" placeholder="Overall scope notes, access details, anything the construction team should know…"
                data-action="projnote-input">${esc(App.project.note || '')}</textarea>
    </div>
    ${body}
  </main>
  <div class="bottombar"><button class="btn btn--primary" data-action="export">⬇ Export ZIP</button></div>`;
}

/* ============================================================
 *                       DRAWER / SHEETS
 * ============================================================ */
function openDrawer() {
  renderDrawerList();
  $('#drawer').classList.add('show');
  $('#overlay').classList.add('show');
}
function closeDrawer() {
  $('#drawer').classList.remove('show');
  $('#overlay').classList.remove('show');
}
function renderDrawerList() {
  const list = Store.listProjects();
  const el = $('#drawer-list');
  if (!list.length) { el.innerHTML = `<p style="text-align:center;color:var(--ink-faint);padding:40px 16px">No saved projects</p>`; return; }
  el.innerHTML = list.map(p => {
    const active = App.project && p.id === App.project.id;
    return `<div class="projrow ${active ? 'active' : ''}">
      <button class="projrow__main" data-action="open-project" data-id="${p.id}">
        <div class="projrow__name">${esc(p.name)}</div>
        <div class="projrow__meta">Updated ${fmtDate(p.updatedAt)}</div>
      </button>
      <div class="projrow__acts">
        <button data-action="rename-project-id" data-id="${p.id}" aria-label="Rename">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        ${active ? '' : `<button class="del" data-action="delete-project" data-id="${p.id}" aria-label="Delete">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>`}
      </div>
    </div>`;
  }).join('');
}

function openSheet(html) {
  $('#sheet').innerHTML = html;
  $('#sheet-wrap').classList.add('show');
}
function closeSheet() {
  $('#sheet-wrap').classList.remove('show');
  $('#sheet').innerHTML = '';
}

// Generic prompt sheet -> resolves the typed value via callback.
let _sheetSubmit = null;
function promptSheet({ title, label, value = '', placeholder = '', hint = '', okText = 'Save', type = 'text' }, onOk) {
  _sheetSubmit = onOk;
  openSheet(`
    <div class="sheet__head"><h3>${esc(title)}</h3><button class="iconbtn" data-action="close-sheet">✕</button></div>
    <div class="sheet__body">
      <div class="field">
        <label>${esc(label)}</label>
        <input id="sheet-input" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${type === 'number' ? 'inputmode="decimal"' : ''}/>
        ${hint ? `<div class="hint">${esc(hint)}</div>` : ''}
      </div>
      <div class="sheet__actions">
        <button class="btn btn--ghost" data-action="close-sheet">Cancel</button>
        <button class="btn btn--primary" data-action="sheet-ok">${esc(okText)}</button>
      </div>
    </div>`);
  setTimeout(() => { const i = $('#sheet-input'); if (i) { i.focus(); i.select && i.select(); } }, 60);
}
function submitSheet() {
  const i = $('#sheet-input');
  const val = i ? i.value.trim() : '';
  const fn = _sheetSubmit; _sheetSubmit = null;
  closeSheet();
  if (fn) fn(val);
}

/* room type picker */
function openAddRoomSheet() {
  const opts = Object.entries(ROOM_TYPES).map(([key, t]) => {
    // Whole-house scopes (Interior/Systems/Exterior) are singletons —
    // disable them in the picker once one already exists.
    const taken = t.fixed && App.project.rooms.some(r => r.type === key);
    return `
    <button class="roomopt" ${taken ? 'disabled style="opacity:.4"' : `data-action="pick-room" data-type="${key}"`}>
      <div class="roomopt__icon">${t.icon}</div>
      <div class="roomopt__label">${esc(t.label)}</div>
      <div class="roomopt__sub">${taken ? 'already added' : t.groups.length + ' groups'}</div>
    </button>`;
  }).join('');
  openSheet(`
    <div class="sheet__head"><h3>Add a room</h3><button class="iconbtn" data-action="close-sheet">✕</button></div>
    <div class="sheet__body"><div class="roomgrid">${opts}</div></div>`);
}

/* price edit (per-project override + optional global) + delete item */
function openPriceSheet(itemId) {
  const def = itemDef(itemId);
  if (!def) return;
  const cur = resolvedPrice(itemId);
  const overridden = App.project.overrides[itemId] != null && App.project.overrides[itemId] !== '';
  openSheet(`
    <div class="sheet__head"><h3>${esc(def.name)}</h3><button class="iconbtn" data-action="close-sheet">✕</button></div>
    <div class="sheet__body">
      <div class="field">
        <label>Unit cost ($ / ${esc(def.unit)})</label>
        <input id="sheet-input" type="number" inputmode="decimal" value="${cur}" />
        <div class="hint">${overridden ? 'This item has a custom price for this project.' : 'Default price from the price list.'}</div>
      </div>
      <label style="display:flex;align-items:center;gap:10px;font-size:14px;margin-bottom:18px">
        <input id="price-global" type="checkbox" style="width:20px;height:20px"/>
        Also update the <b>standard price</b> everywhere (all projects)
      </label>
      <div class="sheet__actions">
        <button class="btn btn--primary" data-action="save-price" data-item="${itemId}">Save price</button>
      </div>
      <button class="minibtn danger" style="margin-top:18px;width:100%;justify-content:center;padding:12px" data-action="delete-item" data-item="${itemId}">🗑 Remove this item from the project</button>
    </div>`);
  setTimeout(() => { const i = $('#sheet-input'); if (i) i.focus(); }, 60);
}

/* add custom line item to a group */
function openAddItemSheet(groupKey) {
  openSheet(`
    <div class="sheet__head"><h3>Add line item</h3><button class="iconbtn" data-action="close-sheet">✕</button></div>
    <div class="sheet__body">
      <div class="field"><label>Item name</label><input id="ci-name" type="text" placeholder="e.g. Skylight replacement"/></div>
      <div class="field"><label>Unit cost ($)</label><input id="ci-cost" type="number" inputmode="decimal" placeholder="0.00"/></div>
      <div class="field"><label>Unit</label><input id="ci-unit" type="text" placeholder="ea., sqft, LF…" value="ea."/></div>
      <div class="sheet__actions">
        <button class="btn btn--ghost" data-action="close-sheet">Cancel</button>
        <button class="btn btn--primary" data-action="save-item" data-group="${groupKey}">Add item</button>
      </div>
    </div>`);
  setTimeout(() => { const i = $('#ci-name'); if (i) i.focus(); }, 60);
}

/* global price list / settings */
function openSettingsSheet() {
  openSheet(`
    <div class="sheet__head"><h3>Settings</h3><button class="iconbtn" data-action="close-sheet">✕</button></div>
    <div class="sheet__body">
      <h4 style="margin:0 0 6px">Standard price list</h4>
      <p class="hint" style="margin-bottom:14px">Prices apply to every project. Edit an individual item's standard price from its “edit price” link, or reset all to the original price list below.</p>
      <button class="btn btn--ghost" style="width:100%;margin-bottom:18px" data-action="reset-prices">↺ Reset all prices to defaults</button>
      <h4 style="margin:0 0 6px">About</h4>
      <p class="hint">Spark Homes Repair Estimator · works fully offline · data saved on this device. Install via your browser's “Add to Home Screen”.</p>
    </div>`);
}

/* ============================================================
 *                        INTERACTIONS
 * ============================================================ */
let _bound = false;
function bind() {
  if (_bound) return; // delegation: bind once, survives re-renders
  _bound = true;

  document.body.addEventListener('click', onClick);
  document.body.addEventListener('input', onInput);
  document.body.addEventListener('change', onChange);

  // camera result
  $('#camera-input').addEventListener('change', onCameraResult);

  // Flush any pending debounced save when the app is backgrounded or
  // closed — protects against losing the last few keystrokes.
  const flush = () => { if (_saveTimer) { clearTimeout(_saveTimer); persist(); } };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

  // Android install prompt — capture it so we can offer an in-app button.
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); App.deferredInstall = e; refreshInstallUI(); });
  window.addEventListener('appinstalled', () => { App.deferredInstall = null; refreshInstallUI(); toast('Installed — launch it from your home screen'); });
}

function refreshInstallUI() {
  const btn = document.getElementById('install-btn');
  if (btn) btn.classList.toggle('hidden', !App.deferredInstall);
}

function actionEl(e) {
  return e.target.closest('[data-action]');
}

async function onClick(e) {
  const el = actionEl(e);
  if (!el) return;
  const a = el.getAttribute('data-action');
  const d = el.dataset;

  switch (a) {
    case 'open-drawer': return openDrawer();
    case 'close-drawer': return closeDrawer();
    case 'close-sheet': return closeSheet();
    case 'open-settings': return openSettingsSheet();

    case 'load-demo': {
      const p = makeDemoProject();
      Store.saveProject(p);
      await loadProject(p);
      toast('Demo loaded — tap around, then Export');
      return;
    }
    case 'install-app': {
      if (App.deferredInstall) {
        App.deferredInstall.prompt();
        try { await App.deferredInstall.userChoice; } catch {}
        App.deferredInstall = null;
        refreshInstallUI();
      } else {
        toast('Use your browser menu → “Add to Home Screen”');
      }
      return;
    }

    case 'new-project': {
      closeDrawer();
      promptSheet({ title: 'New project', label: 'Property address / name', placeholder: 'e.g. 123 Main St', okText: 'Create' }, async (name) => {
        const p = newProject(name || 'New Estimate');
        Store.saveProject(p);
        await loadProject(p);
      });
      return;
    }
    case 'open-project': {
      const p = Store.getProject(d.id);
      if (p) { migrateProject(p); await loadProject(p); }
      closeDrawer();
      return;
    }
    case 'delete-project': {
      const p = Store.getProject(d.id);
      if (p && confirm(`Delete "${p.name}"? This cannot be undone.`)) {
        await Store.Photos.deleteForProject(d.id);
        Store.deleteProject(d.id);
        renderDrawerList();
      }
      return;
    }
    case 'rename-project':
    case 'rename-project-id': {
      const id = a === 'rename-project' ? App.project.id : d.id;
      const p = Store.getProject(id);
      promptSheet({ title: 'Rename project', label: 'Name', value: p ? p.name : '', okText: 'Save' }, (name) => {
        if (!name) return;
        const pr = Store.getProject(id); if (!pr) return;
        pr.name = name; Store.saveProject(pr);
        if (App.project && App.project.id === id) App.project.name = name;
        renderDrawerList(); render();
      });
      return;
    }

    case 'switch-room': App.activeRoomId = d.room; return render();
    case 'toggle-group': {
      const k = d.exp;
      if (App.expanded.has(k)) App.expanded.delete(k); else App.expanded.add(k);
      return render();
    }
    case 'add-room': return openAddRoomSheet();
    case 'pick-room': {
      const type = d.type;
      const room = { id: uid('room'), type, name: roomName(type, App.project.rooms) };
      App.project.rooms.push(room);
      App.activeRoomId = room.id;
      closeSheet(); persist(); return render();
    }
    case 'rename-room': {
      const room = App.project.rooms.find(r => r.id === d.room);
      promptSheet({ title: 'Rename room', label: 'Room name', value: room ? room.name : '', okText: 'Save' }, (name) => {
        if (name && room) { room.name = name; persist(); render(); }
      });
      return;
    }
    case 'remove-room': {
      const room = App.project.rooms.find(r => r.id === d.room);
      if (!room) return;
      if (!confirm(`Remove "${room.name}" and its selections?`)) return;
      // clean up entries, noAction, photos for this room
      Object.keys(App.project.entries).forEach(k => { if (k.startsWith(room.id + '::')) delete App.project.entries[k]; });
      Object.keys(App.project.noAction || {}).forEach(k => { if (k.startsWith(room.id + '::')) delete App.project.noAction[k]; });
      const toDelete = [];
      App.photoCache.forEach((v, id) => { if (v.record.roomId === room.id) toDelete.push(id); });
      for (const id of toDelete) { await Store.Photos.remove(id); URL.revokeObjectURL(App.photoCache.get(id).url); App.photoCache.delete(id); }
      App.project.rooms = App.project.rooms.filter(r => r.id !== room.id);
      if (App.activeRoomId === room.id) App.activeRoomId = App.project.rooms[0] ? App.project.rooms[0].id : null;
      persist(); return render();
    }

    case 'toggle-item': {
      const e = getEntry(d.room, d.item);
      const checked = !e.checked;
      setEntry(d.room, d.item, { checked, qty: checked && (e.qty === '' || e.qty == null) ? '1' : e.qty });
      if (checked) setNoAction(d.room, currentGroupOf(d.item), false);
      persist(); return render();
    }
    case 'toggle-noaction': {
      const on = !isNoAction(d.room, d.group);
      setNoAction(d.room, d.group, on);
      if (on) {
        // unchecking everything in the group keeps intent clear
        groupItems(d.group).forEach(it => { if (getEntry(d.room, it.id).checked) setEntry(d.room, it.id, { checked: false }); });
      }
      persist(); return render();
    }
    case 'qty-step': {
      const e = getEntry(d.room, d.item);
      const cur = parseFloat(e.qty) || 0;
      const next = Math.max(0, cur + Number(d.delta));
      setEntry(d.room, d.item, { qty: String(next), checked: true });
      persist(); return render();
    }
    case 'edit-price': return openPriceSheet(d.item);
    case 'save-price': {
      const val = $('#sheet-input').value.trim();
      const global = $('#price-global').checked;
      const num = parseFloat(val);
      if (!isNaN(num)) {
        App.project.overrides[d.item] = num;
        if (global) { App.globalPrices[d.item] = num; Store.setGlobalPrices(App.globalPrices); }
      }
      closeSheet(); persist(); toast(global ? 'Price updated everywhere' : 'Price updated for this project'); return render();
    }
    case 'delete-item': {
      if (!confirm('Remove this item from the project?')) return;
      const id = d.item;
      if (!App.project.deleted.includes(id)) App.project.deleted.push(id);
      // also clear any entries for it
      Object.keys(App.project.entries).forEach(k => { if (k.endsWith('::' + id)) delete App.project.entries[k]; });
      closeSheet(); persist(); return render();
    }
    case 'add-item': return openAddItemSheet(d.group);
    case 'save-item': {
      const name = $('#ci-name').value.trim();
      const cost = parseFloat($('#ci-cost').value);
      const unit = $('#ci-unit').value.trim() || 'ea.';
      if (!name || isNaN(cost)) { toast('Enter a name and cost'); return; }
      const id = uid('cust');
      App.project.custom.push({ id, name, cost, unit, group: d.group });
      App.globalPrices[id] = cost;
      closeSheet(); persist(); toast('Item added'); return render();
    }

    case 'add-photo': {
      App.pendingPhoto = { roomId: d.room, itemId: d.item };
      $('#camera-input').value = '';
      $('#camera-input').click();
      return;
    }
    case 'remove-photo': {
      const id = d.photo;
      await Store.Photos.remove(id);
      const c = App.photoCache.get(id);
      if (c) { URL.revokeObjectURL(c.url); App.photoCache.delete(id); }
      return render();
    }

    case 'open-deal': App.view = 'deal'; return render();
    case 'open-summary': App.view = 'summary'; return render();
    case 'back-estimate': App.view = 'estimate'; return render();
    case 'export': return doExport(el);

    case 'reset-prices': {
      if (confirm('Reset all standard prices to the original price list?')) {
        Store.resetGlobalPrices(); seedGlobalPricesIfNeeded(); closeSheet(); toast('Prices reset'); render();
      }
      return;
    }

    case 'sheet-ok': return submitSheet();
  }
}

function currentGroupOf(itemId) {
  // best-effort: find which visible group in the active room owns this item
  const room = App.project.rooms.find(r => r.id === App.activeRoomId);
  if (!room) return null;
  const type = ROOM_TYPES[room.type];
  for (const gk of type.groups) {
    if (groupItems(gk).some(it => it.id === itemId)) return gk;
  }
  return null;
}

function onInput(e) {
  const el = actionEl(e);
  if (!el) return;
  const a = el.getAttribute('data-action');
  if (a === 'qty-input') {
    const d = el.dataset;
    setEntry(d.room, d.item, { qty: el.value, checked: true });
    patchDerived();
    scheduleSave();
  } else if (a === 'deal-input') {
    App.project.deal[el.dataset.field] = el.value;
    scheduleSave();
    // patch the verdict live without re-rendering (keeps focus)
    patchDealLive();
  } else if (a === 'note-input') {
    const d = el.dataset;
    setEntry(d.room, d.item, { note: el.value });
    scheduleSave();           // no re-render → input keeps focus
  } else if (a === 'projnote-input') {
    App.project.note = el.value;
    scheduleSave();
  }
}

function onChange(e) {
  const el = actionEl(e);
  if (!el) return;
  // qty fields fully re-render on blur to normalize display
  if (el.getAttribute('data-action') === 'qty-input') render();
}

function patchDealLive() {
  // cheap recompute of the verdict block without clobbering inputs
  const wrap = document.querySelector('.deal__verdict');
  const lines = document.querySelector('.deal__lines');
  if (!wrap || !lines) return;
  const d = App.project.deal;
  const repair = grandTotal();
  const purchase = parseFloat(d.purchase) || 0;
  const arv = parseFloat(d.arv) || 0;
  const extra = parseFloat(d.extra) || 0;
  const totalCost = purchase + repair + extra;
  const profit = arv - totalCost;
  const roi = totalCost > 0 ? profit / totalCost : null;
  const hasInputs = purchase > 0 || arv > 0;
  let cls = 'caution', badge = 'Enter numbers';
  if (hasInputs && roi != null) {
    if (roi >= 0.15) { cls = 'go'; badge = '✅ Good Deal'; }
    else if (roi >= 0.05) { cls = 'caution'; badge = '⚠ Thin Margin'; }
    else { cls = 'nogo'; badge = '⛔ Pass'; }
  }
  wrap.className = 'deal__verdict ' + cls;
  wrap.querySelector('.deal__badge').textContent = badge;
  wrap.querySelector('.deal__profit').textContent = hasInputs ? money(profit) : '—';
  wrap.querySelector('.deal__roi').textContent = roi != null && hasInputs
    ? `Projected profit · ${(roi * 100).toFixed(1)}% return on cost`
    : 'Estimated profit after repairs';
  const ls = lines.querySelectorAll('.deal__line span:last-child');
  // order: purchase, repair, extra, totalCost, arv, profit
  if (ls.length >= 6) {
    ls[0].textContent = money(purchase);
    ls[1].textContent = money(repair);
    ls[2].textContent = money(extra);
    ls[3].textContent = money(totalCost);
    ls[4].textContent = money(arv);
    ls[5].textContent = hasInputs ? money(profit) : '—';
  }
}

/* ------------------------ photo capture ------------------------- */
async function onCameraResult(e) {
  const file = e.target.files && e.target.files[0];
  if (!file || !App.pendingPhoto) return;
  const { roomId, itemId } = App.pendingPhoto;
  App.pendingPhoto = null;

  try {
    const blob = await downscaleImage(file, 1280, 0.8);
    const def = itemDef(itemId);
    const id = uid('photo');
    const record = { id, projectId: App.project.id, roomId, itemId, blob, type: blob.type || 'image/jpeg', addedAt: nowISO(), serial: '' };
    await Store.Photos.add(record);
    App.photoCache.set(id, { record, url: URL.createObjectURL(blob) });
    render();

    // If this item tracks a serial number, attempt to read it off the
    // plate automatically (offline OCR), then let the agent confirm.
    if (def && def.serial) {
      promptSheet({
        title: 'Serial number', label: 'Serial / model on the plate',
        placeholder: 'scanning photo…', hint: 'Reading the serial from your photo — correct it if needed.', okText: 'Save',
      }, async (val) => {
        if (val) { record.serial = val; await Store.Photos.update(record); render(); }
      });
      scanSerialInto(blob, record);
    }
  } catch (err) {
    console.error('photo capture failed', err);
    toast('Could not save photo');
  }
}

// Run offline OCR on a freshly captured serial photo and drop the
// detected serial into the open prompt sheet. Best-effort: if the OCR
// engine can't load (e.g. never cached and currently offline), the agent
// just types it in manually — capture still succeeded.
async function scanSerialInto(blob, record) {
  const hintEl = () => document.querySelector('#sheet-wrap.show .hint');
  const inputEl = () => document.querySelector('#sheet-input');
  try {
    const setHint = t => { const h = hintEl(); if (h) h.textContent = t; };
    setHint('Loading reader…');
    const { serial } = await OCR.readSerial(blob, m => {
      if (m.status === 'recognizing text' && m.progress != null) setHint(`Reading serial… ${Math.round(m.progress * 100)}%`);
    });
    const inp = inputEl();
    if (serial && inp && !inp.value.trim()) {
      inp.value = serial;
      record.serial = serial; await Store.Photos.update(record);
      inp.focus(); inp.select && inp.select();
      setHint('Auto-read from photo — correct it if needed.');
    } else {
      setHint('Couldn’t auto-read — type the serial in.');
    }
  } catch (e) {
    console.warn('OCR unavailable', e);
    const h = hintEl(); if (h) h.textContent = 'Type the serial in (auto-read unavailable offline until first use).';
  }
}

// Downscale to keep storage lean and export fast; preserves aspect ratio.
function downscaleImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (Math.max(width, height) > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale); height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image load failed')); };
    img.src = url;
  });
}

/* ----------------------------- export --------------------------- */
async function doExport(btn) {
  if (grandTotal() <= 0) { toast('Add at least one repair first'); return; }
  // Button micro-interaction: spinner while building → checkmark on success.
  const orig = btn ? btn.innerHTML : null;
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Exporting…'; }
  try {
    const model = buildExportModel();
    const photos = [];
    App.photoCache.forEach(v => photos.push(v.record));
    const lookups = {
      roomLabelById: Object.fromEntries(App.project.rooms.map(r => [r.id, r.name])),
      itemNameById: {},
    };
    App.project.rooms.forEach(r => {
      ROOM_TYPES[r.type].groups.forEach(gk => groupItems(gk).forEach(it => { lookups.itemNameById[it.id] = it.name; }));
    });
    await Exporter.exportProject(model, photos, lookups);
    if (btn) btn.innerHTML = '✓ Exported';
    toast('Export ready — check your downloads');
  } catch (err) {
    console.error(err);
    toast('Export failed');
    if (btn) btn.innerHTML = orig;
  } finally {
    if (btn) setTimeout(() => { btn.disabled = false; btn.innerHTML = orig; }, 1600);
  }
}

function buildExportModel() {
  const rooms = App.project.rooms.map(room => {
    const type = ROOM_TYPES[room.type];
    const lines = [];
    type.groups.forEach(gk => groupItems(gk).forEach(it => {
      const e = getEntry(room.id, it.id);
      const t = lineTotal(room.id, it);
      if (e.checked && t > 0) lines.push({ name: it.name, qty: parseFloat(e.qty) || 0, unit: it.unit, cost: resolvedPrice(it.id), total: t, note: e.note || '' });
    }));
    return { label: room.name, lines, subtotal: roomTotal(room) };
  }).filter(r => r.lines.length);

  const repair = grandTotal();
  const d = App.project.deal || {};
  const purchase = parseFloat(d.purchase) || 0;
  const arv = parseFloat(d.arv) || 0;
  const extra = parseFloat(d.extra) || 0;
  const totalCost = purchase + repair + extra;
  const profit = arv - totalCost;
  const roi = totalCost > 0 ? profit / totalCost : null;

  return {
    projectName: App.project.name,
    projectNote: App.project.note || '',
    generatedAt: new Date().toLocaleString('en-US'),
    rooms,
    grandTotal: repair,
    deal: { purchase, arv, extra, profit, roi },
  };
}

/* ----------------------------- toast ---------------------------- */
let _toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* --------------------- backward-compat migration ---------------- */
// Fill in any fields a project saved by an earlier version might lack.
function migrateProject(p) {
  p.entries = p.entries || {};
  p.noAction = p.noAction || {};
  p.overrides = p.overrides || {};
  p.custom = p.custom || [];
  p.deleted = p.deleted || [];
  p.deal = p.deal || { purchase: '', arv: '', extra: '' };
  p.rooms = p.rooms || [];
  if (p.note == null) p.note = '';
}

/* ------------------------------ boot ---------------------------- */
async function boot() {
  seedGlobalPricesIfNeeded();
  bind();
  const activeId = Store.getActiveId();
  let project = activeId ? Store.getProject(activeId) : null;
  if (!project) {
    const list = Store.listProjects();
    project = list[0] || null;
  }
  if (project) { migrateProject(project); await loadProject(project); }
  else { App.project = null; render(); }   // true first run → welcome screen
  dismissSplash();
}

// Fade out the launch splash once the first screen is painted. Kept brief so
// it never slows a field agent; honors reduced-motion preferences.
function dismissSplash() {
  const s = document.getElementById('splash');
  if (!s) return;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(() => { s.classList.add('hide'); setTimeout(() => s.remove(), 500); }, reduce ? 0 : 650);
}

/* A realistic pre-filled project so a reviewer sees value in one tap. */
function makeDemoProject() {
  const p = newProject('123 Maple St — Demo');
  const room = type => p.rooms.find(r => r.type === type);
  const set = (type, itemId, qty, note) => { p.entries[`${room(type).id}::${itemId}`] = { checked: true, qty: String(qty), serial: '', note: note || '' }; };
  set('interior', 'ig-05', 1200); set('interior', 'ig-07', 1500); set('interior', 'ig-13', 4); set('interior', 'ig-27', 1);
  set('kitchen', 'kt-05', 1); set('kitchen', 'kt-06', 30); set('kitchen', 'kt-13', 1); set('kitchen', 'kt-16', 1);
  set('bathroom', 'ba-03', 1); set('bathroom', 'ba-10', 1, 'Tub is cracked — full tearout, not a reglaze.'); set('bathroom', 'ba-05', 60);
  set('systems', 'as-01', 1, 'Furnace ~2009, past its life — replace.'); set('systems', 'as-11', 1); set('systems', 'as-14', 3);
  set('exterior', 'ex-07', 1400); set('exterior', 'ex-14', 6); set('exterior', 'ex-11', 1, 'Large dead tree over the driveway — priority.');
  p.noAction[`${room('interior').id}::pest`] = true;
  p.note = 'Lockbox on side gate, code 4417. Vacant. Crew can start once we close.';
  p.deal = { purchase: '110000', arv: '189000', extra: '14000' };
  return p;
}

document.addEventListener('DOMContentLoaded', boot);
