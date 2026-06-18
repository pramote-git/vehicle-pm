/**
 * Setup.gs — รันครั้งเดียวจาก Apps Script editor (เลือกฟังก์ชัน Setup แล้วกด Run)
 *  - สร้าง sheet ทุกตารางตาม SCHEMA (idempotent : มีแล้วไม่สร้างซ้ำ)
 *  - seed admin user (admin / admin123)  -> เปลี่ยนรหัสหลัง login ครั้งแรก
 */

/**
 * bootstrapProps() — ทางลัด: set Script Properties แล้วรัน Setup() ให้เลยในครั้งเดียว
 * เลือกฟังก์ชันนี้ใน editor แล้วกด Run หนึ่งครั้ง (จะถามสิทธิ์ Sheets + Drive)
 * รันเสร็จแล้วลบ/ปล่อยทิ้งไว้ก็ได้ (idempotent — รันซ้ำไม่พัง)
 */
function bootstrapProps() {
  PropertiesService.getScriptProperties().setProperties({
    SPREADSHEET_ID:  'ใส่_SPREADSHEET_ID_ของคุณ',
    DRIVE_FOLDER_ID: 'ใส่_DRIVE_FOLDER_ID_ของคุณ'
  });
  Logger.log('Script properties ตั้งค่าแล้ว — กำลังรัน Setup...');
  Setup();
}

function Setup() {
  var ss = _ss_();
  Object.keys(SCHEMA).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    var head = SCHEMA[name];
    var have = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0];
    var same = head.length === have.length && head.every(function (h, i) { return have[i] === h; });
    if (!same) {
      sh.getRange(1, 1, 1, head.length).setValues([head]);
      sh.setFrozenRows(1);
    }
  });
  // ลบ sheet ว่างชื่อ default ถ้ามี
  var def = ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);

  seedAdmin_();
  Logger.log('Setup เสร็จสิ้น — sheet พร้อมใช้งาน, admin user = admin / admin123');
}

function seedAdmin_() {
  var existing = dbFindBy(CFG.SHEETS.USER, 'EmpId', 'admin');
  if (existing) return;
  withLock(function () {
    dbInsert(CFG.SHEETS.USER, {
      EmpId: 'admin',
      EmpName: 'ผู้ดูแลระบบ',
      PasswordHash: hashPassword_('admin123'),
      IsAdmin: true,
      AllowedMenus: CFG.MENU_KEYS.join(','),
      IsActive: 1
    }, 'system');
  });
}

/** ใช้สร้าง/แก้ user เพิ่มเอง (รันจาก editor) */
function addUser(empId, empName, password, isAdmin, allowedMenusCsv) {
  withLock(function () {
    var ex = dbFindBy(CFG.SHEETS.USER, 'EmpId', empId);
    var patch = {
      EmpId: empId, EmpName: empName, PasswordHash: hashPassword_(password),
      IsAdmin: !!isAdmin, AllowedMenus: allowedMenusCsv || '', IsActive: 1
    };
    if (ex) dbUpdate(CFG.SHEETS.USER, ex, patch, 'system');
    else dbInsert(CFG.SHEETS.USER, patch, 'system');
  });
  Logger.log('saved user: ' + empId);
}
