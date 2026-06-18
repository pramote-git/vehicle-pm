/**
 * Vehicle.gs — เมนู 1 ทะเบียนประวัติรถยนต์ (canonical module)
 * key: pk_vehicle_registry
 *
 * AUTO fields (คำนวณ server-side เท่านั้น §5.1):
 *   InsuranceEndDate, ActEndDate, TaxExpiryDate, NextInspectDate, NextOilChangeMileage
 */

// แปลงแถว -> object สำหรับส่งกลับ client (รวม vehicleAgeYears computed)
function vehicleOut_(o) {
  return {
    VehicleID: asInt(o.VehicleID),
    VehicleCode: asStr(o.VehicleCode),
    LicensePlate: asStr(o.LicensePlate),
    VehicleType: asStr(o.VehicleType),
    Brand: asStr(o.Brand),
    Model: asStr(o.Model),
    Color: asStr(o.Color),
    ManufactureYear: asIntN(o.ManufactureYear),
    EngineNo: asStr(o.EngineNo),
    ChassisNo: asStr(o.ChassisNo),
    FuelType: asStr(o.FuelType),
    CurrentMileage: asNum(o.CurrentMileage),
    RegistrationDate: asDateStr(o.RegistrationDate),
    Department: asStr(o.Department),
    ResponsibleEmpId: asStr(o.ResponsibleEmpId),
    ResponsibleName: asStr(o.ResponsibleName),
    Remark: asStr(o.Remark),
    InsuranceType: asStr(o.InsuranceType),
    InsuranceCompany: asStr(o.InsuranceCompany),
    InsuranceRenewDate: asDateStr(o.InsuranceRenewDate),
    InsuranceEndDate: asDateStr(o.InsuranceEndDate),
    ActRenewDate: asDateStr(o.ActRenewDate),
    ActEndDate: asDateStr(o.ActEndDate),
    TaxRenewDate: asDateStr(o.TaxRenewDate),
    TaxExpiryDate: asDateStr(o.TaxExpiryDate),
    LastInspectDate: asDateStr(o.LastInspectDate),
    InspectFreqMonths: asIntN(o.InspectFreqMonths),
    NextInspectDate: asDateStr(o.NextInspectDate),
    LastOilChangeDate: asDateStr(o.LastOilChangeDate),
    LastOilChangeMileage: asNumN(o.LastOilChangeMileage),
    OilChangeFreqKm: asIntN(o.OilChangeFreqKm),
    NextOilChangeMileage: asNumN(o.NextOilChangeMileage),
    VehicleStatus: asStr(o.VehicleStatus) || CFG.VEHICLE_STATUS_DEFAULT,
    vehicleAgeYears: vehicleAgeYears(asDateStr(o.RegistrationDate))
  };
}

function Vehicle_list(p, sess) {
  requireRead(sess);
  var search = asStr(p.search).toLowerCase();
  var vType = asStr(p.vehicleType);
  var rows = dbReadActive(CFG.SHEETS.VEHICLE);
  var out = rows.filter(function (o) {
    if (vType && asStr(o.VehicleType) !== vType) return false;
    if (search) {
      var hay = [o.LicensePlate, o.VehicleCode, o.Brand, o.Model, o.ResponsibleName]
        .map(asStr).join(' ').toLowerCase();
      if (hay.indexOf(search) < 0) return false;
    }
    return true;
  }).map(vehicleOut_);
  out.sort(function (a, b) { return b.VehicleID - a.VehicleID; });   // VehicleID DESC
  return listJson(out);
}

function Vehicle_get(p, sess) {
  requireRead(sess);
  var o = dbFindBy(CFG.SHEETS.VEHICLE, 'VehicleID', asInt(p.id));
  if (!o || !asBool(o.IsActive)) return fail('ไม่พบข้อมูลรถ');
  return ok({ data: vehicleOut_(o) });
}

// dropdown ให้เมนู 2-6 (§4.1 Lookup)
function Vehicle_lookup(p, sess) {
  requireRead(sess);
  var search = asStr(p.search).toLowerCase();
  var rows = dbReadActive(CFG.SHEETS.VEHICLE).filter(function (o) {
    if (asStr(o.VehicleStatus) === CFG.STATUS_CANCEL) return false;
    if (!search) return true;
    var hay = [o.LicensePlate, o.VehicleCode, o.Brand, o.Model].map(asStr).join(' ').toLowerCase();
    return hay.indexOf(search) >= 0;
  }).map(function (o) {
    return {
      VehicleID: asInt(o.VehicleID),
      VehicleCode: asStr(o.VehicleCode),
      LicensePlate: asStr(o.LicensePlate),
      VehicleType: asStr(o.VehicleType),
      Brand: asStr(o.Brand),
      Model: asStr(o.Model),
      CurrentMileage: asNum(o.CurrentMileage),
      InspectFreqMonths: asIntN(o.InspectFreqMonths),
      OilChangeFreqKm: asIntN(o.OilChangeFreqKm)
    };
  });
  out_sortByPlate_(rows);
  return listJson(rows);
}
function out_sortByPlate_(rows) {
  rows.sort(function (a, b) { return a.LicensePlate.localeCompare(b.LicensePlate, 'th'); });
}

function validateVehicle_(p) {
  var e;
  if ((e = reqErr('ทะเบียนรถ', p.LicensePlate))) return e;
  if ((e = capErr('ทะเบียนรถ', p.LicensePlate, 50))) return e;
  if ((e = capErr('รหัสรถ', p.VehicleCode, 50))) return e;
  if ((e = capErr('ยี่ห้อ', p.Brand, 100))) return e;
  if ((e = capErr('รุ่น', p.Model, 100))) return e;
  if ((e = capErr('หมายเหตุ', p.Remark, 500))) return e;
  return null;
}

// คำนวณ 5 AUTO fields (§5.1) -> patch object พร้อมเขียน
function bindVehicleParams_(p) {
  var insRenew = asDateStr(p.InsuranceRenewDate);
  var actRenew = asDateStr(p.ActRenewDate);
  var taxRenew = asDateStr(p.TaxRenewDate);
  var lastInspect = asDateStr(p.LastInspectDate);
  var inspectFreq = asIntN(p.InspectFreqMonths);
  var lastOilM = asNumN(p.LastOilChangeMileage);
  var oilFreq = asIntN(p.OilChangeFreqKm);

  return {
    VehicleCode: asStr(p.VehicleCode),
    LicensePlate: asStr(p.LicensePlate),
    VehicleType: asStr(p.VehicleType),
    Brand: asStr(p.Brand),
    Model: asStr(p.Model),
    Color: asStr(p.Color),
    ManufactureYear: asIntN(p.ManufactureYear),
    EngineNo: asStr(p.EngineNo),
    ChassisNo: asStr(p.ChassisNo),
    FuelType: asStr(p.FuelType),
    RegistrationDate: asDateStr(p.RegistrationDate),
    Department: asStr(p.Department),
    ResponsibleEmpId: asStr(p.ResponsibleEmpId),
    ResponsibleName: asStr(p.ResponsibleName),
    Remark: asStr(p.Remark),
    InsuranceType: asStr(p.InsuranceType),
    InsuranceCompany: asStr(p.InsuranceCompany),
    InsuranceRenewDate: insRenew,
    InsuranceEndDate: insRenew ? addYears(insRenew, 1) : '',          // AUTO
    ActRenewDate: actRenew,
    ActEndDate: actRenew ? addYears(actRenew, 1) : '',                // AUTO
    TaxRenewDate: taxRenew,
    TaxExpiryDate: taxRenew ? addYears(taxRenew, 1) : '',             // AUTO
    LastInspectDate: lastInspect,
    InspectFreqMonths: inspectFreq,
    NextInspectDate: (lastInspect && inspectFreq && inspectFreq > 0)  // AUTO
      ? addMonths(lastInspect, inspectFreq) : '',
    LastOilChangeDate: asDateStr(p.LastOilChangeDate),
    LastOilChangeMileage: lastOilM,
    OilChangeFreqKm: oilFreq,
    NextOilChangeMileage: (lastOilM !== null && oilFreq)             // AUTO
      ? lastOilM + oilFreq : null,
    VehicleStatus: asStr(p.VehicleStatus) || CFG.VEHICLE_STATUS_DEFAULT
    // CurrentMileage: ไม่แตะที่นี่ (เมนู 6 เป็นผู้เขียน) — insert ให้ค่าเริ่มต้นเองด้านล่าง
  };
}

// กันทะเบียนซ้ำในรถที่ยัง active (analog ของ UNIQUE filtered index)
function dupPlate_(plate, excludeId) {
  var hit = dbReadActive(CFG.SHEETS.VEHICLE).filter(function (o) {
    return asStr(o.LicensePlate).toLowerCase() === asStr(plate).toLowerCase()
        && asInt(o.VehicleID) !== asInt(excludeId);
  });
  return hit.length > 0;
}

function Vehicle_save(p, sess) {
  requireScreen(sess, 'pk_vehicle_registry');
  var verr = validateVehicle_(p);
  if (verr) return fail(verr);

  return withLock(function () {
    var id = asInt(p.VehicleID);
    if (dupPlate_(p.LicensePlate, id)) return fail('ทะเบียนรถนี้มีอยู่แล้วในระบบ');
    var patch = bindVehicleParams_(p);

    if (id === 0) {
      patch.CurrentMileage = asNum(p.CurrentMileage);  // ค่าเริ่มต้นตอนสร้าง
      var ins = dbInsert(CFG.SHEETS.VEHICLE, patch, sess.empId);
      return ok({ id: ins.VehicleID });
    } else {
      var ex = dbFindBy(CFG.SHEETS.VEHICLE, 'VehicleID', id);
      if (!ex || !asBool(ex.IsActive)) return fail('ไม่พบข้อมูลรถ');
      // ไม่อัปเดต CurrentMileage จากฟอร์มนี้ (เมนู 6 ผู้เขียน)
      dbUpdate(CFG.SHEETS.VEHICLE, ex, patch, sess.empId);
      return ok({ id: id });
    }
  });
}

function Vehicle_delete(p, sess) {
  requireScreen(sess, 'pk_vehicle_registry');
  return withLock(function () {
    var ex = dbFindBy(CFG.SHEETS.VEHICLE, 'VehicleID', asInt(p.id));
    if (!ex) return fail('ไม่พบข้อมูลรถ');
    dbSoftDelete(CFG.SHEETS.VEHICLE, ex, sess.empId);
    return ok({});
  });
}

// helper ใช้ข้ามโมดูล : อ่านรถ active 1 คัน (คืน raw object หรือ null)
function getVehicleRaw_(vehicleId) {
  var o = dbFindBy(CFG.SHEETS.VEHICLE, 'VehicleID', asInt(vehicleId));
  return (o && asBool(o.IsActive)) ? o : null;
}
