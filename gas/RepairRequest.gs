/**
 * RepairRequest.gs — เมนู 3 แจ้งซ่อมรถยนต์
 * key: pk_vehicle_repair
 * RequestNo : VR{yyMM}-{seq:000} ; สถานะ sync จากเมนู 4
 */

function repairOut_(o, vmap) {
  var v = vmap[asInt(o.VehicleID)] || {};
  return {
    RequestID: asInt(o.RequestID),
    RequestNo: asStr(o.RequestNo),
    VehicleID: asInt(o.VehicleID),
    LicensePlate: asStr(v.LicensePlate),
    VehicleCode: asStr(v.VehicleCode),
    Brand: asStr(v.Brand),
    Model: asStr(v.Model),
    ReportDate: asDateTimeStr(o.ReportDate),
    ReportedByEmpId: asStr(o.ReportedByEmpId),
    ReportedByName: asStr(o.ReportedByName),
    ProblemDescription: asStr(o.ProblemDescription),
    Severity: asStr(o.Severity),
    CurrentMileage: asNumN(o.CurrentMileage),
    Status: asStr(o.Status) || 'รอดำเนินการ',
    Remark: asStr(o.Remark)
  };
}

function Repair_list(p, sess) {
  requireRead(sess);
  var vmap = vehMap_();
  var dateFrom = asDateStr(p.dateFrom);
  var dateTo = asDateStr(p.dateTo);
  var vehicleId = asIntN(p.vehicleId);
  var status = asStr(p.status);
  var search = asStr(p.search).toLowerCase();

  var rows = dbReadActive(CFG.SHEETS.REPAIR).filter(function (o) {
    var rd = asDateStr(o.ReportDate);
    if (dateFrom && rd < dateFrom) return false;
    if (dateTo && rd > dateTo) return false;             // dateTo inclusive (เทียบเป็นวัน)
    if (vehicleId && asInt(o.VehicleID) !== vehicleId) return false;
    if (status && asStr(o.Status) !== status) return false;
    if (search) {
      var v = vmap[asInt(o.VehicleID)] || {};
      var hay = [o.RequestNo, o.ProblemDescription, o.ReportedByName, v.LicensePlate]
        .map(asStr).join(' ').toLowerCase();
      if (hay.indexOf(search) < 0) return false;
    }
    return true;
  }).map(function (o) { return repairOut_(o, vmap); });
  rows.sort(function (a, b) {
    return (b.ReportDate || '').localeCompare(a.ReportDate || '');   // ReportDate DESC
  });
  return listJson(rows);
}

function Repair_get(p, sess) {
  requireRead(sess);
  var o = dbFindBy(CFG.SHEETS.REPAIR, 'RequestID', asInt(p.id));
  if (!o || !asBool(o.IsActive)) return fail('ไม่พบใบแจ้งซ่อม');
  return ok({ data: repairOut_(o, vehMap_()) });
}

function Repair_save(p, sess) {
  requireScreen(sess, 'pk_vehicle_repair');
  if (!asInt(p.VehicleID)) return fail('กรุณาเลือกรถ');
  if (!asStr(p.ProblemDescription)) return fail('กรุณากรอกอาการ/ปัญหา');
  var capE = capErr('หมายเหตุ', p.Remark, 500);
  if (capE) return fail(capE);

  return withLock(function () {
    if (!getVehicleRaw_(p.VehicleID)) return fail('ไม่พบรถที่เลือก');
    var id = asInt(p.RequestID);
    var patch = {
      VehicleID: asInt(p.VehicleID),
      ReportedByEmpId: sess.empId,                       // จาก session เสมอ
      ReportedByName: asStr(p.ReportedByName) || sess.empName,
      ProblemDescription: asStr(p.ProblemDescription),
      Severity: asStr(p.Severity),
      CurrentMileage: asNumN(p.CurrentMileage),
      Remark: asStr(p.Remark)
    };
    try {
      if (id === 0) {
        patch.RequestNo = genDocNo(CFG.SHEETS.REPAIR, 'RequestNo', 'VR');
        patch.ReportDate = asDateTimeStr(p.ReportDate) || nowStr();
        patch.Status = asStr(p.Status) || 'รอดำเนินการ';
        var ins = dbInsert(CFG.SHEETS.REPAIR, patch, sess.empId);
        return ok({ id: ins.RequestID, requestNo: ins.RequestNo });
      }
      var ex = dbFindBy(CFG.SHEETS.REPAIR, 'RequestID', id);
      if (!ex || !asBool(ex.IsActive)) return fail('ไม่พบใบแจ้งซ่อม');
      // คง RequestNo เดิม, อนุญาตแก้ Status ด้วยมือ
      if (asStr(p.Status)) patch.Status = asStr(p.Status);
      dbUpdate(CFG.SHEETS.REPAIR, ex, patch, sess.empId);
      return ok({ id: id, requestNo: asStr(ex.RequestNo) });
    } catch (e) {
      console.error('Repair_save: ' + e);
      return fail('เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
    }
  });
}

function Repair_delete(p, sess) {
  requireScreen(sess, 'pk_vehicle_repair');
  return withLock(function () {
    var ex = dbFindBy(CFG.SHEETS.REPAIR, 'RequestID', asInt(p.id));
    if (!ex) return fail('ไม่พบใบแจ้งซ่อม');
    dbSoftDelete(CFG.SHEETS.REPAIR, ex, sess.empId);
    return ok({});
  });
}

// ----- ใช้โดยเมนู 4 : sync/recompute สถานะใบแจ้งซ่อม (§4.4) -----
function recomputeRequestStatus_(requestId, empId) {
  if (!asInt(requestId)) return;
  var req = dbFindBy(CFG.SHEETS.REPAIR, 'RequestID', asInt(requestId));
  if (!req || !asBool(req.IsActive)) return;
  var logs = dbReadActive(CFG.SHEETS.LOG).filter(function (l) {
    return asInt(l.RequestID) === asInt(requestId);
  });
  var status;
  if (logs.length === 0) status = 'รอดำเนินการ';
  else if (logs.some(function (l) { return asStr(l.Status) === 'เสร็จสิ้น'; })) status = 'เสร็จสิ้น';
  else status = 'กำลังซ่อม';
  if (asStr(req.Status) !== status) dbUpdate(CFG.SHEETS.REPAIR, req, { Status: status }, empId);
}

function setRequestStatus_(requestId, status, empId) {
  if (!asInt(requestId)) return;
  var req = dbFindBy(CFG.SHEETS.REPAIR, 'RequestID', asInt(requestId));
  if (!req || !asBool(req.IsActive)) return;
  if (asStr(req.Status) !== status) dbUpdate(CFG.SHEETS.REPAIR, req, { Status: status }, empId);
}
