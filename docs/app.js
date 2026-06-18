/* ============================================================
 * app.js — SPA frontend (vanilla JS) สำหรับ 6 เมนูรถยนต์
 * เรียก GAS Web App ผ่าน API (api.js)
 * ============================================================ */

/* ---------- helpers ---------- */
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

function escapeHtml(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtDate(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}
function money(n) {
  const x = Number(n) || 0;
  return x.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function num(n) { return (Number(n) || 0).toLocaleString('th-TH'); }
function todayIso() { return new Date().toISOString().slice(0, 10); }

function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = 't ' + kind;
  t.textContent = msg;
  $('#toast').appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
function badge(text, kind) { return `<span class="badge ${kind}">${escapeHtml(text)}</span>`; }
function statusBadge(s) {
  const map = {
    'รอดำเนินการ': 'gray', 'กำลังซ่อม': 'yellow', 'เสร็จสิ้น': 'green', 'ยกเลิก': 'red',
    'ใช้งาน': 'blue', 'ใช้งานปกติ': 'green'
  };
  return badge(s || '-', map[s] || 'gray');
}

/* ---------- modal ---------- */
function openModal(title, bodyHtml, footHtml, opts = {}) {
  const m = $('#modal');
  m.className = 'modal' + (opts.wide ? ' wide' : '');
  m.innerHTML = `
    <div class="mhead"><h3>${escapeHtml(title)}</h3><button class="x" data-close>&times;</button></div>
    <div class="mbody">${bodyHtml}</div>
    <div class="mfoot">${footHtml || ''}</div>`;
  $('#modal-bg').classList.add('on');
  m.querySelector('[data-close]').onclick = closeModal;
  return m;
}
function closeModal() { $('#modal-bg').classList.remove('on'); }
$('#modal-bg').addEventListener('click', e => { if (e.target.id === 'modal-bg') closeModal(); });

/* form field builders */
function field(label, inputHtml, full) {
  return `<div class="field ${full ? 'full' : ''}"><label>${label}</label>${inputHtml}</div>`;
}
function inp(id, val, attrs = '') { return `<input id="${id}" value="${escapeHtml(val ?? '')}" ${attrs}>`; }
function dateInp(id, val, attrs = '') { return `<input id="${id}" type="date" value="${val || ''}" ${attrs}>`; }
function numInp(id, val, attrs = '') { return `<input id="${id}" type="number" step="any" value="${val ?? ''}" ${attrs}>`; }
function val(id, root = document) { const e = root.querySelector('#' + id); return e ? e.value.trim() : ''; }
function numVal(id, root = document) { const v = val(id, root); return v === '' ? null : Number(v); }

/* ---------- vehicle lookup cache ---------- */
let _vehCache = null;
async function loadVehicles(force) {
  if (_vehCache && !force) return _vehCache;
  _vehCache = await API.callOrThrow('vehicle.lookup', {});
  return _vehCache;
}
function vehicleSelect(id, selected, opts = '') {
  const items = (_vehCache || []).map(v =>
    `<option value="${v.VehicleID}" ${Number(selected) === v.VehicleID ? 'selected' : ''}>`
    + `${escapeHtml(v.LicensePlate)} ${escapeHtml(v.Brand)} ${escapeHtml(v.Model)}</option>`).join('');
  return `<select id="${id}" ${opts}><option value="">— เลือกรถ —</option>${items}</select>`;
}

/* ============================================================
 * MENUS
 * ============================================================ */
const MENUS = [
  { key: 'pk_vehicle_registry', label: '🚙 ทะเบียนประวัติรถยนต์', render: screenVehicle },
  { key: 'pk_vehicle_plan',     label: '🔧 แผนบำรุงรักษา',       render: screenPlan },
  { key: 'pk_vehicle_repair',   label: '🛠️ แจ้งซ่อมรถยนต์',      render: screenRepair },
  { key: 'pk_vehicle_log',      label: '📋 บันทึกการซ่อม/บำรุง',  render: screenLog },
  { key: 'pk_vehicle_history',  label: '📚 ประวัติการซ่อม',       render: screenHistory },
  { key: 'pk_vehicle_mileage',  label: '🔢 บันทึกเลขไมล์',        render: screenMileage }
];
function canSee(key) {
  const u = API.getUser();
  return u && (u.isAdmin || (u.allowedMenus || []).includes(key));
}

/* ============================================================
 * BOOT
 * ============================================================ */
window.addEventListener('DOMContentLoaded', () => {
  $('#loginForm').addEventListener('submit', onLogin);
  $('#logoutBtn').addEventListener('click', async () => { await API.logout(); location.reload(); });
  const u = API.getUser();
  if (u && API.getToken()) enterApp(u);
});

async function onLogin(e) {
  e.preventDefault();
  $('#loginErr').textContent = '';
  try {
    const u = await API.login(val('empId'), val('password'));
    enterApp(u);
  } catch (err) { $('#loginErr').textContent = err.message; }
}

function enterApp(user) {
  $('#login').style.display = 'none';
  $('#shell').classList.add('on');
  $('#whoami').textContent = user.empName + (user.isAdmin ? ' (แอดมิน)' : '');
  // build nav
  const visible = MENUS.filter(m => canSee(m.key));
  $('#nav').innerHTML = visible.map(m =>
    `<a href="#" data-key="${m.key}">${m.label}</a>`).join('') ||
    '<div style="padding:12px 18px;color:#93a5c4">ไม่มีสิทธิ์เข้าถึงเมนูใด</div>';
  $$('#nav a').forEach(a => a.onclick = e => { e.preventDefault(); setScreen(a.dataset.key); });
  if (visible.length) setScreen(visible[0].key);
}

let _activeKey = null;
function setScreen(key) {
  _activeKey = key;
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.key === key));
  const menu = MENUS.find(m => m.key === key);
  $('#pageTitle').textContent = menu.label.replace(/^[^\s]+\s/, '');
  const main = $('#main');
  main.innerHTML = '<div class="empty">กำลังโหลด…</div>';
  menu.render(main).catch(err => { main.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`; });
}

/* ============================================================
 * เมนู 1 — ทะเบียนรถยนต์
 * ============================================================ */
async function screenVehicle(main) {
  const rows = await API.callOrThrow('vehicle.list', { search: '', vehicleType: '' });
  const types = [...new Set(rows.map(r => r.VehicleType).filter(Boolean))];
  main.innerHTML = `
    <div class="cards">
      <div class="card"><div class="label">จำนวนรถทั้งหมด</div><div class="val">${rows.length}</div></div>
      <div class="card"><div class="label">ใช้งานปกติ</div><div class="val">${rows.filter(r => r.VehicleStatus !== 'ยกเลิก').length}</div></div>
      <div class="card"><div class="label">ยกเลิกใช้งาน</div><div class="val">${rows.filter(r => r.VehicleStatus === 'ยกเลิก').length}</div></div>
    </div>
    <div class="filters">
      <div class="f"><label>ค้นหา</label><input id="vSearch" placeholder="ทะเบียน/ยี่ห้อ/ผู้รับผิดชอบ"></div>
      <div class="f"><label>ประเภท</label><select id="vType"><option value="">ทั้งหมด</option>${types.map(t => `<option>${escapeHtml(t)}</option>`).join('')}</select></div>
      <button class="btn ghost" id="vFilter">กรอง</button>
      <div style="flex:1"></div>
      <button class="btn" id="vAdd">+ เพิ่มรถ</button>
    </div>
    <div class="panel"><div class="tbl-wrap"><table id="vTbl"></table></div></div>`;

  const draw = list => {
    $('#vTbl').innerHTML = `
      <thead><tr>
        <th>#</th><th>ทะเบียน</th><th>ประเภท</th><th>ยี่ห้อ/รุ่น</th><th>อายุ(ปี)</th>
        <th class="right">เลขไมล์</th><th>ภาษีหมด</th><th>พ.ร.บ.หมด</th><th>ประกันหมด</th>
        <th>ตรวจถัดไป</th><th>สถานะ</th><th></th>
      </tr></thead>
      <tbody>${list.map((r, i) => `
        <tr>
          <td>${i + 1}</td>
          <td><b>${escapeHtml(r.LicensePlate)}</b><br><span style="color:#6b7280">${escapeHtml(r.VehicleCode)}</span></td>
          <td>${escapeHtml(r.VehicleType)}</td>
          <td>${escapeHtml(r.Brand)} ${escapeHtml(r.Model)}</td>
          <td>${r.vehicleAgeYears ?? '-'}</td>
          <td class="right">${num(r.CurrentMileage)}</td>
          <td>${fmtDate(r.TaxExpiryDate)}</td>
          <td>${fmtDate(r.ActEndDate)}</td>
          <td>${fmtDate(r.InsuranceEndDate)}</td>
          <td>${fmtDate(r.NextInspectDate)}</td>
          <td>${statusBadge(r.VehicleStatus)}</td>
          <td>
            <button class="btn sm ghost" data-edit="${r.VehicleID}">แก้ไข</button>
            <button class="btn sm danger" data-del="${r.VehicleID}">ลบ</button>
          </td>
        </tr>`).join('') || `<tr><td colspan="12" class="empty">ไม่มีข้อมูล</td></tr>`}
      </tbody>`;
    $$('#vTbl [data-edit]').forEach(b => b.onclick = () => vehicleForm(b.dataset.edit, refresh));
    $$('#vTbl [data-del]').forEach(b => b.onclick = () => delVehicle(b.dataset.del, refresh));
  };
  const refresh = async () => {
    const list = await API.callOrThrow('vehicle.list', { search: val('vSearch'), vehicleType: val('vType') });
    draw(list);
  };
  draw(rows);
  $('#vFilter').onclick = refresh;
  $('#vSearch').addEventListener('keydown', e => { if (e.key === 'Enter') refresh(); });
  $('#vAdd').onclick = () => vehicleForm(0, refresh);
}

async function delVehicle(id, refresh) {
  if (!confirm('ยืนยันลบรถคันนี้? (ข้อมูลจะถูกซ่อน ไม่ลบถาวร)')) return;
  await API.callOrThrow('vehicle.delete', { id });
  toast('ลบแล้ว', 'ok'); await loadVehicles(true); refresh();
}

async function vehicleForm(id, refresh) {
  let d = { VehicleID: 0, VehicleStatus: 'ใช้งานปกติ' };
  if (Number(id)) { const r = await API.callOrThrow('vehicle.get', { id }); d = r.data; }
  const body = `
    <div class="formgrid">
      ${field('ทะเบียนรถ *', inp('LicensePlate', d.LicensePlate))}
      ${field('รหัสรถ', inp('VehicleCode', d.VehicleCode))}
      ${field('ประเภท', inp('VehicleType', d.VehicleType))}
      ${field('ยี่ห้อ', inp('Brand', d.Brand))}
      ${field('รุ่น', inp('Model', d.Model))}
      ${field('สี', inp('Color', d.Color))}
      ${field('ปีที่ผลิต', numInp('ManufactureYear', d.ManufactureYear))}
      ${field('เชื้อเพลิง', inp('FuelType', d.FuelType))}
      ${field('เลขเครื่องยนต์', inp('EngineNo', d.EngineNo))}
      ${field('เลขตัวถัง', inp('ChassisNo', d.ChassisNo))}
      ${field('วันจดทะเบียน', dateInp('RegistrationDate', d.RegistrationDate))}
      ${field('สถานะรถ', `<select id="VehicleStatus"><option ${d.VehicleStatus !== 'ยกเลิก' ? 'selected' : ''}>ใช้งานปกติ</option><option ${d.VehicleStatus === 'ยกเลิก' ? 'selected' : ''}>ยกเลิก</option></select>`)}
      ${field('แผนก', inp('Department', d.Department))}
      ${field('ผู้รับผิดชอบ', inp('ResponsibleName', d.ResponsibleName))}

      <div class="section full"><h4>ทะเบียน / พ.ร.บ. / ประกัน</h4></div>
      ${field('วันต่อทะเบียนล่าสุด', dateInp('TaxRenewDate', d.TaxRenewDate, 'oninput="recalcAuto()"'))}
      ${field('<span class="auto">ภาษีหมดอายุ (AUTO)</span>', dateInp('TaxExpiryDate', d.TaxExpiryDate, 'readonly'))}
      ${field('วันต่อ พ.ร.บ. ล่าสุด', dateInp('ActRenewDate', d.ActRenewDate, 'oninput="recalcAuto()"'))}
      ${field('<span class="auto">พ.ร.บ. หมดอายุ (AUTO)</span>', dateInp('ActEndDate', d.ActEndDate, 'readonly'))}
      ${field('ประเภทประกัน', inp('InsuranceType', d.InsuranceType))}
      ${field('บริษัทประกัน', inp('InsuranceCompany', d.InsuranceCompany))}
      ${field('วันต่อประกันล่าสุด', dateInp('InsuranceRenewDate', d.InsuranceRenewDate, 'oninput="recalcAuto()"'))}
      ${field('<span class="auto">ประกันหมดอายุ (AUTO)</span>', dateInp('InsuranceEndDate', d.InsuranceEndDate, 'readonly'))}

      <div class="section full"><h4>ตรวจสภาพ</h4></div>
      ${field('วันตรวจสภาพล่าสุด', dateInp('LastInspectDate', d.LastInspectDate, 'oninput="recalcAuto()"'))}
      ${field('ความถี่ตรวจ (เดือน)', numInp('InspectFreqMonths', d.InspectFreqMonths, 'oninput="recalcAuto()"'))}
      ${field('<span class="auto">ตรวจครั้งถัดไป (AUTO)</span>', dateInp('NextInspectDate', d.NextInspectDate, 'readonly'))}

      <div class="section full"><h4>เปลี่ยนน้ำมันเครื่อง</h4></div>
      ${field('วันเปลี่ยนล่าสุด', dateInp('LastOilChangeDate', d.LastOilChangeDate))}
      ${field('เลขไมล์ที่เปลี่ยน', numInp('LastOilChangeMileage', d.LastOilChangeMileage, 'oninput="recalcAuto()"'))}
      ${field('ความถี่ (กม.)', numInp('OilChangeFreqKm', d.OilChangeFreqKm, 'oninput="recalcAuto()"'))}
      ${field('<span class="auto">เปลี่ยนครั้งถัดไป กม. (AUTO)</span>', numInp('NextOilChangeMileage', d.NextOilChangeMileage, 'readonly'))}

      ${Number(id) ? '' : field('เลขไมล์ปัจจุบัน (ตั้งต้น)', numInp('CurrentMileage', d.CurrentMileage), true)}
      ${field('หมายเหตุ', `<textarea id="Remark" rows="2">${escapeHtml(d.Remark || '')}</textarea>`, true)}
    </div>`;
  openModal(Number(id) ? 'แก้ไขข้อมูลรถ' : 'เพิ่มรถใหม่', body,
    `<button class="btn ghost" data-close>ยกเลิก</button><button class="btn" id="vSave">บันทึก</button>`, { wide: true });

  $('#vSave').onclick = async () => {
    const p = {
      VehicleID: d.VehicleID || 0,
      LicensePlate: val('LicensePlate'), VehicleCode: val('VehicleCode'), VehicleType: val('VehicleType'),
      Brand: val('Brand'), Model: val('Model'), Color: val('Color'),
      ManufactureYear: numVal('ManufactureYear'), FuelType: val('FuelType'),
      EngineNo: val('EngineNo'), ChassisNo: val('ChassisNo'), RegistrationDate: val('RegistrationDate'),
      VehicleStatus: val('VehicleStatus'), Department: val('Department'), ResponsibleName: val('ResponsibleName'),
      TaxRenewDate: val('TaxRenewDate'), ActRenewDate: val('ActRenewDate'),
      InsuranceType: val('InsuranceType'), InsuranceCompany: val('InsuranceCompany'), InsuranceRenewDate: val('InsuranceRenewDate'),
      LastInspectDate: val('LastInspectDate'), InspectFreqMonths: numVal('InspectFreqMonths'),
      LastOilChangeDate: val('LastOilChangeDate'), LastOilChangeMileage: numVal('LastOilChangeMileage'),
      OilChangeFreqKm: numVal('OilChangeFreqKm'),
      CurrentMileage: Number(id) ? undefined : numVal('CurrentMileage'),
      Remark: val('Remark')
    };
    if (!p.LicensePlate) return toast('กรุณากรอกทะเบียนรถ', 'err');
    try {
      await API.callOrThrow('vehicle.save', p);
      toast('บันทึกแล้ว', 'ok'); closeModal(); await loadVehicles(true); refresh();
    } catch (e) { toast(e.message, 'err'); }
  };
}
// preview AUTO fields ฝั่ง client (server เป็นตัวตัดสินจริง)
window.recalcAuto = function () {
  const addYears = (s, y) => { if (!s) return ''; const d = new Date(s); d.setFullYear(d.getFullYear() + y); return d.toISOString().slice(0, 10); };
  const addMonths = (s, m) => { if (!s || !m) return ''; const d = new Date(s); d.setMonth(d.getMonth() + Number(m)); return d.toISOString().slice(0, 10); };
  const set = (id, v) => { const e = $('#' + id); if (e) e.value = v || ''; };
  set('TaxExpiryDate', addYears(val('TaxRenewDate'), 1));
  set('ActEndDate', addYears(val('ActRenewDate'), 1));
  set('InsuranceEndDate', addYears(val('InsuranceRenewDate'), 1));
  const f = numVal('InspectFreqMonths');
  set('NextInspectDate', (val('LastInspectDate') && f) ? addMonths(val('LastInspectDate'), f) : '');
  const lm = numVal('LastOilChangeMileage'), fk = numVal('OilChangeFreqKm');
  set('NextOilChangeMileage', (lm !== null && fk) ? (lm + fk) : '');
};

/* ============================================================
 * เมนู 2 — แผนบำรุงรักษา + reminder
 * ============================================================ */
async function screenPlan(main) {
  await loadVehicles();
  main.innerHTML = `
    <div class="panel" style="margin-bottom:16px">
      <div class="head"><h3>⏰ ครบกำหนดเร็วๆนี้</h3>
        <div><label style="font-size:12px;color:#6b7280">ภายใน</label>
          <select id="dueDays"><option>15</option><option selected>30</option><option>60</option><option>90</option></select> วัน</div>
      </div>
      <div class="tbl-wrap"><table id="dueTbl"></table></div>
    </div>
    <div class="filters">
      <div class="f"><label>รถ</label>${vehicleSelect('plVeh', '')}</div>
      <div class="f"><label>สถานะ</label><select id="plStatus"><option value="">ทั้งหมด</option><option>ใช้งาน</option><option>เสร็จสิ้น</option><option>ยกเลิก</option></select></div>
      <button class="btn ghost" id="plFilter">กรอง</button>
      <div style="flex:1"></div>
      <button class="btn" id="plAdd">+ เพิ่มแผน</button>
    </div>
    <div class="panel"><div class="head"><h3>แผนทั้งหมด</h3></div><div class="tbl-wrap"><table id="plTbl"></table></div></div>`;

  const renderItems = (list, tblId, isDue) => {
    $('#' + tblId).innerHTML = `
      <thead><tr><th>ประเภท</th><th>งาน</th><th>ทะเบียน</th><th>กำหนดวันที่</th><th class="right">กำหนด กม.</th><th>คงเหลือ</th><th></th></tr></thead>
      <tbody>${list.map(it => {
        const overdue = it.daysRemaining !== null && it.daysRemaining < 0;
        const remain = it.daysRemaining !== null
          ? `${overdue ? badge('เลย ' + Math.abs(it.daysRemaining) + ' วัน', 'red') : (it.daysRemaining + ' วัน')}`
          : (it.remainingKm !== null ? `${it.remainingKm < 0 ? badge('เลย ' + num(Math.abs(it.remainingKm)) + ' กม.', 'red') : num(it.remainingKm) + ' กม.'}` : '-');
        const kindLabel = { plan: 'แผน PM', registry: 'ทะเบียน', oilchange: 'น้ำมัน' }[it.kind] || it.kind;
        return `<tr>
          <td>${badge(kindLabel, it.kind === 'registry' ? 'blue' : it.kind === 'oilchange' ? 'yellow' : 'gray')}</td>
          <td>${escapeHtml(it.typeLabel)}</td>
          <td>${escapeHtml(it.licensePlate)}</td>
          <td>${fmtDate(it.dueDate)}</td>
          <td class="right">${it.dueMileage !== null ? num(it.dueMileage) : '-'}</td>
          <td>${remain}</td>
          <td><button class="btn sm" data-act='${escapeHtml(JSON.stringify(it))}'>ดำเนินการ</button>
              ${it.kind === 'plan' && !isDue ? `<button class="btn sm danger" data-delplan="${it.planId}">ลบ</button>` : ''}</td>
        </tr>`; }).join('') || `<tr><td colspan="7" class="empty">ไม่มีรายการ</td></tr>`}</tbody>`;
    $$('#' + tblId + ' [data-act]').forEach(b => b.onclick = () => planAction(JSON.parse(b.dataset.act), reloadAll));
    $$('#' + tblId + ' [data-delplan]').forEach(b => b.onclick = async () => {
      if (!confirm('ลบแผนนี้?')) return;
      await API.callOrThrow('plan.delete', { id: b.dataset.delplan }); toast('ลบแล้ว', 'ok'); reloadAll();
    });
  };
  const reloadDue = async () => renderItems(await API.callOrThrow('plan.dueSoon', { days: val('dueDays') }), 'dueTbl', true);
  const reloadList = async () => renderItems(await API.callOrThrow('plan.list', { vehicleId: val('plVeh'), status: val('plStatus') }), 'plTbl', false);
  const reloadAll = async () => { await loadVehicles(true); await reloadDue(); await reloadList(); };

  await reloadDue(); await reloadList();
  $('#dueDays').onchange = reloadDue;
  $('#plFilter').onclick = reloadList;
  $('#plAdd').onclick = () => planForm(0, reloadAll);
}

async function planForm(id, refresh) {
  await loadVehicles();
  let d = { PlanID: 0, Status: 'ใช้งาน' };
  if (Number(id)) { const r = await API.callOrThrow('plan.get', { id }); d = r.data; }
  const body = `<div class="formgrid">
    ${field('รถ *', vehicleSelect('plfVeh', d.VehicleID), true)}
    ${field('ชื่องาน *', inp('TaskName', d.TaskName))}
    ${field('ประเภทงาน', inp('TaskType', d.TaskType))}
    ${field('รอบ (เดือน)', numInp('IntervalMonths', d.IntervalMonths))}
    ${field('รอบ (กิโลเมตร)', numInp('IntervalMileage', d.IntervalMileage))}
    ${field('ทำล่าสุด (วันที่)', dateInp('LastDoneDate', d.LastDoneDate))}
    ${field('ทำล่าสุด (เลขไมล์)', numInp('LastDoneMileage', d.LastDoneMileage))}
    ${field('สถานะ', `<select id="plfStatus"><option ${d.Status === 'ใช้งาน' ? 'selected' : ''}>ใช้งาน</option><option ${d.Status === 'เสร็จสิ้น' ? 'selected' : ''}>เสร็จสิ้น</option><option ${d.Status === 'ยกเลิก' ? 'selected' : ''}>ยกเลิก</option></select>`)}
    ${field('หมายเหตุ', `<textarea id="plRemark" rows="2">${escapeHtml(d.Remark || '')}</textarea>`, true)}
    <div class="full" style="color:#6b7280;font-size:12px">กำหนดครั้งถัดไป (วันที่/กม.) ระบบคำนวณอัตโนมัติเมื่อบันทึก</div>
  </div>`;
  openModal(Number(id) ? 'แก้ไขแผน' : 'เพิ่มแผนบำรุงรักษา', body,
    `<button class="btn ghost" data-close>ยกเลิก</button><button class="btn" id="plSave">บันทึก</button>`);
  $('#plSave').onclick = async () => {
    const p = {
      PlanID: d.PlanID || 0, VehicleID: val('plfVeh'), TaskName: val('TaskName'), TaskType: val('TaskType'),
      IntervalMonths: numVal('IntervalMonths'), IntervalMileage: numVal('IntervalMileage'),
      LastDoneDate: val('LastDoneDate'), LastDoneMileage: numVal('LastDoneMileage'),
      Status: val('plfStatus'), Remark: val('plRemark')
    };
    try { await API.callOrThrow('plan.save', p); toast('บันทึกแล้ว', 'ok'); closeModal(); refresh(); }
    catch (e) { toast(e.message, 'err'); }
  };
}

function planAction(it, refresh) {
  let body, onOk;
  if (it.kind === 'registry') {
    body = `<p>ต่ออายุ <b>${escapeHtml(it.typeLabel)}</b> — รถ ${escapeHtml(it.licensePlate)}</p>
      ${field('วันที่ต่ออายุ', dateInp('rnDate', todayIso()), true)}`;
    onOk = () => API.callOrThrow('plan.renewRegistry', { vehicleId: it.vehicleId, type: it.typeLabel, newRenewDate: val('rnDate') });
  } else if (it.kind === 'oilchange') {
    body = `<p>บันทึกเปลี่ยนน้ำมัน — รถ ${escapeHtml(it.licensePlate)} (เลขไมล์ปัจจุบัน ${num(it.currentMileage)})</p>
      ${field('เลขไมล์ที่เปลี่ยน', numInp('ocM', it.currentMileage))}
      ${field('วันที่เปลี่ยน', dateInp('ocD', todayIso()))}`;
    onOk = () => API.callOrThrow('plan.renewOilChange', { vehicleId: it.vehicleId, changeMileage: numVal('ocM'), changeDate: val('ocD') });
  } else {
    body = `<p>ทำงาน <b>${escapeHtml(it.typeLabel)}</b> เสร็จ — รถ ${escapeHtml(it.licensePlate)}<br>
      <span style="color:#6b7280">ระบบจะหมุนแผนไปรอบถัดไปให้อัตโนมัติ</span></p>
      ${field('วันที่ทำเสร็จ', dateInp('cpDate', todayIso()), true)}`;
    onOk = () => API.callOrThrow('plan.completePlan', { planId: it.planId, doneDate: val('cpDate') });
  }
  openModal('ดำเนินการ', body, `<button class="btn ghost" data-close>ยกเลิก</button><button class="btn ok" id="actOk">ยืนยัน</button>`);
  $('#actOk').onclick = async () => {
    try { await onOk(); toast('บันทึกแล้ว', 'ok'); closeModal(); refresh(); }
    catch (e) { toast(e.message, 'err'); }
  };
}

/* ============================================================
 * เมนู 3 — แจ้งซ่อม
 * ============================================================ */
async function screenRepair(main) {
  await loadVehicles();
  main.innerHTML = `
    <div class="filters">
      <div class="f"><label>ค้นหา</label><input id="rqSearch" placeholder="เลขที่/อาการ/ทะเบียน"></div>
      <div class="f"><label>รถ</label>${vehicleSelect('rqVeh', '')}</div>
      <div class="f"><label>สถานะ</label><select id="rqStatus"><option value="">ทั้งหมด</option><option>รอดำเนินการ</option><option>กำลังซ่อม</option><option>เสร็จสิ้น</option></select></div>
      <button class="btn ghost" id="rqFilter">กรอง</button>
      <div style="flex:1"></div><button class="btn" id="rqAdd">+ แจ้งซ่อม</button>
    </div>
    <div class="panel"><div class="tbl-wrap"><table id="rqTbl"></table></div></div>`;
  const draw = list => {
    $('#rqTbl').innerHTML = `
      <thead><tr><th>เลขที่</th><th>วันที่แจ้ง</th><th>ทะเบียน</th><th>อาการ</th><th>ความรุนแรง</th><th>ผู้แจ้ง</th><th>สถานะ</th><th></th></tr></thead>
      <tbody>${list.map(r => `<tr>
        <td><b>${escapeHtml(r.RequestNo)}</b></td><td>${fmtDate(r.ReportDate)}</td>
        <td>${escapeHtml(r.LicensePlate)}</td><td>${escapeHtml((r.ProblemDescription || '').slice(0, 40))}</td>
        <td>${escapeHtml(r.Severity)}</td><td>${escapeHtml(r.ReportedByName)}</td>
        <td>${statusBadge(r.Status)}</td>
        <td><button class="btn sm ghost" data-edit="${r.RequestID}">แก้ไข</button>
            <button class="btn sm danger" data-del="${r.RequestID}">ลบ</button></td>
      </tr>`).join('') || `<tr><td colspan="8" class="empty">ไม่มีข้อมูล</td></tr>`}</tbody>`;
    $$('#rqTbl [data-edit]').forEach(b => b.onclick = () => repairForm(b.dataset.edit, refresh));
    $$('#rqTbl [data-del]').forEach(b => b.onclick = async () => {
      if (!confirm('ลบใบแจ้งซ่อมนี้?')) return;
      await API.callOrThrow('repair.delete', { id: b.dataset.del }); toast('ลบแล้ว', 'ok'); refresh();
    });
  };
  const refresh = async () => draw(await API.callOrThrow('repair.list',
    { search: val('rqSearch'), vehicleId: val('rqVeh'), status: val('rqStatus') }));
  await refresh();
  $('#rqFilter').onclick = refresh;
  $('#rqAdd').onclick = () => repairForm(0, refresh);
}

async function repairForm(id, refresh) {
  await loadVehicles();
  let d = { RequestID: 0 };
  if (Number(id)) { const r = await API.callOrThrow('repair.get', { id }); d = r.data; }
  const body = `<div class="formgrid">
    ${field('รถ *', vehicleSelect('rqfVeh', d.VehicleID), true)}
    ${field('ความรุนแรง', `<select id="Severity"><option value="">-</option>${['ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต'].map(s => `<option ${d.Severity === s ? 'selected' : ''}>${s}</option>`).join('')}</select>`)}
    ${field('เลขไมล์ปัจจุบัน', numInp('rqMileage', d.CurrentMileage))}
    ${field('ผู้แจ้ง (ชื่อ)', inp('ReportedByName', d.ReportedByName))}
    ${Number(id) ? field('สถานะ', `<select id="rqfStatus">${['รอดำเนินการ', 'กำลังซ่อม', 'เสร็จสิ้น', 'ยกเลิก'].map(s => `<option ${d.Status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>`) : ''}
    ${field('อาการ/ปัญหา *', `<textarea id="ProblemDescription" rows="3">${escapeHtml(d.ProblemDescription || '')}</textarea>`, true)}
    ${field('หมายเหตุ', `<textarea id="rqRemark" rows="2">${escapeHtml(d.Remark || '')}</textarea>`, true)}
  </div>`;
  openModal(Number(id) ? 'แก้ไขใบแจ้งซ่อม ' + d.RequestNo : 'แจ้งซ่อมรถยนต์', body,
    `<button class="btn ghost" data-close>ยกเลิก</button><button class="btn" id="rqSave">บันทึก</button>`);
  $('#rqSave').onclick = async () => {
    const p = {
      RequestID: d.RequestID || 0, VehicleID: val('rqfVeh'), Severity: val('Severity'),
      CurrentMileage: numVal('rqMileage'), ReportedByName: val('ReportedByName'),
      ProblemDescription: val('ProblemDescription'), Remark: val('rqRemark'),
      Status: Number(id) ? val('rqfStatus') : ''
    };
    if (!p.VehicleID) return toast('กรุณาเลือกรถ', 'err');
    if (!p.ProblemDescription) return toast('กรุณากรอกอาการ', 'err');
    try { await API.callOrThrow('repair.save', p); toast('บันทึกแล้ว', 'ok'); closeModal(); refresh(); }
    catch (e) { toast(e.message, 'err'); }
  };
}

/* ============================================================
 * เมนู 4 — บันทึกการซ่อม/บำรุง
 * ============================================================ */
async function screenLog(main) {
  await loadVehicles();
  main.innerHTML = `
    <div class="filters">
      <div class="f"><label>ค้นหา</label><input id="lgSearch" placeholder="เลขที่/งาน/ผู้ให้บริการ"></div>
      <div class="f"><label>รถ</label>${vehicleSelect('lgVeh', '')}</div>
      <div class="f"><label>สถานะ</label><select id="lgStatus"><option value="">ทั้งหมด</option><option>เสร็จสิ้น</option><option>กำลังดำเนินการ</option><option>ยกเลิก</option></select></div>
      <button class="btn ghost" id="lgFilter">กรอง</button>
      <div style="flex:1"></div><button class="btn" id="lgAdd">+ บันทึกงาน</button>
    </div>
    <div class="panel"><div class="tbl-wrap"><table id="lgTbl"></table></div></div>`;
  const draw = list => {
    $('#lgTbl').innerHTML = `
      <thead><tr><th>เลขที่</th><th>วันที่</th><th>ทะเบียน</th><th>ประเภท</th><th>งาน</th>
        <th class="right">ค่าแรง</th><th class="right">ค่าอะไหล่</th><th class="right">รวม</th><th>สถานะ</th><th></th></tr></thead>
      <tbody>${list.map(r => `<tr>
        <td><b>${escapeHtml(r.LogNo)}</b></td><td>${fmtDate(r.ServiceDate)}</td>
        <td>${escapeHtml(r.LicensePlate)}</td><td>${escapeHtml(r.MaintenanceType)}</td>
        <td>${escapeHtml((r.WorkDescription || '').slice(0, 30))}</td>
        <td class="right">${money(r.LaborCost)}</td><td class="right">${money(r.PartsCost)}</td>
        <td class="right"><b>${money(r.TotalCost)}</b></td><td>${statusBadge(r.Status)}</td>
        <td><button class="btn sm ghost" data-edit="${r.LogID}">แก้ไข</button>
            <button class="btn sm danger" data-del="${r.LogID}">ลบ</button></td>
      </tr>`).join('') || `<tr><td colspan="10" class="empty">ไม่มีข้อมูล</td></tr>`}</tbody>`;
    $$('#lgTbl [data-edit]').forEach(b => b.onclick = () => logForm(b.dataset.edit, refresh));
    $$('#lgTbl [data-del]').forEach(b => b.onclick = async () => {
      if (!confirm('ลบใบงานนี้?')) return;
      await API.callOrThrow('log.delete', { id: b.dataset.del }); toast('ลบแล้ว', 'ok'); refresh();
    });
  };
  const refresh = async () => draw(await API.callOrThrow('log.list',
    { search: val('lgSearch'), vehicleId: val('lgVeh'), status: val('lgStatus') }));
  await refresh();
  $('#lgFilter').onclick = refresh;
  $('#lgAdd').onclick = () => logForm(0, refresh);
}

async function logForm(id, refresh) {
  await loadVehicles();
  let d = { LogID: 0, MaintenanceType: 'ซ่อม', Status: 'เสร็จสิ้น' }, items = [];
  if (Number(id)) { const r = await API.callOrThrow('log.get', { id }); d = r.data; items = r.items || []; }
  const itemRow = (it = {}) => `<tr>
      <td><input class="liName" value="${escapeHtml(it.ItemName || '')}" placeholder="ชื่ออะไหล่"></td>
      <td><input class="liCode" value="${escapeHtml(it.ItemCode || '')}" style="width:80px"></td>
      <td><input class="liQty" type="number" step="any" value="${it.Quantity ?? 1}" style="width:70px" oninput="logRecalc()"></td>
      <td><input class="liUnit" value="${escapeHtml(it.UnitName || '')}" style="width:70px"></td>
      <td><input class="liPrice" type="number" step="any" value="${it.UnitPrice ?? ''}" style="width:90px" oninput="logRecalc()"></td>
      <td class="right liAmt">0.00</td>
      <td><button class="btn sm danger" onclick="this.closest('tr').remove();logRecalc()">x</button></td>
    </tr>`;
  const body = `<div class="formgrid">
    ${field('รถ *', vehicleSelect('lgfVeh', d.VehicleID))}
    ${field('ประเภท', `<select id="MaintenanceType">${['ซ่อม', 'บำรุงรักษา', 'เปลี่ยนน้ำมัน', 'ตรวจเช็ค'].map(s => `<option ${d.MaintenanceType === s ? 'selected' : ''}>${s}</option>`).join('')}</select>`)}
    ${field('วันที่ให้บริการ', dateInp('ServiceDate', d.ServiceDate || todayIso()))}
    ${field('วันที่เสร็จ', dateInp('CompletedDate', d.CompletedDate))}
    ${field('เลขไมล์', numInp('lgMileage', d.Mileage))}
    ${field('สถานะ', `<select id="lgfStatus">${['เสร็จสิ้น', 'กำลังดำเนินการ', 'ยกเลิก'].map(s => `<option ${d.Status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>`)}
    ${field('ผู้ให้บริการ/อู่', inp('VendorName', d.VendorName))}
    ${field('ผู้ปฏิบัติงาน', inp('PerformedByName', d.PerformedByName))}
    ${field('อ้างอิงใบแจ้งซ่อม ID', numInp('RequestID', d.RequestID))}
    ${field('อ้างอิงแผน ID', numInp('PlanID', d.PlanID))}
    ${field('รายละเอียดงาน', `<textarea id="WorkDescription" rows="2">${escapeHtml(d.WorkDescription || '')}</textarea>`, true)}
  </div>
  <div class="section"><h4>รายการอะไหล่/วัสดุ</h4>
    <div class="tbl-wrap"><table>
      <thead><tr><th>ชื่อ</th><th>รหัส</th><th>จำนวน</th><th>หน่วย</th><th>ราคา/หน่วย</th><th class="right">รวม</th><th></th></tr></thead>
      <tbody id="liBody">${items.map(itemRow).join('')}</tbody>
    </table></div>
    <button class="btn sm ghost" id="liAdd" style="margin-top:8px">+ เพิ่มรายการ</button>
  </div>
  <div class="section formgrid">
    ${field('ค่าแรง', numInp('LaborCost', d.LaborCost ?? 0, 'oninput="logRecalc()"'))}
    ${field('<span class="auto">ค่าอะไหล่ (AUTO)</span>', `<input id="PartsCostPv" readonly value="0.00">`)}
    ${field('<span class="auto">รวมทั้งสิ้น (AUTO)</span>', `<input id="TotalCostPv" readonly value="0.00">`)}
  </div>
  <div class="section" id="receiptSec"></div>`;
  openModal(Number(id) ? 'แก้ไขใบงาน ' + d.LogNo : 'บันทึกการซ่อม/บำรุง', body,
    `<button class="btn ghost" data-close>ยกเลิก</button><button class="btn" id="lgSave">บันทึก</button>`, { wide: true });

  const liBody = $('#liBody');
  $('#liAdd').onclick = () => { liBody.insertAdjacentHTML('beforeend', itemRow()); logRecalc(); };
  window.logRecalc = function () {
    let parts = 0;
    $$('#liBody tr').forEach(tr => {
      const q = Number(tr.querySelector('.liQty').value) || 0;
      const p = Number(tr.querySelector('.liPrice').value) || 0;
      const amt = Math.round(q * p * 100) / 100;
      tr.querySelector('.liAmt').textContent = money(amt);
      parts += amt;
    });
    parts = Math.round(parts * 100) / 100;
    const labor = Number(val('LaborCost')) || 0;
    $('#PartsCostPv').value = money(parts);
    $('#TotalCostPv').value = money(Math.round((labor + parts) * 100) / 100);
  };
  logRecalc();
  renderReceipts(d.LogID);

  $('#lgSave').onclick = async () => {
    const items = $$('#liBody tr').map(tr => ({
      ItemName: tr.querySelector('.liName').value.trim(),
      ItemCode: tr.querySelector('.liCode').value.trim(),
      Quantity: Number(tr.querySelector('.liQty').value) || 0,
      UnitName: tr.querySelector('.liUnit').value.trim(),
      UnitPrice: Number(tr.querySelector('.liPrice').value) || 0,
      Remark: ''
    }));
    const header = {
      LogID: d.LogID || 0, VehicleID: val('lgfVeh'), MaintenanceType: val('MaintenanceType'),
      ServiceDate: val('ServiceDate'), CompletedDate: val('CompletedDate'), Mileage: numVal('lgMileage'),
      Status: val('lgfStatus'), VendorName: val('VendorName'), PerformedByName: val('PerformedByName'),
      RequestID: numVal('RequestID'), PlanID: numVal('PlanID'),
      WorkDescription: val('WorkDescription'), LaborCost: Number(val('LaborCost')) || 0
    };
    if (!header.VehicleID) return toast('กรุณาเลือกรถ', 'err');
    try {
      const r = await API.callOrThrow('log.save', { header, items });
      toast('บันทึกแล้ว ' + (r.logNo || ''), 'ok');
      d.LogID = r.id;
      renderReceipts(r.id);           // เปิดส่วนแนบไฟล์หลังได้ LogID
      refresh();
    } catch (e) { toast(e.message, 'err'); }
  };
}

async function renderReceipts(logId) {
  const sec = $('#receiptSec');
  if (!sec) return;
  if (!Number(logId)) { sec.innerHTML = '<h4>ไฟล์แนบใบเสร็จ</h4><p style="color:#6b7280;font-size:13px">บันทึกใบงานก่อนจึงจะแนบไฟล์ได้</p>'; return; }
  const list = await API.callOrThrow('log.getReceipts', { logId });
  sec.innerHTML = `<h4>ไฟล์แนบใบเสร็จ</h4>
    <div id="rcList">${list.map(f => `<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
      <span>📎 ${escapeHtml(f.FileName)} (${num(Math.round(f.FileSize / 1024))} KB)</span>
      <button class="btn sm ghost" data-dl='${escapeHtml(JSON.stringify(f))}'>ดาวน์โหลด</button>
      <button class="btn sm danger" data-rcdel="${f.ReceiptID}">ลบ</button>
    </div>`).join('') || '<span style="color:#6b7280;font-size:13px">ยังไม่มีไฟล์</span>'}</div>
    <input type="file" id="rcFile" multiple style="margin-top:8px">
    <button class="btn sm" id="rcUpload">อัปโหลด</button>`;
  $('#rcUpload').onclick = async () => {
    const files = $('#rcFile').files;
    if (!files.length) return toast('เลือกไฟล์ก่อน', 'err');
    const payload = [];
    for (const f of files) payload.push({ fileName: f.name, contentType: f.type, dataBase64: await fileToB64(f) });
    try { await API.callOrThrow('log.uploadReceipt', { logId, files: payload }); toast('อัปโหลดแล้ว', 'ok'); renderReceipts(logId); }
    catch (e) { toast(e.message, 'err'); }
  };
  $$('#rcList [data-rcdel]').forEach(b => b.onclick = async () => {
    if (!confirm('ลบไฟล์นี้?')) return;
    await API.callOrThrow('log.deleteReceipt', { id: b.dataset.rcdel }); toast('ลบแล้ว', 'ok'); renderReceipts(logId);
  });
  $$('#rcList [data-dl]').forEach(b => b.onclick = () => downloadReceipt(JSON.parse(b.dataset.dl)));
}
function fileToB64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(',')[1]);
    r.onerror = rej; r.readAsDataURL(file);
  });
}
async function downloadReceipt(f) {
  try {
    const res = await fetch(PK_CONFIG.API_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'log.downloadReceipt', id: f.ReceiptID, token: API.getToken() })
    });
    const text = await res.text();
    if (text.indexOf('{"success"') === 0) { toast(JSON.parse(text).error || 'ดาวน์โหลดไม่สำเร็จ', 'err'); return; }
    const bin = atob(text); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: f.ContentType || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = f.FileName; a.click();
    URL.revokeObjectURL(url);
  } catch (e) { toast('ดาวน์โหลดไม่สำเร็จ', 'err'); }
}

/* ============================================================
 * เมนู 5 — ประวัติการซ่อม
 * ============================================================ */
async function screenHistory(main) {
  await loadVehicles();
  main.innerHTML = `
    <div class="filters">
      <div class="f"><label>รถ</label>${vehicleSelect('hsVeh', '')}</div>
      <div class="f"><label>ตั้งแต่</label>${dateInp('hsFrom', '')}</div>
      <div class="f"><label>ถึง</label>${dateInp('hsTo', '')}</div>
      <div class="f"><label>ประเภท</label><select id="hsType"><option value="">ทั้งหมด</option><option>ซ่อม</option><option>บำรุงรักษา</option><option>เปลี่ยนน้ำมัน</option><option>ตรวจเช็ค</option></select></div>
      <button class="btn ghost" id="hsFilter">กรอง</button>
    </div>
    <div class="panel" style="margin-bottom:16px"><div class="head"><h3>สรุปค่าใช้จ่ายต่อคัน</h3></div><div class="tbl-wrap"><table id="hsSum"></table></div></div>
    <div class="panel"><div class="head"><h3>รายการประวัติ</h3></div><div class="tbl-wrap"><table id="hsTbl"></table></div></div>`;
  const refresh = async () => {
    const params = { vehicleId: val('hsVeh'), dateFrom: val('hsFrom'), dateTo: val('hsTo'), maintenanceType: val('hsType') };
    const [list, sum] = await Promise.all([
      API.callOrThrow('history.list', params),
      API.callOrThrow('history.summary', { dateFrom: val('hsFrom'), dateTo: val('hsTo') })
    ]);
    $('#hsSum').innerHTML = `<thead><tr><th>ทะเบียน</th><th>ยี่ห้อ/รุ่น</th><th class="right">จำนวนครั้ง</th><th class="right">ค่าแรง</th><th class="right">ค่าอะไหล่</th><th class="right">รวม</th></tr></thead>
      <tbody>${sum.map(s => `<tr><td>${escapeHtml(s.licensePlate)}</td><td>${escapeHtml(s.brand)} ${escapeHtml(s.model)}</td>
        <td class="right">${s.count}</td><td class="right">${money(s.laborCost)}</td><td class="right">${money(s.partsCost)}</td><td class="right"><b>${money(s.totalCost)}</b></td></tr>`).join('') || `<tr><td colspan="6" class="empty">ไม่มีข้อมูล</td></tr>`}</tbody>`;
    $('#hsTbl').innerHTML = `<thead><tr><th>เลขที่</th><th>วันที่</th><th>ทะเบียน</th><th>ประเภท</th><th>งาน</th><th class="right">รวม</th><th>สถานะ</th><th></th></tr></thead>
      <tbody>${list.map(r => `<tr><td><b>${escapeHtml(r.LogNo)}</b></td><td>${fmtDate(r.ServiceDate)}</td><td>${escapeHtml(r.LicensePlate)}</td>
        <td>${escapeHtml(r.MaintenanceType)}</td><td>${escapeHtml((r.WorkDescription || '').slice(0, 30))}</td>
        <td class="right"><b>${money(r.TotalCost)}</b></td><td>${statusBadge(r.Status)}</td>
        <td><button class="btn sm ghost" data-detail="${r.LogID}">ดู</button></td></tr>`).join('') || `<tr><td colspan="8" class="empty">ไม่มีข้อมูล</td></tr>`}</tbody>`;
    $$('#hsTbl [data-detail]').forEach(b => b.onclick = () => historyDetail(b.dataset.detail));
  };
  await refresh();
  $('#hsFilter').onclick = refresh;
}
async function historyDetail(logId) {
  const r = await API.callOrThrow('history.detail', { logId });
  const d = r.data, items = r.items || [];
  const body = `<div class="formgrid">
    ${field('เลขที่', `<b>${escapeHtml(d.LogNo)}</b>`)}${field('ทะเบียน', escapeHtml(d.LicensePlate))}
    ${field('วันที่ให้บริการ', fmtDate(d.ServiceDate))}${field('ประเภท', escapeHtml(d.MaintenanceType))}
    ${field('ผู้ให้บริการ', escapeHtml(d.VendorName))}${field('เลขไมล์', num(d.Mileage))}
    ${field('รายละเอียด', escapeHtml(d.WorkDescription), true)}
  </div>
  <div class="section"><h4>รายการอะไหล่</h4><div class="tbl-wrap"><table>
    <thead><tr><th>ชื่อ</th><th>จำนวน</th><th>หน่วย</th><th class="right">ราคา</th><th class="right">รวม</th></tr></thead>
    <tbody>${items.map(it => `<tr><td>${escapeHtml(it.ItemName)}</td><td>${num(it.Quantity)}</td><td>${escapeHtml(it.UnitName)}</td>
      <td class="right">${money(it.UnitPrice)}</td><td class="right">${money(it.Amount)}</td></tr>`).join('') || `<tr><td colspan="5" class="empty">ไม่มีรายการ</td></tr>`}</tbody></table></div>
    <div class="formgrid" style="margin-top:12px">
      ${field('ค่าแรง', money(d.LaborCost))}${field('ค่าอะไหล่', money(d.PartsCost))}${field('รวมทั้งสิ้น', `<b>${money(d.TotalCost)}</b>`)}
    </div>
  </div>`;
  openModal('รายละเอียดใบงาน', body, `<button class="btn ghost" data-close>ปิด</button>`, { wide: true });
}

/* ============================================================
 * เมนู 6 — บันทึกเลขไมล์ (กริดรายเดือน)
 * ============================================================ */
async function screenMileage(main) {
  await loadVehicles();
  const now = new Date();
  main.innerHTML = `
    <div class="filters">
      <div class="f"><label>รถ *</label>${vehicleSelect('mlVeh', '')}</div>
      <div class="f"><label>ปี</label><input id="mlYear" type="number" value="${now.getFullYear()}" style="width:90px"></div>
      <div class="f"><label>เดือน</label><select id="mlMonth">${Array.from({ length: 12 }, (_, i) =>
        `<option value="${i + 1}" ${i === now.getMonth() ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></div>
      <button class="btn ghost" id="mlLoad">โหลด</button>
    </div>
    <div class="cards" id="mlCards"></div>
    <div class="panel"><div class="head"><h3>กรอกเลขไมล์รายวัน</h3><button class="btn" id="mlSave">บันทึกทั้งเดือน</button></div>
      <div style="padding:16px"><div class="mgrid" id="mlGrid"><div class="empty">เลือกรถแล้วกดโหลด</div></div></div>
    </div>`;

  const load = async () => {
    const vid = val('mlVeh');
    if (!vid) return toast('เลือกรถก่อน', 'err');
    const r = await API.callOrThrow('mileage.getMonth', { vehicleId: vid, year: val('mlYear'), month: val('mlMonth') });
    $('#mlCards').innerHTML = `
      <div class="card"><div class="label">รถ</div><div class="val" style="font-size:16px">${escapeHtml(r.vehicle.licensePlate)}</div></div>
      <div class="card"><div class="label">เลขไมล์ปัจจุบัน</div><div class="val">${num(r.vehicle.currentMileage)}</div></div>
      <div class="card"><div class="label">ระยะทางเดือนนี้ (กม.)</div><div class="val">${num(r.monthlyKm)}</div></div>`;
    const grid = $('#mlGrid'); grid.innerHTML = '';
    const dow = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
    for (let day = 1; day <= r.daysInMonth; day++) {
      const dt = new Date(Number(val('mlYear')), Number(val('mlMonth')) - 1, day);
      const we = dt.getDay() === 0 || dt.getDay() === 6;
      const v = r.days[day] ?? '';
      grid.insertAdjacentHTML('beforeend',
        `<div class="cell ${we ? 'weekend' : ''}"><div class="d">${day} ${dow[dt.getDay()]}</div>
         <input type="number" step="any" data-day="${day}" value="${v}"></div>`);
    }
  };
  $('#mlLoad').onclick = load;
  $('#mlSave').onclick = async () => {
    const vid = val('mlVeh');
    if (!vid) return toast('เลือกรถก่อน', 'err');
    const days = $$('#mlGrid input[data-day]').map(i => ({
      day: Number(i.dataset.day),
      mileage: i.value.trim() === '' ? null : Number(i.value)
    }));
    try {
      const r = await API.callOrThrow('mileage.saveMonth', { VehicleID: vid, Year: val('mlYear'), Month: val('mlMonth'), Days: days });
      toast('บันทึกแล้ว · เลขไมล์ปัจจุบัน ' + num(r.currentMileage) + (r.autoPlanCreated ? ' · สร้างแผนเปลี่ยนน้ำมันอัตโนมัติ' : ''), 'ok');
      await loadVehicles(true); load();
    } catch (e) { toast(e.message, 'err'); }
  };
}
