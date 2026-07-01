/**
 * functions/api.js — Cloudflare Pages Function : backend ของ Vehicle PM
 * พอร์ตจาก gas/*.gs : เปลี่ยนจาก Google Sheets -> D1 (SQL) และ Drive -> R2
 * เส้นทาง: POST /api  body JSON { action, token, ...params }  (same-origin, ไม่ต้องมี CORS)
 * bindings: env.DB (D1), env.RECEIPTS (R2)
 */

/* ======================= constants ======================= */
const SESSION_TTL_SEC = 6 * 60 * 60;
const ODO_MAX_JUMP = 50000;
const OIL_REMIND_KM = 1000;
const DUE_SOON_DAYS = 30;
const OIL_TASK_NAME = 'เปลี่ยนน้ำมันเครื่อง';
const STATUS_CANCEL = 'ยกเลิก';
const VEHICLE_STATUS_DEFAULT = 'ใช้งานปกติ';
const FILE_MODULE = 'vehicle_log';

const PK = {
  Vehicle: 'VehicleID', MaintenancePlan: 'PlanID', RepairRequest: 'RequestID',
  MaintenanceLog: 'LogID', MaintenanceLogDetail: 'DetailID', MileageLog: 'MileageID', Receipts: 'ReceiptID'
};
const SCHEMA = {
  Vehicle: ['VehicleID','VehicleCode','LicensePlate','VehicleType','Brand','Model','Color','ManufactureYear','EngineNo','ChassisNo','FuelType','CurrentMileage','RegistrationDate','Department','ResponsibleEmpId','ResponsibleName','Remark','InsuranceType','InsuranceCompany','InsuranceRenewDate','InsuranceEndDate','ActRenewDate','ActEndDate','TaxRenewDate','TaxExpiryDate','LastInspectDate','InspectFreqMonths','NextInspectDate','LastOilChangeDate','LastOilChangeMileage','OilChangeFreqKm','NextOilChangeMileage','VehicleStatus','IsActive','CreatedBy','CreatedDate','UpdatedBy','UpdatedDate'],
  MaintenancePlan: ['PlanID','VehicleID','TaskName','TaskType','IntervalMonths','IntervalMileage','LastDoneDate','LastDoneMileage','NextDueDate','NextDueMileage','Status','Remark','IsActive','CreatedBy','CreatedDate','UpdatedBy','UpdatedDate'],
  RepairRequest: ['RequestID','RequestNo','VehicleID','ReportDate','ReportedByEmpId','ReportedByName','ProblemDescription','Severity','CurrentMileage','Status','Remark','IsActive','CreatedBy','CreatedDate','UpdatedBy','UpdatedDate'],
  MaintenanceLog: ['LogID','LogNo','VehicleID','RequestID','PlanID','MaintenanceType','ServiceDate','CompletedDate','Mileage','WorkDescription','PerformedByEmpId','PerformedByName','VendorName','LaborCost','PartsCost','TotalCost','Status','Remark','IsActive','CreatedBy','CreatedDate','UpdatedBy','UpdatedDate'],
  MaintenanceLogDetail: ['DetailID','LogID','ItemName','ItemCode','Quantity','UnitName','UnitPrice','Amount','Remark','CreatedBy','CreatedDate'],
  MileageLog: ['MileageID','VehicleID','MileageDate','Mileage','RecordedByEmpId','RecordedByName','Remark','IsActive','CreatedBy','CreatedDate','UpdatedBy','UpdatedDate'],
  Receipts: ['ReceiptID','Module','RefID','StorageKey','FileName','ContentType','FileSize','IsActive','CreatedBy','CreatedDate','UpdatedBy','UpdatedDate']
};

/* ======================= entry / router ======================= */
export async function onRequest(context) {
  const { request, env } = context;
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  try {
    if (request.method === 'GET') return await handleGet(request, env);
    if (request.method === 'POST') return await handlePost(request, env);
    return json(fail('method not allowed'), 405);
  } catch (err) {
    console.error(err && err.stack || err);
    if (err && err._forbid) return json(fail(err.msg || 'ไม่มีสิทธิ์ดำเนินการ'));
    return json(fail('เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง'));
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json;charset=utf-8', 'Access-Control-Allow-Origin': '*' }
  });
}

async function handlePost(request, env) {
  let params = {};
  try { params = JSON.parse((await request.text()) || '{}'); }
  catch { return json(fail('คำขอไม่ถูกต้อง')); }
  const action = asStr(params.action);
  const sess = await getSession(env, params.token);
  try {
    if (action === 'login') return json(await doLogin(env, asStr(params.empId), asStr(params.password)));
    if (action === 'logout') return json(await doLogout(env, params.token));
    if (action === 'me') return json(sess ? ok({ user: sess }) : fail('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'));
    if (action === 'health') return json(ok({ status: 'ok', time: nowStr() }));
    if (!sess) return json(fail('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'));
    if (action === 'log.downloadReceipt') return await Log_downloadReceipt(env, params, sess);
    const fn = ROUTES[action];
    if (!fn) return json(fail('ไม่รู้จักคำสั่ง: ' + action));
    return json(await fn(env, params, sess));
  } catch (err) {
    if (err && err._forbid) return json(fail(err.msg || 'ไม่มีสิทธิ์ดำเนินการ'));
    console.error('action=' + action + ' ' + (err && err.stack || err));
    return json(fail('เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง'));
  }
}

async function handleGet(request, env) {
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams);
  const action = asStr(params.action);
  if (action === 'health') return json(ok({ status: 'ok', time: nowStr() }));
  const sess = await getSession(env, params.token);
  if (!sess) return json(fail('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'));
  if (action === 'log.downloadReceipt') return await Log_downloadReceipt(env, params, sess);
  return json(fail('ไม่รองรับคำสั่งนี้'));
}

/* ======================= util ======================= */
function asStr(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }
function asNum(v) { if (v === '' || v === null || v === undefined) return 0; const n = Number(v); return isNaN(n) ? 0 : n; }
function asNumN(v) { if (v === '' || v === null || v === undefined) return null; const n = Number(v); return isNaN(n) ? null : n; }
function asBool(v) { const s = String(v).trim().toLowerCase(); return s === 'true' || s === '1' || s === 'yes' || v === true; }
function asInt(v) { return Math.trunc(asNum(v)); }
function asIntN(v) { const n = asNumN(v); return n === null ? null : Math.trunc(n); }
function round2(n) { if (n === null || n === undefined || n === '') return 0; const x = Number(n); if (isNaN(x)) return 0; return Math.sign(x) * Math.round(Math.abs(x) * 100) / 100; }
function pad(n) { return ('0' + n).slice(-2); }
function capErr(label, value, max) { if (asStr(value).length > max) return label + ' ยาวเกิน ' + max + ' ตัวอักษร'; return null; }
function reqErr(label, value) { if (!asStr(value)) return 'กรุณากรอก' + label; return null; }

// ---- date (Asia/Bangkok = UTC+7) : เก็บ/คืนเป็น 'yyyy-MM-dd' string ----
function bkkNow() { return new Date(Date.now() + 7 * 3600 * 1000); }
function todayStr() { const d = bkkNow(); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
function nowStr() { const d = bkkNow(); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()); }
function bkkYyMM() { const d = bkkNow(); return String(d.getUTCFullYear()).slice(-2) + pad(d.getUTCMonth() + 1); }
function fmtIso(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
function asDateStr(v) {
  if (v === '' || v === null || v === undefined) return '';
  const s = String(v).trim(); if (!s) return '';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[1] + '-' + m[2] + '-' + m[3];
  const d = new Date(s); return isNaN(d.getTime()) ? '' : fmtIso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())));
}
function asDateTimeStr(v) { if (v === '' || v === null || v === undefined) return ''; return String(v).trim(); }
function parseYmd(s) { s = asDateStr(s); if (!s) return null; const p = s.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12, 0, 0)); }
function addYears(s, y) { const d = parseYmd(s); if (!d) return ''; d.setUTCFullYear(d.getUTCFullYear() + y); return fmtIso(d); }
function addMonths(s, m) { const d = parseYmd(s); if (!d) return ''; d.setUTCMonth(d.getUTCMonth() + m); return fmtIso(d); }
function addDays(s, n) { const d = parseYmd(s); if (!d) return ''; d.setUTCDate(d.getUTCDate() + n); return fmtIso(d); }
function daysFromToday(dateStr) { const d = parseYmd(dateStr); if (!d) return null; const t = parseYmd(todayStr()); return Math.round((d.getTime() - t.getTime()) / 86400000); }
function nextSaturday(fromStr) { const d = parseYmd(fromStr || todayStr()); const add = (6 - d.getUTCDay() + 7) % 7; d.setUTCDate(d.getUTCDate() + add); return fmtIso(d); }
function vehicleAgeYears(regStr) {
  const d = parseYmd(regStr); if (!d) return null; const t = parseYmd(todayStr());
  let y = t.getUTCFullYear() - d.getUTCFullYear();
  const before = (t.getUTCMonth() < d.getUTCMonth()) || (t.getUTCMonth() === d.getUTCMonth() && t.getUTCDate() < d.getUTCDate());
  if (before) y -= 1; return Math.max(0, y);
}

// ---- response ----
function ok(obj) { return Object.assign({ success: true }, obj || {}); }
function fail(msg) { return { success: false, error: msg }; }
function listJson(arr) { return arr; }

/* ======================= data layer (D1) ======================= */
function norm(v) { if (v === undefined || v === null) return null; if (v === true) return 1; if (v === false) return 0; return v; }

async function dbReadRaw(env, table) {
  const { results } = await env.DB.prepare('SELECT * FROM ' + table).all();
  return results || [];
}
async function dbReadActive(env, table) {
  const { results } = await env.DB.prepare('SELECT * FROM ' + table + ' WHERE IsActive=1').all();
  return results || [];
}
async function dbFindBy(env, table, col, val) {
  const { results } = await env.DB.prepare('SELECT * FROM ' + table + ' WHERE ' + col + '=? LIMIT 1').bind(val).all();
  return (results && results[0]) ? results[0] : null;
}
async function dbInsert(env, table, obj, empId) {
  const cols = SCHEMA[table], pk = PK[table];
  if (cols.includes('IsActive') && obj.IsActive === undefined) obj.IsActive = 1;
  if (cols.includes('CreatedBy')) obj.CreatedBy = empId || '';
  if (cols.includes('CreatedDate')) obj.CreatedDate = nowStr();
  const ins = cols.filter(c => c !== pk);
  const sql = 'INSERT INTO ' + table + ' (' + ins.join(',') + ') VALUES (' + ins.map(() => '?').join(',') + ')';
  const res = await env.DB.prepare(sql).bind(...ins.map(c => norm(obj[c]))).run();
  obj[pk] = res.meta.last_row_id;
  return obj;
}
async function dbUpdate(env, table, existing, patch, empId) {
  const cols = SCHEMA[table], pk = PK[table];
  const merged = {}; cols.forEach(c => merged[c] = existing[c]);
  Object.keys(patch).forEach(k => { if (cols.includes(k)) merged[k] = patch[k]; });
  if (cols.includes('UpdatedBy')) merged.UpdatedBy = empId || '';
  if (cols.includes('UpdatedDate')) merged.UpdatedDate = nowStr();
  const set = cols.filter(c => c !== pk);
  const sql = 'UPDATE ' + table + ' SET ' + set.map(c => c + '=?').join(',') + ' WHERE ' + pk + '=?';
  await env.DB.prepare(sql).bind(...set.map(c => norm(merged[c])), existing[pk]).run();
  return merged;
}
async function dbSoftDelete(env, table, existing, empId) { return dbUpdate(env, table, existing, { IsActive: 0 }, empId); }
async function dbDeleteRows(env, table, predicate) {
  const rows = (await dbReadRaw(env, table)).filter(predicate);
  for (const r of rows) await env.DB.prepare('DELETE FROM ' + table + ' WHERE ' + PK[table] + '=?').bind(r[PK[table]]).run();
  return rows.length;
}
async function genDocNo(env, table, col, prefix) {
  const pre = prefix + bkkYyMM() + '-';
  const rows = await dbReadRaw(env, table);
  let max = 0;
  for (const r of rows) { const v = asStr(r[col]); if (v.indexOf(pre) === 0) { const seq = parseInt(v.substring(pre.length), 10); if (!isNaN(seq) && seq > max) max = seq; } }
  return pre + ('00' + (max + 1)).slice(-3);
}

/* ======================= auth ======================= */
async function hashPassword(pw) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('pk_salt::' + pw));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function doLogin(env, empId, password) {
  const u = await dbFindBy(env, 'Users', 'EmpId', empId);
  if (!u || !asBool(u.IsActive)) return fail('ไม่พบผู้ใช้ หรือถูกระงับการใช้งาน');
  if (asStr(u.PasswordHash) !== await hashPassword(password)) return fail('รหัสผ่านไม่ถูกต้อง');
  const token = crypto.randomUUID().replace(/-/g, '');
  const sess = {
    empId: asStr(u.EmpId), empName: asStr(u.EmpName), isAdmin: asBool(u.IsAdmin),
    allowedMenus: asStr(u.AllowedMenus).split(',').map(s => s.trim()).filter(Boolean)
  };
  await env.DB.prepare('INSERT OR REPLACE INTO Sessions (token,empId,empName,isAdmin,allowedMenus,expiresAt) VALUES (?,?,?,?,?,?)')
    .bind(token, sess.empId, sess.empName, sess.isAdmin ? 1 : 0, sess.allowedMenus.join(','), Date.now() + SESSION_TTL_SEC * 1000).run();
  return ok({ token, user: sess });
}
async function getSession(env, token) {
  if (!token) return null;
  const { results } = await env.DB.prepare('SELECT * FROM Sessions WHERE token=?').bind(token).all();
  const s = results && results[0]; if (!s) return null;
  if (Number(s.expiresAt) < Date.now()) { await env.DB.prepare('DELETE FROM Sessions WHERE token=?').bind(token).run(); return null; }
  await env.DB.prepare('UPDATE Sessions SET expiresAt=? WHERE token=?').bind(Date.now() + SESSION_TTL_SEC * 1000, token).run();
  return { empId: asStr(s.empId), empName: asStr(s.empName), isAdmin: asBool(s.isAdmin), allowedMenus: asStr(s.allowedMenus).split(',').map(x => x.trim()).filter(Boolean) };
}
async function doLogout(env, token) { if (token) await env.DB.prepare('DELETE FROM Sessions WHERE token=?').bind(token).run(); return ok({}); }

function canReadModule(sess) { if (!sess) return false; if (sess.isAdmin) return true; return (sess.allowedMenus || []).some(m => m.indexOf('pk_vehicle_') === 0); }
function canUseScreen(sess, key) { if (!sess) return false; if (sess.isAdmin) return true; return (sess.allowedMenus || []).indexOf(key) >= 0; }
function requireRead(sess) { if (!canReadModule(sess)) throw { _forbid: true, msg: 'ไม่มีสิทธิ์เข้าถึงข้อมูล' }; }
function requireScreen(sess, key) { if (!canUseScreen(sess, key)) throw { _forbid: true, msg: 'ไม่มีสิทธิ์ใช้งานเมนูนี้' }; }

/* ======================= shared helpers ======================= */
async function getVehicleRaw_(env, vehicleId) {
  const o = await dbFindBy(env, 'Vehicle', 'VehicleID', asInt(vehicleId));
  return (o && asBool(o.IsActive)) ? o : null;
}
async function vehMap_(env) { const m = {}; (await dbReadActive(env, 'Vehicle')).forEach(o => { m[asInt(o.VehicleID)] = o; }); return m; }
function vehBrief_(v) {
  return { vehicleId: asInt(v.VehicleID), vehicleCode: asStr(v.VehicleCode), licensePlate: asStr(v.LicensePlate),
    vehicleType: asStr(v.VehicleType), brand: asStr(v.Brand), model: asStr(v.Model), currentMileage: asNum(v.CurrentMileage) };
}

/* ======================= เมนู 1 : Vehicle ======================= */
function vehicleOut_(o) {
  return {
    VehicleID: asInt(o.VehicleID), VehicleCode: asStr(o.VehicleCode), LicensePlate: asStr(o.LicensePlate),
    VehicleType: asStr(o.VehicleType), Brand: asStr(o.Brand), Model: asStr(o.Model), Color: asStr(o.Color),
    ManufactureYear: asIntN(o.ManufactureYear), EngineNo: asStr(o.EngineNo), ChassisNo: asStr(o.ChassisNo),
    FuelType: asStr(o.FuelType), CurrentMileage: asNum(o.CurrentMileage), RegistrationDate: asDateStr(o.RegistrationDate),
    Department: asStr(o.Department), ResponsibleEmpId: asStr(o.ResponsibleEmpId), ResponsibleName: asStr(o.ResponsibleName),
    Remark: asStr(o.Remark), InsuranceType: asStr(o.InsuranceType), InsuranceCompany: asStr(o.InsuranceCompany),
    InsuranceRenewDate: asDateStr(o.InsuranceRenewDate), InsuranceEndDate: asDateStr(o.InsuranceEndDate),
    ActRenewDate: asDateStr(o.ActRenewDate), ActEndDate: asDateStr(o.ActEndDate),
    TaxRenewDate: asDateStr(o.TaxRenewDate), TaxExpiryDate: asDateStr(o.TaxExpiryDate),
    LastInspectDate: asDateStr(o.LastInspectDate), InspectFreqMonths: asIntN(o.InspectFreqMonths), NextInspectDate: asDateStr(o.NextInspectDate),
    LastOilChangeDate: asDateStr(o.LastOilChangeDate), LastOilChangeMileage: asNumN(o.LastOilChangeMileage),
    OilChangeFreqKm: asIntN(o.OilChangeFreqKm), NextOilChangeMileage: asNumN(o.NextOilChangeMileage),
    VehicleStatus: asStr(o.VehicleStatus) || VEHICLE_STATUS_DEFAULT,
    vehicleAgeYears: vehicleAgeYears(asDateStr(o.RegistrationDate))
  };
}
async function Vehicle_list(env, p, sess) {
  requireRead(sess);
  const search = asStr(p.search).toLowerCase(), vType = asStr(p.vehicleType);
  const out = (await dbReadActive(env, 'Vehicle')).filter(o => {
    if (vType && asStr(o.VehicleType) !== vType) return false;
    if (search) { const hay = [o.LicensePlate, o.VehicleCode, o.Brand, o.Model, o.ResponsibleName].map(asStr).join(' ').toLowerCase(); if (hay.indexOf(search) < 0) return false; }
    return true;
  }).map(vehicleOut_);
  out.sort((a, b) => b.VehicleID - a.VehicleID);
  return listJson(out);
}
async function Vehicle_get(env, p, sess) {
  requireRead(sess);
  const o = await dbFindBy(env, 'Vehicle', 'VehicleID', asInt(p.id));
  if (!o || !asBool(o.IsActive)) return fail('ไม่พบข้อมูลรถ');
  return ok({ data: vehicleOut_(o) });
}
async function Vehicle_lookup(env, p, sess) {
  requireRead(sess);
  const search = asStr(p.search).toLowerCase();
  const rows = (await dbReadActive(env, 'Vehicle')).filter(o => {
    if (asStr(o.VehicleStatus) === STATUS_CANCEL) return false;
    if (!search) return true;
    const hay = [o.LicensePlate, o.VehicleCode, o.Brand, o.Model].map(asStr).join(' ').toLowerCase();
    return hay.indexOf(search) >= 0;
  }).map(o => ({
    VehicleID: asInt(o.VehicleID), VehicleCode: asStr(o.VehicleCode), LicensePlate: asStr(o.LicensePlate),
    VehicleType: asStr(o.VehicleType), Brand: asStr(o.Brand), Model: asStr(o.Model),
    CurrentMileage: asNum(o.CurrentMileage), InspectFreqMonths: asIntN(o.InspectFreqMonths), OilChangeFreqKm: asIntN(o.OilChangeFreqKm)
  }));
  rows.sort((a, b) => a.LicensePlate.localeCompare(b.LicensePlate, 'th'));
  return listJson(rows);
}
function validateVehicle_(p) {
  let e;
  if ((e = reqErr('ทะเบียนรถ', p.LicensePlate))) return e;
  if ((e = capErr('ทะเบียนรถ', p.LicensePlate, 50))) return e;
  if ((e = capErr('รหัสรถ', p.VehicleCode, 50))) return e;
  if ((e = capErr('ยี่ห้อ', p.Brand, 100))) return e;
  if ((e = capErr('รุ่น', p.Model, 100))) return e;
  if ((e = capErr('หมายเหตุ', p.Remark, 500))) return e;
  return null;
}
function bindVehicleParams_(p) {
  const insRenew = asDateStr(p.InsuranceRenewDate), actRenew = asDateStr(p.ActRenewDate), taxRenew = asDateStr(p.TaxRenewDate);
  const lastInspect = asDateStr(p.LastInspectDate), inspectFreq = asIntN(p.InspectFreqMonths);
  const lastOilM = asNumN(p.LastOilChangeMileage), oilFreq = asIntN(p.OilChangeFreqKm);
  return {
    VehicleCode: asStr(p.VehicleCode), LicensePlate: asStr(p.LicensePlate), VehicleType: asStr(p.VehicleType),
    Brand: asStr(p.Brand), Model: asStr(p.Model), Color: asStr(p.Color), ManufactureYear: asIntN(p.ManufactureYear),
    EngineNo: asStr(p.EngineNo), ChassisNo: asStr(p.ChassisNo), FuelType: asStr(p.FuelType), RegistrationDate: asDateStr(p.RegistrationDate),
    Department: asStr(p.Department), ResponsibleEmpId: asStr(p.ResponsibleEmpId), ResponsibleName: asStr(p.ResponsibleName), Remark: asStr(p.Remark),
    InsuranceType: asStr(p.InsuranceType), InsuranceCompany: asStr(p.InsuranceCompany), InsuranceRenewDate: insRenew,
    InsuranceEndDate: insRenew ? addYears(insRenew, 1) : '',
    ActRenewDate: actRenew, ActEndDate: actRenew ? addYears(actRenew, 1) : '',
    TaxRenewDate: taxRenew, TaxExpiryDate: taxRenew ? addYears(taxRenew, 1) : '',
    LastInspectDate: lastInspect, InspectFreqMonths: inspectFreq,
    NextInspectDate: (lastInspect && inspectFreq && inspectFreq > 0) ? addMonths(lastInspect, inspectFreq) : '',
    LastOilChangeDate: asDateStr(p.LastOilChangeDate), LastOilChangeMileage: lastOilM, OilChangeFreqKm: oilFreq,
    NextOilChangeMileage: (lastOilM !== null && oilFreq) ? lastOilM + oilFreq : null,
    VehicleStatus: asStr(p.VehicleStatus) || VEHICLE_STATUS_DEFAULT
  };
}
async function dupPlate_(env, plate, excludeId) {
  return (await dbReadActive(env, 'Vehicle')).some(o =>
    asStr(o.LicensePlate).toLowerCase() === asStr(plate).toLowerCase() && asInt(o.VehicleID) !== asInt(excludeId));
}
async function Vehicle_save(env, p, sess) {
  requireScreen(sess, 'pk_vehicle_registry');
  const verr = validateVehicle_(p); if (verr) return fail(verr);
  const id = asInt(p.VehicleID);
  if (await dupPlate_(env, p.LicensePlate, id)) return fail('ทะเบียนรถนี้มีอยู่แล้วในระบบ');
  const patch = bindVehicleParams_(p);
  if (id === 0) {
    patch.CurrentMileage = asNum(p.CurrentMileage);
    const ins = await dbInsert(env, 'Vehicle', patch, sess.empId);
    return ok({ id: ins.VehicleID });
  }
  const ex = await dbFindBy(env, 'Vehicle', 'VehicleID', id);
  if (!ex || !asBool(ex.IsActive)) return fail('ไม่พบข้อมูลรถ');
  await dbUpdate(env, 'Vehicle', ex, patch, sess.empId);
  return ok({ id });
}
async function Vehicle_delete(env, p, sess) {
  requireScreen(sess, 'pk_vehicle_registry');
  const ex = await dbFindBy(env, 'Vehicle', 'VehicleID', asInt(p.id));
  if (!ex) return fail('ไม่พบข้อมูลรถ');
  await dbSoftDelete(env, 'Vehicle', ex, sess.empId);
  return ok({});
}

/* ======================= เมนู 2 : Plan + reminder ======================= */
const REGISTRY_TYPES = [
  { label: 'ต่อทะเบียน', dueCol: 'TaxExpiryDate' }, { label: 'ต่อ พ.ร.บ.', dueCol: 'ActEndDate' },
  { label: 'ต่อประกัน', dueCol: 'InsuranceEndDate' }, { label: 'ตรวจสภาพ', dueCol: 'NextInspectDate' }
];
async function buildPlanItems_(env, vmap, opts) {
  return (await dbReadActive(env, 'MaintenancePlan')).filter(pl => {
    if (asStr(pl.Status) === STATUS_CANCEL) return false;
    if (opts.vehicleId && asInt(pl.VehicleID) !== asInt(opts.vehicleId)) return false;
    return true;
  }).map(pl => {
    const v = vmap[asInt(pl.VehicleID)] || {};
    const dueDate = asDateStr(pl.NextDueDate), dueMileage = asNumN(pl.NextDueMileage), cur = asNum(v.CurrentMileage);
    return Object.assign(vehBrief_(v), {
      kind: 'plan', planId: asInt(pl.PlanID), typeLabel: asStr(pl.TaskName), taskType: asStr(pl.TaskType),
      intervalMonths: asIntN(pl.IntervalMonths), intervalMileage: asIntN(pl.IntervalMileage),
      lastDoneDate: asDateStr(pl.LastDoneDate), lastDoneMileage: asNumN(pl.LastDoneMileage),
      dueDate, dueMileage, remainingKm: (dueMileage !== null) ? (dueMileage - cur) : null,
      daysRemaining: dueDate ? daysFromToday(dueDate) : null, status: asStr(pl.Status) || 'ใช้งาน'
    });
  }).filter(it => {
    if (!opts.dueOnly) return true;
    if (it.typeLabel === OIL_TASK_NAME) return false;
    const byDate = it.dueDate && it.daysRemaining !== null && it.daysRemaining <= opts.days;
    const byMile = it.dueMileage !== null && it.currentMileage >= it.dueMileage;
    return byDate || byMile;
  });
}
function buildRegistryItems_(vmap, opts) {
  const out = [];
  Object.keys(vmap).forEach(vid => {
    const v = vmap[vid]; if (asStr(v.VehicleStatus) === STATUS_CANCEL) return;
    REGISTRY_TYPES.forEach(t => {
      const dueDate = asDateStr(v[t.dueCol]); if (!dueDate) return;
      const dr = daysFromToday(dueDate);
      if (opts.dueOnly && dr > opts.days) return;
      out.push(Object.assign(vehBrief_(v), { kind: 'registry', planId: null, typeLabel: t.label, dueCol: t.dueCol, dueDate, dueMileage: null, remainingKm: null, daysRemaining: dr, status: 'ใช้งาน' }));
    });
  });
  return out;
}
function buildOilItems_(vmap, opts) {
  const out = [];
  Object.keys(vmap).forEach(vid => {
    const v = vmap[vid]; if (asStr(v.VehicleStatus) === STATUS_CANCEL) return;
    const next = asNumN(v.NextOilChangeMileage); if (next === null) return;
    const cur = asNum(v.CurrentMileage), remaining = next - cur;
    if (opts.dueOnly && remaining > OIL_REMIND_KM) return;
    out.push(Object.assign(vehBrief_(v), { kind: 'oilchange', planId: null, typeLabel: OIL_TASK_NAME, dueDate: '', dueMileage: next, remainingKm: remaining, daysRemaining: null, status: 'ใช้งาน' }));
  });
  out.sort((a, b) => a.remainingKm - b.remainingKm);
  return out;
}
function sortByDue_(items) {
  return items.map((it, i) => ({ it, i })).sort((a, b) => {
    const da = a.it.dueDate, db = b.it.dueDate;
    if (!da && !db) return a.i - b.i; if (!da) return 1; if (!db) return -1;
    if (da === db) return a.i - b.i; return da < db ? -1 : 1;
  }).map(x => x.it);
}
async function Plan_dueSoon(env, p, sess) {
  requireRead(sess);
  const days = (p.days !== undefined && p.days !== '') ? asInt(p.days) : DUE_SOON_DAYS;
  const vmap = await vehMap_(env);
  const dateItems = sortByDue_((await buildPlanItems_(env, vmap, { dueOnly: true, days })).concat(buildRegistryItems_(vmap, { dueOnly: true, days })));
  const oilItems = buildOilItems_(vmap, { dueOnly: true });
  return listJson(dateItems.concat(oilItems));
}
async function Plan_list(env, p, sess) {
  requireRead(sess);
  const vmap = await vehMap_(env);
  const vehicleId = asIntN(p.vehicleId), status = asStr(p.status);
  let plans = await buildPlanItems_(env, vmap, { dueOnly: false, vehicleId });
  if (status) plans = plans.filter(it => it.status === status);
  let extra = [];
  if (!status || status === 'ใช้งาน') {
    extra = buildRegistryItems_(vmap, { dueOnly: false }).concat(buildOilItems_(vmap, { dueOnly: false }));
    if (vehicleId) extra = extra.filter(it => it.vehicleId === vehicleId);
  }
  return listJson(sortByDue_(plans.concat(extra)));
}
async function Plan_get(env, p, sess) {
  requireRead(sess);
  const pl = await dbFindBy(env, 'MaintenancePlan', 'PlanID', asInt(p.id));
  if (!pl || !asBool(pl.IsActive)) return fail('ไม่พบแผน');
  return ok({ data: {
    PlanID: asInt(pl.PlanID), VehicleID: asInt(pl.VehicleID), TaskName: asStr(pl.TaskName), TaskType: asStr(pl.TaskType),
    IntervalMonths: asIntN(pl.IntervalMonths), IntervalMileage: asIntN(pl.IntervalMileage),
    LastDoneDate: asDateStr(pl.LastDoneDate), LastDoneMileage: asNumN(pl.LastDoneMileage),
    NextDueDate: asDateStr(pl.NextDueDate), NextDueMileage: asNumN(pl.NextDueMileage),
    Status: asStr(pl.Status) || 'ใช้งาน', Remark: asStr(pl.Remark)
  } });
}
function bindPlanParams_(p) {
  const months = asIntN(p.IntervalMonths), mileage = asIntN(p.IntervalMileage);
  const lastDate = asDateStr(p.LastDoneDate), lastMile = asNumN(p.LastDoneMileage);
  return {
    VehicleID: asInt(p.VehicleID), TaskName: asStr(p.TaskName), TaskType: asStr(p.TaskType),
    IntervalMonths: months, IntervalMileage: mileage, LastDoneDate: lastDate, LastDoneMileage: lastMile,
    NextDueDate: (months && months > 0 && lastDate) ? addMonths(lastDate, months) : '',
    NextDueMileage: (mileage && mileage > 0 && lastMile !== null) ? lastMile + mileage : null,
    Status: asStr(p.Status) || 'ใช้งาน', Remark: asStr(p.Remark)
  };
}
async function Plan_save(env, p, sess) {
  requireScreen(sess, 'pk_vehicle_plan');
  if (!asInt(p.VehicleID)) return fail('กรุณาเลือกรถ');
  if (!asStr(p.TaskName)) return fail('กรุณากรอกชื่องาน');
  const months = asIntN(p.IntervalMonths), mileage = asIntN(p.IntervalMileage);
  if (!(months && months > 0) && !(mileage && mileage > 0)) return fail('ต้องระบุรอบอย่างน้อย 1 อย่าง (เดือน หรือ กิโลเมตร)');
  if (!(await getVehicleRaw_(env, p.VehicleID))) return fail('ไม่พบรถที่เลือก');
  const patch = bindPlanParams_(p), id = asInt(p.PlanID);
  if (id === 0) { const ins = await dbInsert(env, 'MaintenancePlan', patch, sess.empId); return ok({ id: ins.PlanID }); }
  const ex = await dbFindBy(env, 'MaintenancePlan', 'PlanID', id);
  if (!ex || !asBool(ex.IsActive)) return fail('ไม่พบแผน');
  await dbUpdate(env, 'MaintenancePlan', ex, patch, sess.empId);
  return ok({ id });
}
async function Plan_delete(env, p, sess) {
  requireScreen(sess, 'pk_vehicle_plan');
  const ex = await dbFindBy(env, 'MaintenancePlan', 'PlanID', asInt(p.id));
  if (!ex) return fail('ไม่พบแผน');
  await dbSoftDelete(env, 'MaintenancePlan', ex, sess.empId);
  return ok({});
}
async function Plan_renewRegistry(env, p, sess) {
  requireScreen(sess, 'pk_vehicle_plan');
  const type = asStr(p.type), d = asDateStr(p.newRenewDate);
  if (!d) return fail('กรุณาระบุวันที่ต่ออายุ');
  const v = await getVehicleRaw_(env, p.vehicleId); if (!v) return fail('ไม่พบรถ');
  const patch = {};
  if (type === 'ต่อทะเบียน') { patch.TaxRenewDate = d; patch.TaxExpiryDate = addYears(d, 1); }
  else if (type === 'ต่อ พ.ร.บ.') { patch.ActRenewDate = d; patch.ActEndDate = addYears(d, 1); }
  else if (type === 'ต่อประกัน') { patch.InsuranceRenewDate = d; patch.InsuranceEndDate = addYears(d, 1); }
  else if (type === 'ตรวจสภาพ') { const freq = asIntN(v.InspectFreqMonths); patch.LastInspectDate = d; patch.NextInspectDate = (freq && freq > 0) ? addMonths(d, freq) : asDateStr(v.NextInspectDate); }
  else return fail('ประเภทการต่ออายุไม่ถูกต้อง');
  await dbUpdate(env, 'Vehicle', v, patch, sess.empId);
  return ok({});
}
async function Plan_completePlan(env, p, sess) {
  requireScreen(sess, 'pk_vehicle_plan');
  const doneDate = asDateStr(p.doneDate) || todayStr();
  const pl = await dbFindBy(env, 'MaintenancePlan', 'PlanID', asInt(p.planId));
  if (!pl || !asBool(pl.IsActive)) return fail('ไม่พบแผน');
  const v = await getVehicleRaw_(env, pl.VehicleID);
  const cur = v ? asNum(v.CurrentMileage) : asNum(pl.LastDoneMileage);
  const months = asIntN(pl.IntervalMonths), mileage = asIntN(pl.IntervalMileage);
  await dbUpdate(env, 'MaintenancePlan', pl, {
    LastDoneDate: doneDate, LastDoneMileage: cur,
    NextDueDate: (months && months > 0) ? addMonths(doneDate, months) : '',
    NextDueMileage: (mileage && mileage > 0) ? cur + mileage : null
  }, sess.empId);
  return ok({});
}
async function Plan_renewOilChange(env, p, sess) {
  requireScreen(sess, 'pk_vehicle_plan');
  const m = asNumN(p.changeMileage); if (m === null) return fail('กรุณาระบุเลขไมล์ที่เปลี่ยนน้ำมัน');
  const d = asDateStr(p.changeDate) || todayStr();
  const v = await getVehicleRaw_(env, p.vehicleId); if (!v) return fail('ไม่พบรถ');
  const freq = asIntN(v.OilChangeFreqKm);
  await dbUpdate(env, 'Vehicle', v, { LastOilChangeMileage: m, LastOilChangeDate: d, NextOilChangeMileage: (freq && freq > 0) ? m + freq : null }, sess.empId);
  return ok({});
}

/* ======================= เมนู 3 : RepairRequest ======================= */
function repairOut_(o, vmap) {
  const v = vmap[asInt(o.VehicleID)] || {};
  return {
    RequestID: asInt(o.RequestID), RequestNo: asStr(o.RequestNo), VehicleID: asInt(o.VehicleID),
    LicensePlate: asStr(v.LicensePlate), VehicleCode: asStr(v.VehicleCode), Brand: asStr(v.Brand), Model: asStr(v.Model),
    ReportDate: asDateTimeStr(o.ReportDate), ReportedByEmpId: asStr(o.ReportedByEmpId), ReportedByName: asStr(o.ReportedByName),
    ProblemDescription: asStr(o.ProblemDescription), Severity: asStr(o.Severity), CurrentMileage: asNumN(o.CurrentMileage),
    Status: asStr(o.Status) || 'รอดำเนินการ', Remark: asStr(o.Remark)
  };
}
async function Repair_list(env, p, sess) {
  requireRead(sess);
  const vmap = await vehMap_(env);
  const dateFrom = asDateStr(p.dateFrom), dateTo = asDateStr(p.dateTo), vehicleId = asIntN(p.vehicleId), status = asStr(p.status), search = asStr(p.search).toLowerCase();
  const rows = (await dbReadActive(env, 'RepairRequest')).filter(o => {
    const rd = asDateStr(o.ReportDate);
    if (dateFrom && rd < dateFrom) return false;
    if (dateTo && rd > dateTo) return false;
    if (vehicleId && asInt(o.VehicleID) !== vehicleId) return false;
    if (status && asStr(o.Status) !== status) return false;
    if (search) { const v = vmap[asInt(o.VehicleID)] || {}; const hay = [o.RequestNo, o.ProblemDescription, o.ReportedByName, v.LicensePlate].map(asStr).join(' ').toLowerCase(); if (hay.indexOf(search) < 0) return false; }
    return true;
  }).map(o => repairOut_(o, vmap));
  rows.sort((a, b) => (b.ReportDate || '').localeCompare(a.ReportDate || ''));
  return listJson(rows);
}
async function Repair_get(env, p, sess) {
  requireRead(sess);
  const o = await dbFindBy(env, 'RepairRequest', 'RequestID', asInt(p.id));
  if (!o || !asBool(o.IsActive)) return fail('ไม่พบใบแจ้งซ่อม');
  return ok({ data: repairOut_(o, await vehMap_(env)) });
}
async function Repair_save(env, p, sess) {
  requireScreen(sess, 'pk_vehicle_repair');
  if (!asInt(p.VehicleID)) return fail('กรุณาเลือกรถ');
  if (!asStr(p.ProblemDescription)) return fail('กรุณากรอกอาการ/ปัญหา');
  const capE = capErr('หมายเหตุ', p.Remark, 500); if (capE) return fail(capE);
  if (!(await getVehicleRaw_(env, p.VehicleID))) return fail('ไม่พบรถที่เลือก');
  const id = asInt(p.RequestID);
  const patch = {
    VehicleID: asInt(p.VehicleID), ReportedByEmpId: sess.empId, ReportedByName: asStr(p.ReportedByName) || sess.empName,
    ProblemDescription: asStr(p.ProblemDescription), Severity: asStr(p.Severity), CurrentMileage: asNumN(p.CurrentMileage), Remark: asStr(p.Remark)
  };
  if (id === 0) {
    patch.RequestNo = await genDocNo(env, 'RepairRequest', 'RequestNo', 'VR');
    patch.ReportDate = asDateTimeStr(p.ReportDate) || nowStr();
    patch.Status = asStr(p.Status) || 'รอดำเนินการ';
    const ins = await dbInsert(env, 'RepairRequest', patch, sess.empId);
    return ok({ id: ins.RequestID, requestNo: ins.RequestNo });
  }
  const ex = await dbFindBy(env, 'RepairRequest', 'RequestID', id);
  if (!ex || !asBool(ex.IsActive)) return fail('ไม่พบใบแจ้งซ่อม');
  if (asStr(p.Status)) patch.Status = asStr(p.Status);
  await dbUpdate(env, 'RepairRequest', ex, patch, sess.empId);
  return ok({ id, requestNo: asStr(ex.RequestNo) });
}
async function Repair_delete(env, p, sess) {
  requireScreen(sess, 'pk_vehicle_repair');
  const ex = await dbFindBy(env, 'RepairRequest', 'RequestID', asInt(p.id));
  if (!ex) return fail('ไม่พบใบแจ้งซ่อม');
  await dbSoftDelete(env, 'RepairRequest', ex, sess.empId);
  return ok({});
}
async function recomputeRequestStatus_(env, requestId, empId) {
  if (!asInt(requestId)) return;
  const req = await dbFindBy(env, 'RepairRequest', 'RequestID', asInt(requestId));
  if (!req || !asBool(req.IsActive)) return;
  const logs = (await dbReadActive(env, 'MaintenanceLog')).filter(l => asInt(l.RequestID) === asInt(requestId));
  let status;
  if (logs.length === 0) status = 'รอดำเนินการ';
  else if (logs.some(l => asStr(l.Status) === 'เสร็จสิ้น')) status = 'เสร็จสิ้น';
  else status = 'กำลังซ่อม';
  if (asStr(req.Status) !== status) await dbUpdate(env, 'RepairRequest', req, { Status: status }, empId);
}
async function setRequestStatus_(env, requestId, status, empId) {
  if (!asInt(requestId)) return;
  const req = await dbFindBy(env, 'RepairRequest', 'RequestID', asInt(requestId));
  if (!req || !asBool(req.IsActive)) return;
  if (asStr(req.Status) !== status) await dbUpdate(env, 'RepairRequest', req, { Status: status }, empId);
}

/* ======================= เมนู 4 : MaintenanceLog ======================= */
function logHeaderOut_(o, vmap) {
  const v = vmap[asInt(o.VehicleID)] || {};
  return {
    LogID: asInt(o.LogID), LogNo: asStr(o.LogNo), VehicleID: asInt(o.VehicleID),
    LicensePlate: asStr(v.LicensePlate), VehicleCode: asStr(v.VehicleCode), Brand: asStr(v.Brand), Model: asStr(v.Model),
    RequestID: asIntN(o.RequestID), PlanID: asIntN(o.PlanID), MaintenanceType: asStr(o.MaintenanceType) || 'ซ่อม',
    ServiceDate: asDateStr(o.ServiceDate), CompletedDate: asDateStr(o.CompletedDate), Mileage: asNumN(o.Mileage),
    WorkDescription: asStr(o.WorkDescription), PerformedByEmpId: asStr(o.PerformedByEmpId), PerformedByName: asStr(o.PerformedByName),
    VendorName: asStr(o.VendorName), LaborCost: asNum(o.LaborCost), PartsCost: asNum(o.PartsCost), TotalCost: asNum(o.TotalCost),
    Status: asStr(o.Status) || 'เสร็จสิ้น', Remark: asStr(o.Remark)
  };
}
function logDetailOut_(d) {
  return { DetailID: asInt(d.DetailID), LogID: asInt(d.LogID), ItemName: asStr(d.ItemName), ItemCode: asStr(d.ItemCode),
    Quantity: asNum(d.Quantity), UnitName: asStr(d.UnitName), UnitPrice: asNum(d.UnitPrice), Amount: asNum(d.Amount), Remark: asStr(d.Remark) };
}
async function Log_list(env, p, sess) {
  requireRead(sess);
  const vmap = await vehMap_(env);
  const vehicleId = asIntN(p.vehicleId), status = asStr(p.status), search = asStr(p.search).toLowerCase();
  const rows = (await dbReadActive(env, 'MaintenanceLog')).filter(o => {
    if (vehicleId && asInt(o.VehicleID) !== vehicleId) return false;
    if (status && asStr(o.Status) !== status) return false;
    if (search) { const v = vmap[asInt(o.VehicleID)] || {}; const hay = [o.LogNo, o.WorkDescription, o.VendorName, v.LicensePlate].map(asStr).join(' ').toLowerCase(); if (hay.indexOf(search) < 0) return false; }
    return true;
  }).map(o => logHeaderOut_(o, vmap));
  rows.sort((a, b) => { const c = (b.ServiceDate || '').localeCompare(a.ServiceDate || ''); return c !== 0 ? c : b.LogID - a.LogID; });
  return listJson(rows);
}
async function Log_get(env, p, sess) {
  requireRead(sess);
  const o = await dbFindBy(env, 'MaintenanceLog', 'LogID', asInt(p.id));
  if (!o || !asBool(o.IsActive)) return fail('ไม่พบใบงาน');
  const items = (await dbReadRaw(env, 'MaintenanceLogDetail')).filter(d => asInt(d.LogID) === asInt(p.id)).map(logDetailOut_);
  return ok({ data: logHeaderOut_(o, await vehMap_(env)), items });
}
function isLogRowEmpty_(it) {
  const hasText = asStr(it.ItemName) || asStr(it.ItemCode) || asStr(it.UnitName) || asStr(it.Remark);
  return !hasText && asNum(it.UnitPrice) === 0;
}
async function Log_save(env, p, sess) {
  requireScreen(sess, 'pk_vehicle_log');
  const h = p.header || {}, items = Array.isArray(p.items) ? p.items : [];
  if (!asInt(h.VehicleID)) return fail('กรุณาเลือกรถ');
  if (!(await getVehicleRaw_(env, h.VehicleID))) return fail('ไม่พบรถที่เลือก');

  const cleanItems = items.filter(it => !isLogRowEmpty_(it));
  let partsCost = 0;
  cleanItems.forEach(it => { it._amount = round2(asNum(it.Quantity) * asNum(it.UnitPrice)); partsCost += it._amount; });
  partsCost = round2(partsCost);
  const laborCost = asNum(h.LaborCost), totalCost = round2(laborCost + partsCost);
  const headerPatch = {
    VehicleID: asInt(h.VehicleID), RequestID: asIntN(h.RequestID), PlanID: asIntN(h.PlanID),
    MaintenanceType: asStr(h.MaintenanceType) || 'ซ่อม', ServiceDate: asDateStr(h.ServiceDate) || todayStr(),
    CompletedDate: asDateStr(h.CompletedDate), Mileage: asNumN(h.Mileage), WorkDescription: asStr(h.WorkDescription),
    PerformedByEmpId: asStr(h.PerformedByEmpId) || sess.empId, PerformedByName: asStr(h.PerformedByName) || sess.empName,
    VendorName: asStr(h.VendorName), LaborCost: laborCost, PartsCost: partsCost, TotalCost: totalCost,
    Status: asStr(h.Status) || 'เสร็จสิ้น', Remark: asStr(h.Remark)
  };
  let logId = asInt(h.LogID), saved;
  if (logId === 0) {
    headerPatch.LogNo = await genDocNo(env, 'MaintenanceLog', 'LogNo', 'ML');
    saved = await dbInsert(env, 'MaintenanceLog', headerPatch, sess.empId);
    logId = saved.LogID;
  } else {
    const ex = await dbFindBy(env, 'MaintenanceLog', 'LogID', logId);
    if (!ex || !asBool(ex.IsActive)) return fail('ไม่พบใบงาน');
    saved = await dbUpdate(env, 'MaintenanceLog', ex, headerPatch, sess.empId);
  }
  await dbDeleteRows(env, 'MaintenanceLogDetail', d => asInt(d.LogID) === asInt(logId));
  for (const it of cleanItems) {
    await dbInsert(env, 'MaintenanceLogDetail', {
      LogID: logId, ItemName: asStr(it.ItemName), ItemCode: asStr(it.ItemCode), Quantity: asNum(it.Quantity) || 1,
      UnitName: asStr(it.UnitName), UnitPrice: asNum(it.UnitPrice), Amount: it._amount, Remark: asStr(it.Remark)
    }, sess.empId);
  }
  if (asInt(headerPatch.PlanID)) await rollPlanForward_(env, headerPatch.PlanID, headerPatch.ServiceDate, headerPatch.Mileage, sess.empId);
  if (asInt(headerPatch.RequestID)) {
    const st = headerPatch.Status;
    if (st === 'เสร็จสิ้น') await setRequestStatus_(env, headerPatch.RequestID, 'เสร็จสิ้น', sess.empId);
    else if (st === STATUS_CANCEL) await recomputeRequestStatus_(env, headerPatch.RequestID, sess.empId);
    else await setRequestStatus_(env, headerPatch.RequestID, 'กำลังซ่อม', sess.empId);
  }
  return ok({ id: logId, logNo: asStr(saved.LogNo) });
}
async function rollPlanForward_(env, planId, serviceDate, mileage, empId) {
  const pl = await dbFindBy(env, 'MaintenancePlan', 'PlanID', asInt(planId));
  if (!pl || !asBool(pl.IsActive)) return;
  const months = asIntN(pl.IntervalMonths), milv = asIntN(pl.IntervalMileage);
  const lastDate = asDateStr(serviceDate) || todayStr(), lastMile = asNumN(mileage);
  await dbUpdate(env, 'MaintenancePlan', pl, {
    LastDoneDate: lastDate, LastDoneMileage: lastMile,
    NextDueDate: (months && months > 0) ? addMonths(lastDate, months) : '',
    NextDueMileage: (milv && milv > 0 && lastMile !== null) ? lastMile + milv : asNumN(pl.NextDueMileage)
  }, empId);
}
async function Log_delete(env, p, sess) {
  requireScreen(sess, 'pk_vehicle_log');
  const ex = await dbFindBy(env, 'MaintenanceLog', 'LogID', asInt(p.id));
  if (!ex) return fail('ไม่พบใบงาน');
  const requestId = asIntN(ex.RequestID);
  await dbSoftDelete(env, 'MaintenanceLog', ex, sess.empId);
  if (asInt(requestId)) await recomputeRequestStatus_(env, requestId, sess.empId);
  return ok({});
}

/* ---- ไฟล์แนบใบเสร็จ (R2) ---- */
function base64ToBytes(b64) { const bin = atob(b64); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); return arr; }
function base64FromBuffer(buf) { let bin = ''; const bytes = new Uint8Array(buf), chunk = 0x8000; for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)); return btoa(bin); }
async function Log_getReceipts(env, p, sess) {
  requireRead(sess);
  const logId = asInt(p.logId);
  const rows = (await dbReadActive(env, 'Receipts')).filter(r => asStr(r.Module) === FILE_MODULE && asInt(r.RefID) === logId).map(r => ({
    ReceiptID: asInt(r.ReceiptID), FileName: asStr(r.FileName), ContentType: asStr(r.ContentType), FileSize: asNum(r.FileSize)
  }));
  return listJson(rows);
}
async function Log_uploadReceipt(env, p, sess) {
  requireScreen(sess, 'pk_vehicle_log');
  const logId = asInt(p.logId);
  if (logId <= 0) return fail('กรุณาบันทึกใบงานก่อนแนบไฟล์');
  const files = Array.isArray(p.files) ? p.files : [];
  if (!files.length) return fail('ไม่มีไฟล์');
  const saved = [];
  for (const f of files) {
    const bytes = base64ToBytes(asStr(f.dataBase64));
    const key = FILE_MODULE + '/' + logId + '/' + crypto.randomUUID();
    await env.RECEIPTS.put(key, bytes, { httpMetadata: { contentType: asStr(f.contentType) || 'application/octet-stream' } });
    const rec = await dbInsert(env, 'Receipts', {
      Module: FILE_MODULE, RefID: logId, StorageKey: key, FileName: asStr(f.fileName) || 'receipt',
      ContentType: asStr(f.contentType), FileSize: bytes.length
    }, sess.empId);
    saved.push({ ReceiptID: rec.ReceiptID, FileName: rec.FileName });
  }
  return ok({ files: saved });
}
async function Log_downloadReceipt(env, p, sess) {
  requireRead(sess);
  const rec = await dbFindBy(env, 'Receipts', 'ReceiptID', asInt(p.id));
  const errJson = () => new Response('{"success":false,"error":"ไม่พบไฟล์"}', { headers: { 'Content-Type': 'application/json;charset=utf-8' } });
  if (!rec || !asBool(rec.IsActive) || asStr(rec.Module) !== FILE_MODULE) return errJson();
  const obj = await env.RECEIPTS.get(asStr(rec.StorageKey));
  if (!obj) return errJson();
  const b64 = base64FromBuffer(await obj.arrayBuffer());
  return new Response(b64, { headers: { 'Content-Type': 'text/plain;charset=utf-8', 'Access-Control-Allow-Origin': '*' } });
}
async function Log_deleteReceipt(env, p, sess) {
  requireScreen(sess, 'pk_vehicle_log');
  const rec = await dbFindBy(env, 'Receipts', 'ReceiptID', asInt(p.id));
  if (!rec || !asBool(rec.IsActive) || asStr(rec.Module) !== FILE_MODULE) return fail('ไม่พบไฟล์');
  try { await env.RECEIPTS.delete(asStr(rec.StorageKey)); } catch (e) {}
  await dbSoftDelete(env, 'Receipts', rec, sess.empId);
  return ok({});
}

/* ======================= เมนู 5 : History ======================= */
async function History_list(env, p, sess) {
  requireRead(sess);
  const vmap = await vehMap_(env);
  const vehicleId = asIntN(p.vehicleId), dateFrom = asDateStr(p.dateFrom), dateTo = asDateStr(p.dateTo), mType = asStr(p.maintenanceType);
  const rows = (await dbReadActive(env, 'MaintenanceLog')).filter(o => {
    if (vehicleId && asInt(o.VehicleID) !== vehicleId) return false;
    const sd = asDateStr(o.ServiceDate);
    if (dateFrom && sd < dateFrom) return false;
    if (dateTo && sd > dateTo) return false;
    if (mType && asStr(o.MaintenanceType) !== mType) return false;
    return true;
  }).map(o => logHeaderOut_(o, vmap));
  rows.sort((a, b) => { const c = (b.ServiceDate || '').localeCompare(a.ServiceDate || ''); return c !== 0 ? c : b.LogID - a.LogID; });
  return listJson(rows);
}
async function History_detail(env, p, sess) {
  requireRead(sess);
  const o = await dbFindBy(env, 'MaintenanceLog', 'LogID', asInt(p.logId));
  if (!o || !asBool(o.IsActive)) return fail('ไม่พบใบงาน');
  const items = (await dbReadRaw(env, 'MaintenanceLogDetail')).filter(d => asInt(d.LogID) === asInt(p.logId)).map(logDetailOut_);
  return ok({ data: logHeaderOut_(o, await vehMap_(env)), items });
}
async function History_summary(env, p, sess) {
  requireRead(sess);
  const vmap = await vehMap_(env);
  const dateFrom = asDateStr(p.dateFrom), dateTo = asDateStr(p.dateTo);
  const agg = {};
  (await dbReadActive(env, 'MaintenanceLog')).forEach(o => {
    const sd = asDateStr(o.ServiceDate);
    if (dateFrom && sd < dateFrom) return;
    if (dateTo && sd > dateTo) return;
    const vid = asInt(o.VehicleID);
    if (!agg[vid]) agg[vid] = { vehicleId: vid, count: 0, total: 0, labor: 0, parts: 0 };
    agg[vid].count += 1; agg[vid].total += asNum(o.TotalCost); agg[vid].labor += asNum(o.LaborCost); agg[vid].parts += asNum(o.PartsCost);
  });
  const out = Object.keys(agg).map(vid => {
    const v = vmap[vid] || {}, a = agg[vid];
    return { vehicleId: a.vehicleId, licensePlate: asStr(v.LicensePlate), vehicleCode: asStr(v.VehicleCode), brand: asStr(v.Brand), model: asStr(v.Model),
      count: a.count, totalCost: round2(a.total), laborCost: round2(a.labor), partsCost: round2(a.parts) };
  });
  out.sort((a, b) => b.totalCost - a.totalCost);
  return listJson(out);
}

/* ======================= เมนู 6 : Mileage ======================= */
async function activeReadings_(env, vehicleId) {
  return (await dbReadActive(env, 'MileageLog')).filter(o => asInt(o.VehicleID) === asInt(vehicleId))
    .map(o => ({ MileageID: asInt(o.MileageID), date: asDateStr(o.MileageDate), mileage: asNum(o.Mileage), raw: o }));
}
function maxMileageExcept_(reads, excludeId) {
  let max = null;
  reads.forEach(r => { if (excludeId && r.MileageID === excludeId) return; if (max === null || r.mileage > max) max = r.mileage; });
  return max;
}
function odoGuard_(value, baseline) {
  if (baseline === null || baseline === undefined) return null;
  if (value < baseline) return 'เลขไมล์ (' + value + ') น้อยกว่าค่าล่าสุด (' + baseline + ') — ถอยหลังไม่ได้';
  if (value - baseline > ODO_MAX_JUMP) return 'เลขไมล์กระโดดผิดปกติ (เพิ่มเกิน ' + ODO_MAX_JUMP + ' กม.) ตรวจสอบการพิมพ์';
  return null;
}
async function syncVehicleMileage_(env, vehicleId, empId) {
  const reads = await activeReadings_(env, vehicleId);
  reads.sort((a, b) => { const c = b.date.localeCompare(a.date); return c !== 0 ? c : b.MileageID - a.MileageID; });
  const cur = reads.length ? reads[0].mileage : 0;
  const v = await getVehicleRaw_(env, vehicleId);
  if (v) await dbUpdate(env, 'Vehicle', v, { CurrentMileage: cur }, empId);
  return cur;
}
function monthlyKm_(readings) {
  const s = readings.slice().sort((a, b) => a.date.localeCompare(b.date));
  if (s.length < 2) return 0;
  let sum = 0; for (let i = 1; i < s.length; i++) sum += Math.max(0, s[i].mileage - s[i - 1].mileage);
  return round2(sum);
}
async function Mileage_list(env, p, sess) {
  requireRead(sess);
  const vehicleId = asInt(p.vehicleId);
  if (!vehicleId) return listJson([]);
  const reads = (await activeReadings_(env, vehicleId)).map(r => ({ MileageID: r.MileageID, MileageDate: r.date, Mileage: r.mileage, RecordedByName: asStr(r.raw.RecordedByName), Remark: asStr(r.raw.Remark) }));
  reads.sort((a, b) => b.MileageDate.localeCompare(a.MileageDate));
  return listJson(reads);
}
async function Mileage_save(env, p, sess) {
  requireScreen(sess, 'pk_vehicle_mileage');
  const vehicleId = asInt(p.VehicleID); if (!vehicleId) return fail('กรุณาเลือกรถ');
  const date = asDateStr(p.MileageDate) || todayStr(), mileage = asNumN(p.Mileage);
  if (mileage === null || mileage < 0) return fail('กรุณากรอกเลขไมล์ที่ถูกต้อง');
  if (!(await getVehicleRaw_(env, vehicleId))) return fail('ไม่พบรถที่เลือก');
  const reads = await activeReadings_(env, vehicleId);
  const sameDay = reads.find(r => r.date === date);
  const baseline = maxMileageExcept_(reads, sameDay ? sameDay.MileageID : null);
  const gErr = odoGuard_(mileage, baseline); if (gErr) return fail(gErr);
  if (sameDay) await dbUpdate(env, 'MileageLog', sameDay.raw, { Mileage: mileage, RecordedByEmpId: sess.empId, RecordedByName: asStr(p.RecordedByName) || sess.empName, Remark: asStr(p.Remark) }, sess.empId);
  else await dbInsert(env, 'MileageLog', { VehicleID: vehicleId, MileageDate: date, Mileage: mileage, RecordedByEmpId: sess.empId, RecordedByName: asStr(p.RecordedByName) || sess.empName, Remark: asStr(p.Remark) }, sess.empId);
  return ok({ currentMileage: await syncVehicleMileage_(env, vehicleId, sess.empId) });
}
async function Mileage_saveMonth(env, p, sess) {
  requireScreen(sess, 'pk_vehicle_mileage');
  const vehicleId = asInt(p.VehicleID), year = asInt(p.Year), month = asInt(p.Month);
  if (!vehicleId || !year || !month) return fail('ข้อมูลไม่ครบ');
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const byDay = {}, arr = Array.isArray(p.Days) ? p.Days : [];
  for (const it of arr) {
    const d = asInt(it.day), m = asNumN(it.mileage);
    if (m === null) continue;
    if (d < 1 || d > daysInMonth) continue;
    if (m < 0) return fail('เลขไมล์ติดลบในวันที่ ' + d);
    byDay[d] = m;
  }
  if (!(await getVehicleRaw_(env, vehicleId))) return fail('ไม่พบรถที่เลือก');
  const firstDay = year + '-' + pad(month) + '-01', lastDay = year + '-' + pad(month) + '-' + pad(daysInMonth);
  const reads = await activeReadings_(env, vehicleId);
  let baseline = null;
  reads.forEach(r => { if (r.date < firstDay) { if (baseline === null || r.mileage > baseline) baseline = r.mileage; } });
  let running = baseline;
  const sortedDays = Object.keys(byDay).map(Number).sort((a, b) => a - b);
  for (const dd of sortedDays) { const gErr = odoGuard_(byDay[dd], running); if (gErr) return fail('วันที่ ' + dd + ': ' + gErr); running = (running === null) ? byDay[dd] : Math.max(running, byDay[dd]); }

  const monthActive = {}, monthDeleted = {};
  for (const o of await dbReadRaw(env, 'MileageLog')) {
    if (asInt(o.VehicleID) !== vehicleId) continue;
    const ds = asDateStr(o.MileageDate);
    if (ds < firstDay || ds > lastDay) continue;
    const dd = Number(ds.split('-')[2]);
    if (asBool(o.IsActive)) monthActive[dd] = o; else if (!monthDeleted[dd]) monthDeleted[dd] = o;
  }
  for (const dd of sortedDays) {
    const ds = year + '-' + pad(month) + '-' + pad(dd), val = byDay[dd];
    if (monthActive[dd]) await dbUpdate(env, 'MileageLog', monthActive[dd], { Mileage: val, RecordedByEmpId: sess.empId, RecordedByName: sess.empName }, sess.empId);
    else if (monthDeleted[dd]) await dbUpdate(env, 'MileageLog', monthDeleted[dd], { IsActive: 1, Mileage: val, MileageDate: ds, RecordedByEmpId: sess.empId, RecordedByName: sess.empName }, sess.empId);
    else await dbInsert(env, 'MileageLog', { VehicleID: vehicleId, MileageDate: ds, Mileage: val, RecordedByEmpId: sess.empId, RecordedByName: sess.empName, Remark: '' }, sess.empId);
  }
  for (const dd of Object.keys(monthActive)) if (byDay[dd] === undefined) await dbSoftDelete(env, 'MileageLog', monthActive[dd], sess.empId);

  const cur = await syncVehicleMileage_(env, vehicleId, sess.empId);
  const autoPlanCreated = await maybeCreateOilPlan_(env, vehicleId, sess);
  const monthReads = (await activeReadings_(env, vehicleId)).filter(r => r.date >= firstDay && r.date <= lastDay);
  return ok({ currentMileage: cur, monthlyKm: monthlyKm_(monthReads), autoPlanCreated });
}
async function maybeCreateOilPlan_(env, vehicleId, sess) {
  const v = await getVehicleRaw_(env, vehicleId); if (!v) return false;
  const next = asNumN(v.NextOilChangeMileage); if (next === null) return false;
  const remaining = next - asNum(v.CurrentMileage);
  if (remaining < 0 || remaining > OIL_REMIND_KM) return false;
  const exists = (await dbReadActive(env, 'MaintenancePlan')).some(pl =>
    asInt(pl.VehicleID) === asInt(vehicleId) && asStr(pl.TaskName) === OIL_TASK_NAME && asStr(pl.Status) !== 'เสร็จสิ้น' && asStr(pl.Status) !== STATUS_CANCEL);
  if (exists) return false;
  await dbInsert(env, 'MaintenancePlan', {
    VehicleID: vehicleId, TaskName: OIL_TASK_NAME, TaskType: 'เปลี่ยนน้ำมัน', IntervalMonths: null, IntervalMileage: asIntN(v.OilChangeFreqKm),
    LastDoneDate: asDateStr(v.LastOilChangeDate), LastDoneMileage: asNumN(v.LastOilChangeMileage),
    NextDueDate: nextSaturday(todayStr()), NextDueMileage: next, Status: 'ใช้งาน', Remark: 'สร้างอัตโนมัติจากการบันทึกเลขไมล์'
  }, sess.empId);
  return true;
}
async function Mileage_getMonth(env, p, sess) {
  requireRead(sess);
  const vehicleId = asInt(p.vehicleId), year = asInt(p.year), month = asInt(p.month);
  const v = await getVehicleRaw_(env, vehicleId); if (!v) return fail('ไม่พบรถ');
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const firstDay = year + '-' + pad(month) + '-01', lastDay = year + '-' + pad(month) + '-' + pad(daysInMonth);
  const reads = (await activeReadings_(env, vehicleId)).filter(r => r.date >= firstDay && r.date <= lastDay);
  const days = {}; reads.forEach(r => { days[Number(r.date.split('-')[2])] = r.mileage; });
  return ok({ vehicle: vehBrief_(v), daysInMonth, days, monthlyKm: monthlyKm_(reads) });
}
async function Mileage_delete(env, p, sess) {
  requireScreen(sess, 'pk_vehicle_mileage');
  const ex = await dbFindBy(env, 'MileageLog', 'MileageID', asInt(p.id));
  if (!ex) return fail('ไม่พบรายการ');
  const vehicleId = asInt(ex.VehicleID);
  await dbSoftDelete(env, 'MileageLog', ex, sess.empId);
  return ok({ currentMileage: await syncVehicleMileage_(env, vehicleId, sess.empId) });
}

/* ======================= routes ======================= */
const ROUTES = {
  'vehicle.list': Vehicle_list, 'vehicle.get': Vehicle_get, 'vehicle.lookup': Vehicle_lookup, 'vehicle.save': Vehicle_save, 'vehicle.delete': Vehicle_delete,
  'plan.dueSoon': Plan_dueSoon, 'plan.list': Plan_list, 'plan.get': Plan_get, 'plan.save': Plan_save, 'plan.delete': Plan_delete,
  'plan.renewRegistry': Plan_renewRegistry, 'plan.completePlan': Plan_completePlan, 'plan.renewOilChange': Plan_renewOilChange,
  'repair.list': Repair_list, 'repair.get': Repair_get, 'repair.save': Repair_save, 'repair.delete': Repair_delete,
  'log.list': Log_list, 'log.get': Log_get, 'log.save': Log_save, 'log.delete': Log_delete,
  'log.getReceipts': Log_getReceipts, 'log.uploadReceipt': Log_uploadReceipt, 'log.deleteReceipt': Log_deleteReceipt,
  'history.list': History_list, 'history.detail': History_detail, 'history.summary': History_summary,
  'mileage.list': Mileage_list, 'mileage.save': Mileage_save, 'mileage.saveMonth': Mileage_saveMonth, 'mileage.getMonth': Mileage_getMonth, 'mileage.delete': Mileage_delete
};
