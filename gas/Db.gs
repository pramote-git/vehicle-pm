/**
 * Db.gs — generic CRUD บน Google Sheets
 *  - 1 sheet = 1 ตาราง ; row แรก = header (ตาม SCHEMA)
 *  - row แทนด้วย object key=header
 *  - INT IDENTITY  -> nextId() (max+1 ภายใต้ ScriptLock)
 *  - soft-delete   -> set IsActive=0
 *  - audit cols    -> เติมอัตโนมัติ
 *
 * NOTE: ทุก WRITE ต้องอยู่ใน withLock() เพื่อกัน race (analog ของ TABLOCKX/transaction)
 */

function _ss_()            { return SpreadsheetApp.openById(_spreadsheetId_()); }
function _sheet_(name)     {
  var sh = _ss_().getSheetByName(name);
  if (!sh) throw new Error('ไม่พบ sheet: ' + name + ' (รัน Setup() ก่อน)');
  return sh;
}

// ครอบ write ทั้งหมดด้วย lock (serialize) — แทน SqlTransaction WITH(TABLOCKX)
function withLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); }
  finally { try { lock.releaseLock(); } catch (e) {} }
}

// อ่านทุกแถวเป็น array ของ object (รวมแถวที่ IsActive=0 ด้วย)
function dbReadRaw(name) {
  var sh = _sheet_(name);
  var rng = sh.getDataRange().getValues();
  if (rng.length < 2) return [];
  var head = rng[0];
  var out = [];
  for (var r = 1; r < rng.length; r++) {
    var row = rng[r];
    if (_isBlankRow_(row)) continue;
    var o = { _row: r + 1 };               // _row = เลขแถวจริงในชีต (1-based)
    for (var c = 0; c < head.length; c++) o[head[c]] = row[c];
    out.push(o);
  }
  return out;
}
function _isBlankRow_(row) {
  for (var i = 0; i < row.length; i++) if (row[i] !== '' && row[i] !== null) return false;
  return true;
}

// เฉพาะแถว active
function dbReadActive(name) {
  return dbReadRaw(name).filter(function (o) { return asBool(o.IsActive); });
}

function dbFindBy(name, col, val) {
  var rows = dbReadRaw(name);
  for (var i = 0; i < rows.length; i++) if (String(rows[i][col]) === String(val)) return rows[i];
  return null;
}

function dbNextId(name, idCol) {
  var rows = dbReadRaw(name);
  var max = 0;
  for (var i = 0; i < rows.length; i++) {
    var v = parseInt(rows[i][idCol], 10);
    if (!isNaN(v) && v > max) max = v;
  }
  return max + 1;
}

// insert : เติม id + audit แล้ว append ; คืน object ที่เพิ่ม (รวม id)
function dbInsert(name, obj, empId) {
  var sh = _sheet_(name);
  var head = SCHEMA[name];
  var idCol = head[0];
  if (obj[idCol] === undefined || obj[idCol] === null || obj[idCol] === '') {
    obj[idCol] = dbNextId(name, idCol);
  }
  if (head.indexOf('IsActive') >= 0 && (obj.IsActive === undefined)) obj.IsActive = 1;
  if (head.indexOf('CreatedBy') >= 0)   obj.CreatedBy   = empId || '';
  if (head.indexOf('CreatedDate') >= 0) obj.CreatedDate = nowStr();
  var rowArr = head.map(function (h) {
    var v = obj[h];
    return (v === undefined || v === null) ? '' : v;
  });
  sh.appendRow(rowArr);
  obj._row = sh.getLastRow();
  return obj;
}

// update : เขียนทับทั้งแถวตาม _row (merge ค่าใหม่ทับเดิม) + audit
function dbUpdate(name, existing, patch, empId) {
  var sh = _sheet_(name);
  var head = SCHEMA[name];
  var merged = {};
  head.forEach(function (h) { merged[h] = existing[h]; });
  Object.keys(patch).forEach(function (k) { if (head.indexOf(k) >= 0) merged[k] = patch[k]; });
  if (head.indexOf('UpdatedBy') >= 0)   merged.UpdatedBy   = empId || '';
  if (head.indexOf('UpdatedDate') >= 0) merged.UpdatedDate = nowStr();
  var rowArr = head.map(function (h) {
    var v = merged[h];
    return (v === undefined || v === null) ? '' : v;
  });
  sh.getRange(existing._row, 1, 1, head.length).setValues([rowArr]);
  merged._row = existing._row;
  return merged;
}

// soft-delete : IsActive=0
function dbSoftDelete(name, existing, empId) {
  return dbUpdate(name, existing, { IsActive: 0 }, empId);
}

// hard-delete แถว (ใช้เฉพาะ detail lines ของใบงาน — §1 ข้อ 4)
function dbDeleteRows(name, predicate) {
  var sh = _sheet_(name);
  var rows = dbReadRaw(name).filter(predicate);
  // ลบจากล่างขึ้นบน กัน index เลื่อน
  rows.sort(function (a, b) { return b._row - a._row; });
  rows.forEach(function (o) { sh.deleteRow(o._row); });
  return rows.length;
}
