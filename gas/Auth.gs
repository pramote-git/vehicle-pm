/**
 * Auth.gs — login + session token + permission gate (mirror §1 Authorization)
 *  - token เก็บใน CacheService (TTL 6 ชม.) ; client ส่งทุก request ผ่าน field `token`
 *  - สิทธิ์เก็บใน Users.AllowedMenus (csv ของ pk_vehicle_*) + IsAdmin
 */

function hashPassword_(pw) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'pk_salt::' + pw);
  return raw.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

// login -> { token, empId, empName, isAdmin, allowedMenus[] }
function doLogin(empId, password) {
  var u = dbFindBy(CFG.SHEETS.USER, 'EmpId', empId);
  if (!u || !asBool(u.IsActive)) return fail('ไม่พบผู้ใช้ หรือถูกระงับการใช้งาน');
  if (asStr(u.PasswordHash) !== hashPassword_(password)) return fail('รหัสผ่านไม่ถูกต้อง');

  var token = Utilities.getUuid().replace(/-/g, '');
  var sess = {
    empId: asStr(u.EmpId),
    empName: asStr(u.EmpName),
    isAdmin: asBool(u.IsAdmin),
    allowedMenus: asStr(u.AllowedMenus).split(',').map(function (s){return s.trim();}).filter(String)
  };
  CacheService.getScriptCache().put('sess_' + token, JSON.stringify(sess), CFG.SESSION_TTL_SEC);
  return ok({ token: token, user: sess });
}

function getSession(token) {
  if (!token) return null;
  var raw = CacheService.getScriptCache().get('sess_' + token);
  if (!raw) return null;
  try {
    var s = JSON.parse(raw);
    // refresh TTL (sliding)
    CacheService.getScriptCache().put('sess_' + token, raw, CFG.SESSION_TTL_SEC);
    return s;
  } catch (e) { return null; }
}

function doLogout(token) {
  if (token) CacheService.getScriptCache().remove('sess_' + token);
  return ok({});
}

// ----- permission helpers (§1) -----
function isSuperAdmin(sess)        { return !!(sess && sess.isAdmin); }
function canReadModule(sess) {
  if (!sess) return false;
  if (sess.isAdmin) return true;
  return (sess.allowedMenus || []).some(function (m) { return m.indexOf('pk_vehicle_') === 0; });
}
function canUseScreen(sess, key) {
  if (!sess) return false;
  if (sess.isAdmin) return true;
  return (sess.allowedMenus || []).indexOf(key) >= 0;
}

// throw object ที่ router แปลงเป็น 403/ข้อความ
function requireRead(sess) {
  if (!canReadModule(sess)) throw { _forbid: true, msg: 'ไม่มีสิทธิ์เข้าถึงข้อมูล' };
}
function requireScreen(sess, key) {
  if (!canUseScreen(sess, key)) throw { _forbid: true, msg: 'ไม่มีสิทธิ์ใช้งานเมนูนี้' };
}
