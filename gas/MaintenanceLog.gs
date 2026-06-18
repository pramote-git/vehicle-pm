/**
 * MaintenanceLog.gs — เมนู 4 บันทึกการซ่อม/บำรุงรักษา (ซับซ้อนสุด)
 * key: pk_vehicle_log
 * LogNo : ML{yyMM}-{seq:000}
 *
 * Save = 1 หน่วยงานเดียว (withLock):
 *   1) gen LogNo (ถ้าใหม่)
 *   2) PartsCost = Σ round2(qty*price) ; TotalCost = round2(Labor + Parts)  (server-side)
 *   3) upsert header
 *   4) ลบ detail เดิมทั้งหมด -> re-insert line ที่ไม่ว่าง (replace strategy)
 *   5) ไม่แตะ Vehicle.CurrentMileage (เมนู 6 ผู้เขียน)
 *   6) ถ้ามี PlanID -> RollPlanForward
 *   7) ถ้ามี RequestID -> sync สถานะใบแจ้งซ่อม
 */

var FILE_MODULE = 'vehicle_log';   // scope ของไฟล์แนบ (IDOR guard)

function logHeaderOut_(o, vmap) {
  var v = vmap[asInt(o.VehicleID)] || {};
  return {
    LogID: asInt(o.LogID),
    LogNo: asStr(o.LogNo),
    VehicleID: asInt(o.VehicleID),
    LicensePlate: asStr(v.LicensePlate),
    VehicleCode: asStr(v.VehicleCode),
    Brand: asStr(v.Brand),
    Model: asStr(v.Model),
    RequestID: asIntN(o.RequestID),
    PlanID: asIntN(o.PlanID),
    MaintenanceType: asStr(o.MaintenanceType) || 'ซ่อม',
    ServiceDate: asDateStr(o.ServiceDate),
    CompletedDate: asDateStr(o.CompletedDate),
    Mileage: asNumN(o.Mileage),
    WorkDescription: asStr(o.WorkDescription),
    PerformedByEmpId: asStr(o.PerformedByEmpId),
    PerformedByName: asStr(o.PerformedByName),
    VendorName: asStr(o.VendorName),
    LaborCost: asNum(o.LaborCost),
    PartsCost: asNum(o.PartsCost),
    TotalCost: asNum(o.TotalCost),
    Status: asStr(o.Status) || 'เสร็จสิ้น',
    Remark: asStr(o.Remark)
  };
}
function logDetailOut_(d) {
  return {
    DetailID: asInt(d.DetailID),
    LogID: asInt(d.LogID),
    ItemName: asStr(d.ItemName),
    ItemCode: asStr(d.ItemCode),
    Quantity: asNum(d.Quantity),
    UnitName: asStr(d.UnitName),
    UnitPrice: asNum(d.UnitPrice),
    Amount: asNum(d.Amount),
    Remark: asStr(d.Remark)
  };
}

function Log_list(p, sess) {
  requireRead(sess);
  var vmap = vehMap_();
  var vehicleId = asIntN(p.vehicleId);
  var status = asStr(p.status);
  var search = asStr(p.search).toLowerCase();
  var rows = dbReadActive(CFG.SHEETS.LOG).filter(function (o) {
    if (vehicleId && asInt(o.VehicleID) !== vehicleId) return false;
    if (status && asStr(o.Status) !== status) return false;
    if (search) {
      var v = vmap[asInt(o.VehicleID)] || {};
      var hay = [o.LogNo, o.WorkDescription, o.VendorName, v.LicensePlate]
        .map(asStr).join(' ').toLowerCase();
      if (hay.indexOf(search) < 0) return false;
    }
    return true;
  }).map(function (o) { return logHeaderOut_(o, vmap); });
  rows.sort(function (a, b) {
    var c = (b.ServiceDate || '').localeCompare(a.ServiceDate || '');
    return c !== 0 ? c : b.LogID - a.LogID;             // ServiceDate DESC, LogID DESC
  });
  return listJson(rows);
}

function Log_get(p, sess) {
  requireRead(sess);
  var o = dbFindBy(CFG.SHEETS.LOG, 'LogID', asInt(p.id));
  if (!o || !asBool(o.IsActive)) return fail('ไม่พบใบงาน');
  var items = dbReadRaw(CFG.SHEETS.LOG_DETAIL)
    .filter(function (d) { return asInt(d.LogID) === asInt(p.id); })
    .map(logDetailOut_);
  return ok({ data: logHeaderOut_(o, vehMap_()), items: items });
}

// line ว่าง : ไม่มี ItemName/Code/Unit/Remark และ price 0/null (Quantity ไม่นับ — default=1) §8.8
function isLogRowEmpty_(it) {
  var hasText = asStr(it.ItemName) || asStr(it.ItemCode) || asStr(it.UnitName) || asStr(it.Remark);
  var price = asNum(it.UnitPrice);
  return !hasText && price === 0;
}

function Log_save(p, sess) {
  requireScreen(sess, 'pk_vehicle_log');
  var h = p.header || {};
  var items = Array.isArray(p.items) ? p.items : [];
  if (!asInt(h.VehicleID)) return fail('กรุณาเลือกรถ');

  return withLock(function () {
    if (!getVehicleRaw_(h.VehicleID)) return fail('ไม่พบรถที่เลือก');

    // 2) คำนวณยอด server-side
    var cleanItems = items.filter(function (it) { return !isLogRowEmpty_(it); });
    var partsCost = 0;
    cleanItems.forEach(function (it) {
      it._amount = round2(asNum(it.Quantity) * asNum(it.UnitPrice));
      partsCost += it._amount;
    });
    partsCost = round2(partsCost);
    var laborCost = asNum(h.LaborCost);
    var totalCost = round2(laborCost + partsCost);

    var headerPatch = {
      VehicleID: asInt(h.VehicleID),
      RequestID: asIntN(h.RequestID),
      PlanID: asIntN(h.PlanID),
      MaintenanceType: asStr(h.MaintenanceType) || 'ซ่อม',
      ServiceDate: asDateStr(h.ServiceDate) || todayStr(),
      CompletedDate: asDateStr(h.CompletedDate),
      Mileage: asNumN(h.Mileage),
      WorkDescription: asStr(h.WorkDescription),
      PerformedByEmpId: asStr(h.PerformedByEmpId) || sess.empId,
      PerformedByName: asStr(h.PerformedByName) || sess.empName,
      VendorName: asStr(h.VendorName),
      LaborCost: laborCost,
      PartsCost: partsCost,    // AUTO
      TotalCost: totalCost,    // AUTO
      Status: asStr(h.Status) || 'เสร็จสิ้น',
      Remark: asStr(h.Remark)
    };

    var logId = asInt(h.LogID);
    var saved;
    try {
      if (logId === 0) {
        headerPatch.LogNo = genDocNo(CFG.SHEETS.LOG, 'LogNo', 'ML');
        saved = dbInsert(CFG.SHEETS.LOG, headerPatch, sess.empId);
        logId = saved.LogID;
      } else {
        var ex = dbFindBy(CFG.SHEETS.LOG, 'LogID', logId);
        if (!ex || !asBool(ex.IsActive)) return fail('ไม่พบใบงาน');
        saved = dbUpdate(CFG.SHEETS.LOG, ex, headerPatch, sess.empId);
      }
    } catch (e) {
      console.error('Log_save header: ' + e);
      return fail('เลขที่เอกสารซ้ำ กรุณาบันทึกอีกครั้ง');
    }

    // 4) ลบ detail เดิมทั้งหมด -> re-insert
    dbDeleteRows(CFG.SHEETS.LOG_DETAIL, function (d) { return asInt(d.LogID) === asInt(logId); });
    cleanItems.forEach(function (it) {
      dbInsert(CFG.SHEETS.LOG_DETAIL, {
        LogID: logId,
        ItemName: asStr(it.ItemName),
        ItemCode: asStr(it.ItemCode),
        Quantity: asNum(it.Quantity) || 1,
        UnitName: asStr(it.UnitName),
        UnitPrice: asNum(it.UnitPrice),
        Amount: it._amount,         // AUTO
        Remark: asStr(it.Remark)
      }, sess.empId);
    });

    // 6) roll plan forward
    if (asInt(headerPatch.PlanID)) rollPlanForward_(headerPatch.PlanID, headerPatch.ServiceDate, headerPatch.Mileage, sess.empId);

    // 7) sync request status
    if (asInt(headerPatch.RequestID)) {
      var st = headerPatch.Status;
      if (st === 'เสร็จสิ้น') setRequestStatus_(headerPatch.RequestID, 'เสร็จสิ้น', sess.empId);
      else if (st === CFG.STATUS_CANCEL) recomputeRequestStatus_(headerPatch.RequestID, sess.empId);
      else setRequestStatus_(headerPatch.RequestID, 'กำลังซ่อม', sess.empId);
    }

    return ok({ id: logId, logNo: asStr(saved.LogNo) });
  });
}

function rollPlanForward_(planId, serviceDate, mileage, empId) {
  var pl = dbFindBy(CFG.SHEETS.PLAN, 'PlanID', asInt(planId));
  if (!pl || !asBool(pl.IsActive)) return;
  var months = asIntN(pl.IntervalMonths), milv = asIntN(pl.IntervalMileage);
  var lastDate = asDateStr(serviceDate) || todayStr();
  var lastMile = asNumN(mileage);
  dbUpdate(CFG.SHEETS.PLAN, pl, {
    LastDoneDate: lastDate,
    LastDoneMileage: lastMile,
    NextDueDate: (months && months > 0) ? addMonths(lastDate, months) : '',
    NextDueMileage: (milv && milv > 0 && lastMile !== null) ? lastMile + milv : asNumN(pl.NextDueMileage)
  }, empId);
}

function Log_delete(p, sess) {
  requireScreen(sess, 'pk_vehicle_log');
  return withLock(function () {
    var ex = dbFindBy(CFG.SHEETS.LOG, 'LogID', asInt(p.id));
    if (!ex) return fail('ไม่พบใบงาน');
    var requestId = asIntN(ex.RequestID);
    dbSoftDelete(CFG.SHEETS.LOG, ex, sess.empId);
    if (asInt(requestId)) recomputeRequestStatus_(requestId, sess.empId);  // ห้ามค้าง เสร็จสิ้น §8.7
    return ok({});
  });
}

// ====================== ไฟล์แนบใบเสร็จ (Google Drive) §6 ======================

function _driveFolder_() {
  var id = _driveFolderId_();
  if (!id) throw new Error('ยังไม่ได้ตั้งค่า DRIVE_FOLDER_ID');
  return DriveApp.getFolderById(id);
}

function Log_getReceipts(p, sess) {
  requireRead(sess);
  var logId = asInt(p.logId);
  var rows = dbReadActive(CFG.SHEETS.RECEIPT).filter(function (r) {
    return asStr(r.Module) === FILE_MODULE && asInt(r.RefID) === logId;  // IDOR guard
  }).map(function (r) {
    return {
      ReceiptID: asInt(r.ReceiptID),
      FileName: asStr(r.FileName),
      ContentType: asStr(r.ContentType),
      FileSize: asNum(r.FileSize),
      url: '?action=log.downloadReceipt&id=' + asInt(r.ReceiptID) + '&token=' + encodeURIComponent(p.token)
    };
  });
  return listJson(rows);
}

// files: [{ fileName, contentType, dataBase64 }]
function Log_uploadReceipt(p, sess) {
  requireScreen(sess, 'pk_vehicle_log');
  var logId = asInt(p.logId);
  if (logId <= 0) return fail('กรุณาบันทึกใบงานก่อนแนบไฟล์');
  var files = Array.isArray(p.files) ? p.files : [];
  if (!files.length) return fail('ไม่มีไฟล์');

  return withLock(function () {
    var folder = _driveFolder_();
    var saved = [];
    files.forEach(function (f) {
      var bytes = Utilities.base64Decode(asStr(f.dataBase64));
      var blob = Utilities.newBlob(bytes, asStr(f.contentType) || 'application/octet-stream', asStr(f.fileName) || 'receipt');
      var driveFile = folder.createFile(blob);
      var rec = dbInsert(CFG.SHEETS.RECEIPT, {
        Module: FILE_MODULE,
        RefID: logId,
        DriveFileId: driveFile.getId(),
        FileName: asStr(f.fileName) || driveFile.getName(),
        ContentType: asStr(f.contentType),
        FileSize: bytes.length
      }, sess.empId);
      saved.push({ ReceiptID: rec.ReceiptID, FileName: rec.FileName });
    });
    return ok({ files: saved });
  });
}

function Log_downloadReceipt(p, sess) {
  requireRead(sess);
  var rec = dbFindBy(CFG.SHEETS.RECEIPT, 'ReceiptID', asInt(p.id));
  if (!rec || !asBool(rec.IsActive) || asStr(rec.Module) !== FILE_MODULE)   // IDOR guard
    return fail('ไม่พบไฟล์');
  var file = DriveApp.getFileById(asStr(rec.DriveFileId));
  var blob = file.getBlob();
  return ContentService
    .createTextOutput(Utilities.base64Encode(blob.getBytes()))
    .setMimeType(ContentService.MimeType.TEXT);   // client decode base64 -> download
}

function Log_deleteReceipt(p, sess) {
  requireScreen(sess, 'pk_vehicle_log');
  return withLock(function () {
    var rec = dbFindBy(CFG.SHEETS.RECEIPT, 'ReceiptID', asInt(p.id));
    if (!rec || !asBool(rec.IsActive) || asStr(rec.Module) !== FILE_MODULE) return fail('ไม่พบไฟล์');
    try { DriveApp.getFileById(asStr(rec.DriveFileId)).setTrashed(true); } catch (e) {}
    dbSoftDelete(CFG.SHEETS.RECEIPT, rec, sess.empId);
    return ok({});
  });
}
