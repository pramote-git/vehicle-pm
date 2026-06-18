/**
 * Code.gs — Web App entry + router (analog ของ MVC controllers)
 *
 * Frontend (GitHub Pages) เรียกแบบ:
 *   POST <webapp-url>  body = JSON { action, token, ...params }  (content-type text/plain กัน CORS preflight)
 *   GET  <webapp-url>?action=...&token=...                       (สำหรับ download ไฟล์)
 *
 * ทุก response เป็น JSON :
 *   สำเร็จ -> { success:true, ... }  หรือ array ตรงๆ (สำหรับ list)
 *   ล้มเหลว -> { success:false, error:"..." }
 */

function doGet(e)  { return handle_(e, 'GET'); }
function doPost(e) { return handle_(e, 'POST'); }

function handle_(e, method) {
  var params = {};
  try {
    if (method === 'POST' && e.postData && e.postData.contents) {
      params = JSON.parse(e.postData.contents);
    } else if (e.parameter) {
      params = e.parameter;
    }
  } catch (parseErr) {
    return fail('คำขอไม่ถูกต้อง');
  }

  var action = asStr(params.action);
  var sess = getSession(params.token);

  try {
    // --- public actions ---
    if (action === 'login')  return doLogin(asStr(params.empId), asStr(params.password));
    if (action === 'logout') return doLogout(params.token);
    if (action === 'me') {
      if (!sess) return fail('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
      return ok({ user: sess });
    }
    if (action === 'health') return ok({ status: 'ok', time: nowStr() });

    if (!sess) return fail('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');

    var fn = ROUTES[action];
    if (!fn) return fail('ไม่รู้จักคำสั่ง: ' + action);
    return fn(params, sess);

  } catch (err) {
    if (err && err._forbid) return fail(err.msg || 'ไม่มีสิทธิ์ดำเนินการ');
    // log เต็ม server-side, ตอบ client กลางๆ (§1 ข้อ 11)
    console.error('action=' + action + ' err=' + (err && err.stack ? err.stack : err));
    return fail('เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
  }
}

// action -> handler (กระจายไปแต่ละโมดูล)
var ROUTES = {
  // เมนู 1 ทะเบียนรถ
  'vehicle.list':   Vehicle_list,
  'vehicle.get':    Vehicle_get,
  'vehicle.lookup': Vehicle_lookup,
  'vehicle.save':   Vehicle_save,
  'vehicle.delete': Vehicle_delete,
  // เมนู 2 แผน PM + reminder
  'plan.dueSoon':       Plan_dueSoon,
  'plan.list':          Plan_list,
  'plan.get':           Plan_get,
  'plan.save':          Plan_save,
  'plan.delete':        Plan_delete,
  'plan.renewRegistry': Plan_renewRegistry,
  'plan.completePlan':  Plan_completePlan,
  'plan.renewOilChange':Plan_renewOilChange,
  // เมนู 3 แจ้งซ่อม
  'repair.list':   Repair_list,
  'repair.get':    Repair_get,
  'repair.save':   Repair_save,
  'repair.delete': Repair_delete,
  // เมนู 4 บันทึกซ่อม/บำรุง
  'log.list':          Log_list,
  'log.get':           Log_get,
  'log.save':          Log_save,
  'log.delete':        Log_delete,
  'log.getReceipts':   Log_getReceipts,
  'log.uploadReceipt': Log_uploadReceipt,
  'log.deleteReceipt': Log_deleteReceipt,
  'log.downloadReceipt': Log_downloadReceipt,
  // เมนู 5 ประวัติ
  'history.list':    History_list,
  'history.detail':  History_detail,
  'history.summary': History_summary,
  // เมนู 6 เลขไมล์
  'mileage.list':     Mileage_list,
  'mileage.save':     Mileage_save,
  'mileage.saveMonth':Mileage_saveMonth,
  'mileage.getMonth': Mileage_getMonth,
  'mileage.delete':   Mileage_delete
};
