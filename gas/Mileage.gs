/**
 * Mileage.gs — เมนู 6 บันทึกเลขไมล์ (single source of truth ของ CurrentMileage)
 * key: pk_vehicle_mileage
 *
 * กฎสำคัญ (§4.6, §8):
 *  - controller นี้คือผู้เขียน Vehicle.CurrentMileage คนเดียว (SyncVehicleMileage)
 *  - odometer guard : ห้ามถอยหลัง / ห้าม jump > 50,000
 *  - UPSERT by (VehicleID, MileageDate) : กัน active ซ้ำต่อวัน
 *  - SaveMonth : กริดทั้งเดือน + auto สร้างแผนเปลี่ยนน้ำมัน
 *  - MonthlyKm = Σ max(0, r[i]-r[i-1])
 */

function activeReadings_(vehicleId) {
  return dbReadActive(CFG.SHEETS.MILEAGE)
    .filter(function (o) { return asInt(o.VehicleID) === asInt(vehicleId); })
    .map(function (o) {
      return { _row: o._row, MileageID: asInt(o.MileageID), date: asDateStr(o.MileageDate),
               mileage: asNum(o.Mileage), raw: o };
    });
}

// max active reading (ยกเว้นบางแถว) ; คืน null ถ้าไม่มี
function maxActiveMileage_(vehicleId, excludeRow) {
  var max = null;
  activeReadings_(vehicleId).forEach(function (r) {
    if (excludeRow && r._row === excludeRow) return;
    if (max === null || r.mileage > max) max = r.mileage;
  });
  return max;
}

// คืน error string หรือ null
function odoGuard_(value, baseline) {
  if (baseline === null || baseline === undefined) return null;
  if (value < baseline) return 'เลขไมล์ (' + value + ') น้อยกว่าค่าล่าสุด (' + baseline + ') — ถอยหลังไม่ได้';
  if (value - baseline > CFG.ODO_MAX_JUMP) return 'เลขไมล์กระโดดผิดปกติ (เพิ่มเกิน ' + CFG.ODO_MAX_JUMP + ' กม.) ตรวจสอบการพิมพ์';
  return null;
}

// Vehicle.CurrentMileage = reading ล่าสุด (MileageDate DESC, MileageID DESC)
function syncVehicleMileage_(vehicleId, empId) {
  var reads = activeReadings_(vehicleId);
  reads.sort(function (a, b) {
    var c = b.date.localeCompare(a.date);
    return c !== 0 ? c : b.MileageID - a.MileageID;
  });
  var cur = reads.length ? reads[0].mileage : 0;
  var v = getVehicleRaw_(vehicleId);
  if (v) dbUpdate(CFG.SHEETS.VEHICLE, v, { CurrentMileage: cur }, empId);
  return cur;
}

// Σ max(0, r[i]-r[i-1]) ของรายการเรียงตามวัน
function monthlyKm_(readings) {
  var s = readings.slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
  if (s.length < 2) return 0;
  var sum = 0;
  for (var i = 1; i < s.length; i++) sum += Math.max(0, s[i].mileage - s[i - 1].mileage);
  return round2(sum);
}

function Mileage_list(p, sess) {
  requireRead(sess);
  var vehicleId = asInt(p.vehicleId);
  if (!vehicleId) return listJson([]);
  var reads = activeReadings_(vehicleId).map(function (r) {
    return { MileageID: r.MileageID, MileageDate: r.date, Mileage: r.mileage,
             RecordedByName: asStr(r.raw.RecordedByName), Remark: asStr(r.raw.Remark) };
  });
  reads.sort(function (a, b) { return b.MileageDate.localeCompare(a.MileageDate); });
  return listJson(reads);
}

// บันทึกรายวันเดี่ยว
function Mileage_save(p, sess) {
  requireScreen(sess, 'pk_vehicle_mileage');
  var vehicleId = asInt(p.VehicleID);
  if (!vehicleId) return fail('กรุณาเลือกรถ');
  var date = asDateStr(p.MileageDate) || todayStr();
  var mileage = asNumN(p.Mileage);
  if (mileage === null || mileage < 0) return fail('กรุณากรอกเลขไมล์ที่ถูกต้อง');

  return withLock(function () {
    if (!getVehicleRaw_(vehicleId)) return fail('ไม่พบรถที่เลือก');
    // หาแถว active ของวันนั้น (ถ้ามี = แถวที่กำลังแก้)
    var sameDay = activeReadings_(vehicleId).filter(function (r) { return r.date === date; })[0];
    var baseline = maxActiveMileage_(vehicleId, sameDay ? sameDay._row : null);
    var gErr = odoGuard_(mileage, baseline);
    if (gErr) return fail(gErr);

    if (sameDay) {
      dbUpdate(CFG.SHEETS.MILEAGE, sameDay.raw, {
        Mileage: mileage, RecordedByEmpId: sess.empId,
        RecordedByName: asStr(p.RecordedByName) || sess.empName, Remark: asStr(p.Remark)
      }, sess.empId);
    } else {
      dbInsert(CFG.SHEETS.MILEAGE, {
        VehicleID: vehicleId, MileageDate: date, Mileage: mileage,
        RecordedByEmpId: sess.empId, RecordedByName: asStr(p.RecordedByName) || sess.empName,
        Remark: asStr(p.Remark)
      }, sess.empId);
    }
    var cur = syncVehicleMileage_(vehicleId, sess.empId);
    return ok({ currentMileage: cur });
  });
}

// กริดทั้งเดือน : days = [{ day:int, mileage:number|null }]
function Mileage_saveMonth(p, sess) {
  requireScreen(sess, 'pk_vehicle_mileage');
  var vehicleId = asInt(p.VehicleID);
  var year = asInt(p.Year), month = asInt(p.Month);
  if (!vehicleId || !year || !month) return fail('ข้อมูลไม่ครบ');
  var daysInMonth = new Date(year, month, 0).getDate();

  // 1) รวม payload เป็น 1 ค่า/วัน (last wins), ข้าม null / นอกเดือน, ติดลบ -> error
  var byDay = {};
  var arr = Array.isArray(p.Days) ? p.Days : [];
  for (var i = 0; i < arr.length; i++) {
    var d = asInt(arr[i].day);
    var m = asNumN(arr[i].mileage);
    if (m === null) continue;
    if (d < 1 || d > daysInMonth) continue;
    if (m < 0) return fail('เลขไมล์ติดลบในวันที่ ' + d);
    byDay[d] = m;
  }

  return withLock(function () {
    if (!getVehicleRaw_(vehicleId)) return fail('ไม่พบรถที่เลือก');

    var pad = function (n) { return ('0' + n).slice(-2); };
    var firstDay = year + '-' + pad(month) + '-01';
    // baseline = max active reading ก่อนเดือนนี้ (กัน self-reject ภายในเดือน)
    var baseline = null;
    activeReadings_(vehicleId).forEach(function (r) {
      if (r.date < firstDay) { if (baseline === null || r.mileage > baseline) baseline = r.mileage; }
    });

    // 2) per-day running guard (เดินหน้าตามวัน)
    var running = baseline;
    var sortedDays = Object.keys(byDay).map(Number).sort(function (a, b) { return a - b; });
    for (var k = 0; k < sortedDays.length; k++) {
      var val = byDay[sortedDays[k]];
      var gErr = odoGuard_(val, running);
      if (gErr) return fail('วันที่ ' + sortedDays[k] + ': ' + gErr);
      running = (running === null) ? val : Math.max(running, val);
    }

    // index แถวเดิมของเดือนนี้ : active + soft-deleted
    var monthActive = {};    // day -> raw (active)
    var monthDeleted = {};   // day -> raw (soft-deleted, ยังไม่ถูกใช้)
    dbReadRaw(CFG.SHEETS.MILEAGE).forEach(function (o) {
      if (asInt(o.VehicleID) !== vehicleId) return;
      var ds = asDateStr(o.MileageDate);
      if (ds < firstDay || ds > (year + '-' + pad(month) + '-' + pad(daysInMonth))) return;
      var dd = Number(ds.split('-')[2]);
      if (asBool(o.IsActive)) monthActive[dd] = o;
      else if (!monthDeleted[dd]) monthDeleted[dd] = o;
    });

    // 3) UPSERT แต่ละวัน
    sortedDays.forEach(function (dd) {
      var ds = year + '-' + pad(month) + '-' + pad(dd);
      var val = byDay[dd];
      if (monthActive[dd]) {
        dbUpdate(CFG.SHEETS.MILEAGE, monthActive[dd], {
          Mileage: val, RecordedByEmpId: sess.empId, RecordedByName: sess.empName
        }, sess.empId);
      } else if (monthDeleted[dd]) {
        dbUpdate(CFG.SHEETS.MILEAGE, monthDeleted[dd], {
          IsActive: 1, Mileage: val, MileageDate: ds,
          RecordedByEmpId: sess.empId, RecordedByName: sess.empName
        }, sess.empId);
      } else {
        dbInsert(CFG.SHEETS.MILEAGE, {
          VehicleID: vehicleId, MileageDate: ds, Mileage: val,
          RecordedByEmpId: sess.empId, RecordedByName: sess.empName, Remark: ''
        }, sess.empId);
      }
    });

    // 4) soft-delete วันเดิมที่ไม่ถูกส่งมารอบนี้
    Object.keys(monthActive).forEach(function (dd) {
      if (byDay[dd] === undefined) dbSoftDelete(CFG.SHEETS.MILEAGE, monthActive[dd], sess.empId);
    });

    // 5) sync CurrentMileage
    var cur = syncVehicleMileage_(vehicleId, sess.empId);

    // 6) auto oil-change plan
    var autoPlanCreated = maybeCreateOilPlan_(vehicleId, sess);

    // 7) คืนค่า
    var monthReads = activeReadings_(vehicleId).filter(function (r) {
      return r.date >= firstDay && r.date <= (year + '-' + pad(month) + '-' + pad(daysInMonth));
    });
    return ok({ currentMileage: cur, monthlyKm: monthlyKm_(monthReads), autoPlanCreated: autoPlanCreated });
  });
}

// สร้างแผนเปลี่ยนน้ำมันอัตโนมัติ ; dedup ที่ vehicle + TaskName (§8.4)
function maybeCreateOilPlan_(vehicleId, sess) {
  var v = getVehicleRaw_(vehicleId);
  if (!v) return false;
  var next = asNumN(v.NextOilChangeMileage);
  if (next === null) return false;
  var cur = asNum(v.CurrentMileage);
  var remaining = next - cur;
  if (remaining < 0 || remaining > CFG.OIL_REMIND_KM) return false;

  var exists = dbReadActive(CFG.SHEETS.PLAN).some(function (pl) {
    return asInt(pl.VehicleID) === asInt(vehicleId)
        && asStr(pl.TaskName) === CFG.OIL_TASK_NAME
        && asStr(pl.Status) !== 'เสร็จสิ้น'
        && asStr(pl.Status) !== CFG.STATUS_CANCEL;
  });
  if (exists) return false;

  dbInsert(CFG.SHEETS.PLAN, {
    VehicleID: vehicleId,
    TaskName: CFG.OIL_TASK_NAME,
    TaskType: 'เปลี่ยนน้ำมัน',
    IntervalMonths: null,
    IntervalMileage: asIntN(v.OilChangeFreqKm),
    LastDoneDate: asDateStr(v.LastOilChangeDate),
    LastDoneMileage: asNumN(v.LastOilChangeMileage),
    NextDueDate: nextSaturday(todayStr()),
    NextDueMileage: next,
    Status: 'ใช้งาน',
    Remark: 'สร้างอัตโนมัติจากการบันทึกเลขไมล์'
  }, sess.empId);
  return true;
}

// header รถ + map { day: mileage } + monthlyKm
function Mileage_getMonth(p, sess) {
  requireRead(sess);
  var vehicleId = asInt(p.vehicleId);
  var year = asInt(p.year), month = asInt(p.month);
  var v = getVehicleRaw_(vehicleId);
  if (!v) return fail('ไม่พบรถ');
  var pad = function (n) { return ('0' + n).slice(-2); };
  var daysInMonth = new Date(year, month, 0).getDate();
  var firstDay = year + '-' + pad(month) + '-01';
  var lastDay = year + '-' + pad(month) + '-' + pad(daysInMonth);

  var monthReads = activeReadings_(vehicleId).filter(function (r) {
    return r.date >= firstDay && r.date <= lastDay;
  });
  var days = {};
  monthReads.forEach(function (r) { days[Number(r.date.split('-')[2])] = r.mileage; });

  return ok({
    vehicle: vehBrief_(v),
    daysInMonth: daysInMonth,
    days: days,
    monthlyKm: monthlyKm_(monthReads)
  });
}

function Mileage_delete(p, sess) {
  requireScreen(sess, 'pk_vehicle_mileage');
  return withLock(function () {
    var ex = dbFindBy(CFG.SHEETS.MILEAGE, 'MileageID', asInt(p.id));
    if (!ex) return fail('ไม่พบรายการ');
    var vehicleId = asInt(ex.VehicleID);
    dbSoftDelete(CFG.SHEETS.MILEAGE, ex, sess.empId);
    var cur = syncVehicleMileage_(vehicleId, sess.empId);
    return ok({ currentMileage: cur });
  });
}
