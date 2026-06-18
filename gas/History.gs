/**
 * History.gs — เมนู 5 ประวัติการซ่อม/บำรุงรักษา (read-only)
 * key: pk_vehicle_history
 * อ่านจาก MaintenanceLog (active) + join Vehicle  (= analog ของ VIEW)
 */

function History_list(p, sess) {
  requireRead(sess);
  var vmap = vehMap_();
  var vehicleId = asIntN(p.vehicleId);
  var dateFrom = asDateStr(p.dateFrom);
  var dateTo = asDateStr(p.dateTo);
  var mType = asStr(p.maintenanceType);

  var rows = dbReadActive(CFG.SHEETS.LOG).filter(function (o) {
    if (vehicleId && asInt(o.VehicleID) !== vehicleId) return false;
    var sd = asDateStr(o.ServiceDate);
    if (dateFrom && sd < dateFrom) return false;
    if (dateTo && sd > dateTo) return false;
    if (mType && asStr(o.MaintenanceType) !== mType) return false;
    return true;
  }).map(function (o) { return logHeaderOut_(o, vmap); });

  rows.sort(function (a, b) {
    var c = (b.ServiceDate || '').localeCompare(a.ServiceDate || '');
    return c !== 0 ? c : b.LogID - a.LogID;
  });
  return listJson(rows);
}

function History_detail(p, sess) {
  requireRead(sess);
  var o = dbFindBy(CFG.SHEETS.LOG, 'LogID', asInt(p.logId));
  if (!o || !asBool(o.IsActive)) return fail('ไม่พบใบงาน');
  var items = dbReadRaw(CFG.SHEETS.LOG_DETAIL)
    .filter(function (d) { return asInt(d.LogID) === asInt(p.logId); })
    .map(logDetailOut_);
  return ok({ data: logHeaderOut_(o, vehMap_()), items: items });
}

// สรุปยอดต่อรถ : SUM(Total/Labor/Parts) + COUNT(*) GROUP BY VehicleID  (§4.5)
function History_summary(p, sess) {
  requireRead(sess);
  var vmap = vehMap_();
  var dateFrom = asDateStr(p.dateFrom);
  var dateTo = asDateStr(p.dateTo);
  var agg = {};
  dbReadActive(CFG.SHEETS.LOG).forEach(function (o) {
    var sd = asDateStr(o.ServiceDate);
    if (dateFrom && sd < dateFrom) return;
    if (dateTo && sd > dateTo) return;
    var vid = asInt(o.VehicleID);
    if (!agg[vid]) agg[vid] = { vehicleId: vid, count: 0, total: 0, labor: 0, parts: 0 };
    agg[vid].count += 1;
    agg[vid].total += asNum(o.TotalCost);
    agg[vid].labor += asNum(o.LaborCost);
    agg[vid].parts += asNum(o.PartsCost);
  });
  var out = Object.keys(agg).map(function (vid) {
    var v = vmap[vid] || {};
    var a = agg[vid];
    return {
      vehicleId: a.vehicleId,
      licensePlate: asStr(v.LicensePlate),
      vehicleCode: asStr(v.VehicleCode),
      brand: asStr(v.Brand),
      model: asStr(v.Model),
      count: a.count,
      totalCost: round2(a.total),
      laborCost: round2(a.labor),
      partsCost: round2(a.parts)
    };
  });
  out.sort(function (a, b) { return b.totalCost - a.totalCost; });
  return listJson(out);
}
