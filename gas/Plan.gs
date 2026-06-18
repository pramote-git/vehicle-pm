/**
 * Plan.gs — เมนู 2 แผนบำรุงรักษาเชิงป้องกัน + Reminder Engine
 * key: pk_vehicle_plan
 *
 * Reminder รวม 3 แหล่ง (§4.2):
 *   1) plan  : แผน PM (ตัด 'เปลี่ยนน้ำมันเครื่อง' ออก กันซ้ำ source 3)
 *   2) registry : ต่อทะเบียน/พ.ร.บ./ประกัน/ตรวจสภาพ (UNPIVOT จาก Vehicle, ไม่มี lower bound -> overdue โชว์)
 *   3) oilchange : เตือนตามเลขไมล์ (NextOilChangeMileage - CurrentMileage <= 1000)
 */

var REGISTRY_TYPES = [
  { label: 'ต่อทะเบียน', dueCol: 'TaxExpiryDate' },
  { label: 'ต่อ พ.ร.บ.', dueCol: 'ActEndDate' },
  { label: 'ต่อประกัน', dueCol: 'InsuranceEndDate' },
  { label: 'ตรวจสภาพ', dueCol: 'NextInspectDate' }
];

function vehMap_() {
  var m = {};
  dbReadActive(CFG.SHEETS.VEHICLE).forEach(function (o) { m[asInt(o.VehicleID)] = o; });
  return m;
}
function vehBrief_(v) {
  return {
    vehicleId: asInt(v.VehicleID),
    vehicleCode: asStr(v.VehicleCode),
    licensePlate: asStr(v.LicensePlate),
    vehicleType: asStr(v.VehicleType),
    brand: asStr(v.Brand),
    model: asStr(v.Model),
    currentMileage: asNum(v.CurrentMileage)
  };
}

// ----- builders -----
function buildPlanItems_(vmap, opts) {
  // opts: { dueOnly, days, vehicleId, status }
  return dbReadActive(CFG.SHEETS.PLAN).filter(function (pl) {
    if (asStr(pl.Status) === CFG.STATUS_CANCEL) return false;
    if (opts.vehicleId && asInt(pl.VehicleID) !== asInt(opts.vehicleId)) return false;
    return true;
  }).map(function (pl) {
    var v = vmap[asInt(pl.VehicleID)] || {};
    var dueDate = asDateStr(pl.NextDueDate);
    var dueMileage = asNumN(pl.NextDueMileage);
    var cur = asNum(v.CurrentMileage);
    return Object.assign(vehBrief_(v), {
      kind: 'plan',
      planId: asInt(pl.PlanID),
      typeLabel: asStr(pl.TaskName),
      taskType: asStr(pl.TaskType),
      intervalMonths: asIntN(pl.IntervalMonths),
      intervalMileage: asIntN(pl.IntervalMileage),
      lastDoneDate: asDateStr(pl.LastDoneDate),
      lastDoneMileage: asNumN(pl.LastDoneMileage),
      dueDate: dueDate,
      dueMileage: dueMileage,
      remainingKm: (dueMileage !== null) ? (dueMileage - cur) : null,
      daysRemaining: dueDate ? daysFromToday(dueDate) : null,
      status: asStr(pl.Status) || 'ใช้งาน'
    });
  }).filter(function (it) {
    if (!opts.dueOnly) return true;
    // ตัดแผนน้ำมัน (ให้ source 3 เป็นตัวจริง) เฉพาะตอน dueSoon
    if (it.typeLabel === CFG.OIL_TASK_NAME) return false;
    var byDate = it.dueDate && it.daysRemaining !== null && it.daysRemaining <= opts.days;
    var byMile = it.dueMileage !== null && it.currentMileage >= it.dueMileage;
    return byDate || byMile;
  });
}

function buildRegistryItems_(vmap, opts) {
  // opts: { dueOnly, days }
  var out = [];
  Object.keys(vmap).forEach(function (vid) {
    var v = vmap[vid];
    if (asStr(v.VehicleStatus) === CFG.STATUS_CANCEL) return;
    REGISTRY_TYPES.forEach(function (t) {
      var dueDate = asDateStr(v[t.dueCol]);
      if (!dueDate) return;
      var dr = daysFromToday(dueDate);
      if (opts.dueOnly && dr > opts.days) return; // ไม่มี lower bound -> overdue (dr<0) ผ่าน
      out.push(Object.assign(vehBrief_(v), {
        kind: 'registry',
        planId: null,
        typeLabel: t.label,
        dueCol: t.dueCol,
        dueDate: dueDate,
        dueMileage: null,
        remainingKm: null,
        daysRemaining: dr,
        status: 'ใช้งาน'
      }));
    });
  });
  return out;
}

function buildOilItems_(vmap, opts) {
  // opts: { dueOnly }  (dueOnly -> remaining <= OIL_REMIND_KM)
  var out = [];
  Object.keys(vmap).forEach(function (vid) {
    var v = vmap[vid];
    if (asStr(v.VehicleStatus) === CFG.STATUS_CANCEL) return;
    var next = asNumN(v.NextOilChangeMileage);
    if (next === null) return;
    var cur = asNum(v.CurrentMileage);
    var remaining = next - cur;
    if (opts.dueOnly && remaining > CFG.OIL_REMIND_KM) return; // รวม overdue (remaining<0)
    out.push(Object.assign(vehBrief_(v), {
      kind: 'oilchange',
      planId: null,
      typeLabel: CFG.OIL_TASK_NAME,
      dueDate: '',
      dueMileage: next,
      remainingKm: remaining,
      daysRemaining: null,
      status: 'ใช้งาน'
    }));
  });
  out.sort(function (a, b) { return a.remainingKm - b.remainingKm; }); // RemainingKm ASC
  return out;
}

// stable sort by dueDate ASC, null อยู่ท้าย
function sortByDue_(items) {
  return items
    .map(function (it, i) { return { it: it, i: i }; })
    .sort(function (a, b) {
      var da = a.it.dueDate, db = b.it.dueDate;
      if (!da && !db) return a.i - b.i;
      if (!da) return 1;
      if (!db) return -1;
      if (da === db) return a.i - b.i;
      return da < db ? -1 : 1;
    })
    .map(function (x) { return x.it; });
}

function Plan_dueSoon(p, sess) {
  requireRead(sess);
  var days = p.days !== undefined && p.days !== '' ? asInt(p.days) : CFG.DUE_SOON_DAYS;
  var vmap = vehMap_();
  var dateItems = sortByDue_(
    buildPlanItems_(vmap, { dueOnly: true, days: days })
      .concat(buildRegistryItems_(vmap, { dueOnly: true, days: days }))
  );
  var oilItems = buildOilItems_(vmap, { dueOnly: true });
  return listJson(dateItems.concat(oilItems));
}

function Plan_list(p, sess) {
  requireRead(sess);
  var vmap = vehMap_();
  var vehicleId = asIntN(p.vehicleId);
  var status = asStr(p.status);

  var plans = buildPlanItems_(vmap, { dueOnly: false, vehicleId: vehicleId });
  if (status) plans = plans.filter(function (it) { return it.status === status; });

  var extra = [];
  if (!status || status === 'ใช้งาน') {
    extra = buildRegistryItems_(vmap, { dueOnly: false })
      .concat(buildOilItems_(vmap, { dueOnly: false }));
    if (vehicleId) extra = extra.filter(function (it) { return it.vehicleId === vehicleId; });
  }
  return listJson(sortByDue_(plans.concat(extra)));
}

function Plan_get(p, sess) {
  requireRead(sess);
  var pl = dbFindBy(CFG.SHEETS.PLAN, 'PlanID', asInt(p.id));
  if (!pl || !asBool(pl.IsActive)) return fail('ไม่พบแผน');
  return ok({ data: {
    PlanID: asInt(pl.PlanID),
    VehicleID: asInt(pl.VehicleID),
    TaskName: asStr(pl.TaskName),
    TaskType: asStr(pl.TaskType),
    IntervalMonths: asIntN(pl.IntervalMonths),
    IntervalMileage: asIntN(pl.IntervalMileage),
    LastDoneDate: asDateStr(pl.LastDoneDate),
    LastDoneMileage: asNumN(pl.LastDoneMileage),
    NextDueDate: asDateStr(pl.NextDueDate),
    NextDueMileage: asNumN(pl.NextDueMileage),
    Status: asStr(pl.Status) || 'ใช้งาน',
    Remark: asStr(pl.Remark)
  }});
}

function bindPlanParams_(p) {
  var months = asIntN(p.IntervalMonths);
  var mileage = asIntN(p.IntervalMileage);
  var lastDate = asDateStr(p.LastDoneDate);
  var lastMile = asNumN(p.LastDoneMileage);
  return {
    VehicleID: asInt(p.VehicleID),
    TaskName: asStr(p.TaskName),
    TaskType: asStr(p.TaskType),
    IntervalMonths: months,
    IntervalMileage: mileage,
    LastDoneDate: lastDate,
    LastDoneMileage: lastMile,
    NextDueDate: (months && months > 0 && lastDate) ? addMonths(lastDate, months) : '',     // AUTO
    NextDueMileage: (mileage && mileage > 0 && lastMile !== null) ? lastMile + mileage : null, // AUTO
    Status: asStr(p.Status) || 'ใช้งาน',
    Remark: asStr(p.Remark)
  };
}

function Plan_save(p, sess) {
  requireScreen(sess, 'pk_vehicle_plan');
  if (!asInt(p.VehicleID)) return fail('กรุณาเลือกรถ');
  if (!asStr(p.TaskName)) return fail('กรุณากรอกชื่องาน');
  var months = asIntN(p.IntervalMonths), mileage = asIntN(p.IntervalMileage);
  if (!(months && months > 0) && !(mileage && mileage > 0))
    return fail('ต้องระบุรอบอย่างน้อย 1 อย่าง (เดือน หรือ กิโลเมตร)');

  return withLock(function () {
    if (!getVehicleRaw_(p.VehicleID)) return fail('ไม่พบรถที่เลือก');
    var patch = bindPlanParams_(p);
    var id = asInt(p.PlanID);
    if (id === 0) {
      var ins = dbInsert(CFG.SHEETS.PLAN, patch, sess.empId);
      return ok({ id: ins.PlanID });
    }
    var ex = dbFindBy(CFG.SHEETS.PLAN, 'PlanID', id);
    if (!ex || !asBool(ex.IsActive)) return fail('ไม่พบแผน');
    dbUpdate(CFG.SHEETS.PLAN, ex, patch, sess.empId);
    return ok({ id: id });
  });
}

function Plan_delete(p, sess) {
  requireScreen(sess, 'pk_vehicle_plan');
  return withLock(function () {
    var ex = dbFindBy(CFG.SHEETS.PLAN, 'PlanID', asInt(p.id));
    if (!ex) return fail('ไม่พบแผน');
    dbSoftDelete(CFG.SHEETS.PLAN, ex, sess.empId);
    return ok({});
  });
}

// ----- action endpoints : ทำให้วงรอบ "หมุน" (§4.2) -----

// บันทึกต่ออายุกลับเข้า registry -> end/next date เลื่อน
function Plan_renewRegistry(p, sess) {
  requireScreen(sess, 'pk_vehicle_plan');
  var type = asStr(p.type);
  var d = asDateStr(p.newRenewDate);
  if (!d) return fail('กรุณาระบุวันที่ต่ออายุ');
  return withLock(function () {
    var v = getVehicleRaw_(p.vehicleId);
    if (!v) return fail('ไม่พบรถ');
    var patch = {};
    if (type === 'ต่อทะเบียน') {
      patch.TaxRenewDate = d; patch.TaxExpiryDate = addYears(d, 1);
    } else if (type === 'ต่อ พ.ร.บ.') {
      patch.ActRenewDate = d; patch.ActEndDate = addYears(d, 1);
    } else if (type === 'ต่อประกัน') {
      patch.InsuranceRenewDate = d; patch.InsuranceEndDate = addYears(d, 1);
    } else if (type === 'ตรวจสภาพ') {
      var freq = asIntN(v.InspectFreqMonths);
      patch.LastInspectDate = d;
      patch.NextInspectDate = (freq && freq > 0) ? addMonths(d, freq) : asDateStr(v.NextInspectDate);
    } else {
      return fail('ประเภทการต่ออายุไม่ถูกต้อง');
    }
    dbUpdate(CFG.SHEETS.VEHICLE, v, patch, sess.empId);
    return ok({});
  });
}

// หมุนแผน PM ไปรอบถัดไป
function Plan_completePlan(p, sess) {
  requireScreen(sess, 'pk_vehicle_plan');
  var doneDate = asDateStr(p.doneDate) || todayStr();
  return withLock(function () {
    var pl = dbFindBy(CFG.SHEETS.PLAN, 'PlanID', asInt(p.planId));
    if (!pl || !asBool(pl.IsActive)) return fail('ไม่พบแผน');
    var v = getVehicleRaw_(pl.VehicleID);
    var cur = v ? asNum(v.CurrentMileage) : asNum(pl.LastDoneMileage);
    var months = asIntN(pl.IntervalMonths), mileage = asIntN(pl.IntervalMileage);
    dbUpdate(CFG.SHEETS.PLAN, pl, {
      LastDoneDate: doneDate,
      LastDoneMileage: cur,
      NextDueDate: (months && months > 0) ? addMonths(doneDate, months) : '',
      NextDueMileage: (mileage && mileage > 0) ? cur + mileage : null
    }, sess.empId);
    return ok({});
  });
}

// บันทึกเปลี่ยนน้ำมัน (ไม่แตะ CurrentMileage)
function Plan_renewOilChange(p, sess) {
  requireScreen(sess, 'pk_vehicle_plan');
  var m = asNumN(p.changeMileage);
  if (m === null) return fail('กรุณาระบุเลขไมล์ที่เปลี่ยนน้ำมัน');
  var d = asDateStr(p.changeDate) || todayStr();
  return withLock(function () {
    var v = getVehicleRaw_(p.vehicleId);
    if (!v) return fail('ไม่พบรถ');
    var freq = asIntN(v.OilChangeFreqKm);
    dbUpdate(CFG.SHEETS.VEHICLE, v, {
      LastOilChangeMileage: m,
      LastOilChangeDate: d,
      NextOilChangeMileage: (freq && freq > 0) ? m + freq : null
    }, sess.empId);
    return ok({});
  });
}
