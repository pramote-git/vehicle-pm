/**
 * Util.gs — helpers ที่ทุกโมดูลใช้ร่วม
 * mirror ของ Safe*, AddDecParam, Fmt helpers + date math จาก spec (§1, §5)
 */

// ---------- coercion (analog ของ Safe* readers) ----------
function asStr(v)  { return (v === null || v === undefined) ? '' : String(v).trim(); }
function asNum(v)  { if (v === '' || v === null || v === undefined) return 0;
                     var n = Number(v); return isNaN(n) ? 0 : n; }
function asNumN(v) { if (v === '' || v === null || v === undefined) return null;
                     var n = Number(v); return isNaN(n) ? null : n; }
function asBool(v) { var s = String(v).trim().toLowerCase();
                     return s === 'true' || s === '1' || s === 'yes' || v === true; }
function asInt(v)  { var n = asNum(v); return Math.trunc(n); }
function asIntN(v) { var n = asNumN(v); return n === null ? null : Math.trunc(n); }

// ---------- เงิน : ปัด 2 ตำแหน่ง away-from-zero (§5.2) ----------
function round2(n) {
  if (n === null || n === undefined || n === '') return 0;
  var x = Number(n);
  if (isNaN(x)) return 0;
  return Math.sign(x) * Math.round(Math.abs(x) * 100) / 100;
}

// ---------- date : เก็บ/ส่งเป็น yyyy-MM-dd (Gregorian, local time) ----------
// รับได้ทั้ง Date object (จาก Sheets) และ string -> คืน 'yyyy-MM-dd' หรือ ''
function asDateStr(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return '';
    return Utilities.formatDate(v, CFG.TZ, 'yyyy-MM-dd');
  }
  var s = String(v).trim();
  if (!s) return '';
  // 'yyyy-MM-dd' หรือ 'yyyy-MM-ddTHH:mm...' -> เอา 10 ตัวแรก
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  var d = new Date(s);
  return isNaN(d.getTime()) ? '' : Utilities.formatDate(d, CFG.TZ, 'yyyy-MM-dd');
}
function asDateTimeStr(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, CFG.TZ, 'yyyy-MM-dd HH:mm:ss');
  }
  var s = String(v).trim();
  var d = new Date(s.indexOf('T') >= 0 || s.indexOf(' ') >= 0 ? s : s + 'T00:00:00');
  return isNaN(d.getTime()) ? s : Utilities.formatDate(d, CFG.TZ, 'yyyy-MM-dd HH:mm:ss');
}

// แปลง 'yyyy-MM-dd' -> Date (เที่ยงวัน กัน DST เพี้ยน) หรือ null
function parseDate(s) {
  s = asDateStr(s);
  if (!s) return null;
  var p = s.split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12, 0, 0);
}
function addYears(s, y)  { var d = parseDate(s); if (!d) return ''; d.setFullYear(d.getFullYear() + y); return fmtIso(d); }
function addMonths(s, m) { var d = parseDate(s); if (!d) return ''; d.setMonth(d.getMonth() + m);       return fmtIso(d); }
function addDays(s, n)   { var d = parseDate(s); if (!d) return ''; d.setDate(d.getDate() + n);          return fmtIso(d); }
function fmtIso(d)       { return Utilities.formatDate(d, CFG.TZ, 'yyyy-MM-dd'); }
function todayStr()      { return Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd'); }
function nowStr()        { return Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd HH:mm:ss'); }

// จำนวนวันจาก today ถึง dateStr (อนาคต = บวก, อดีต = ลบ)
function daysFromToday(dateStr) {
  var d = parseDate(dateStr); if (!d) return null;
  var t = parseDate(todayStr());
  return Math.round((d.getTime() - t.getTime()) / 86400000);
}

// วันเสาร์ถัดไป (รวมวันนี้ถ้าวันนี้เสาร์) (§4.6 NextSaturday)
function nextSaturday(fromStr) {
  var d = parseDate(fromStr || todayStr());
  var add = (6 - d.getDay() + 7) % 7; // 6 = Saturday
  d.setDate(d.getDate() + add);
  return fmtIso(d);
}

// อายุรถ = completed years (§4.1) หรือ null
function vehicleAgeYears(regStr) {
  var d = parseDate(regStr); if (!d) return null;
  var t = parseDate(todayStr());
  var y = t.getFullYear() - d.getFullYear();
  var before = (t.getMonth() < d.getMonth()) ||
               (t.getMonth() === d.getMonth() && t.getDate() < d.getDate());
  if (before) y -= 1;
  return Math.max(0, y);
}

// ---------- gen เลขเอกสาร (LockService = analog ของ TABLOCKX) (§5.3) ----------
// prefix เช่น 'VR' / 'ML' ; reset running number ทุกเดือน (yyMM)
function genDocNo(sheetName, col, prefix) {
  var ym = Utilities.formatDate(new Date(), CFG.TZ, 'yyMM');
  var pre = prefix + ym + '-';
  var rows = dbReadRaw(sheetName);
  var max = 0;
  for (var i = 0; i < rows.length; i++) {
    var v = asStr(rows[i][col]);
    if (v.indexOf(pre) === 0) {
      var seq = parseInt(v.substring(pre.length), 10);
      if (!isNaN(seq) && seq > max) max = seq;
    }
  }
  return pre + ('00' + (max + 1)).slice(-3);
}

// ---------- response helpers ----------
function ok(obj)        { return _json(Object.assign({ success: true }, obj || {})); }
function fail(msg)      { return _json({ success: false, error: msg }); }
function listJson(arr)  { return _json(arr); }
function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// validation: length cap (ตรงกับ NVARCHAR ใน spec) คืน error ตัวแรก หรือ null
function capErr(label, value, max) {
  if (asStr(value).length > max) return label + ' ยาวเกิน ' + max + ' ตัวอักษร';
  return null;
}
function reqErr(label, value) {
  if (!asStr(value)) return 'กรุณากรอก' + label;
  return null;
}
