/**
 * Config.gs — ค่าคงที่ทั้งหมดของระบบ
 *
 * Google Sheets เป็น "ฐานข้อมูล" : 1 ตาราง = 1 sheet tab
 * Google Drive เก็บไฟล์แนบใบเสร็จ (เมนู 4)
 *
 * วิธีตั้งค่า (ทำครั้งเดียว):
 *   1. สร้าง Google Spreadsheet เปล่า 1 ไฟล์ คัดลอก ID จาก URL
 *   2. สร้างโฟลเดอร์ใน Google Drive สำหรับไฟล์แนบ คัดลอก Folder ID
 *   3. Project Settings > Script properties เพิ่ม:
 *        SPREADSHEET_ID  = <id ของ spreadsheet>
 *        DRIVE_FOLDER_ID = <id ของ folder>
 *   4. รันฟังก์ชัน Setup() หนึ่งครั้ง (สร้าง sheet + admin user)
 *   5. Deploy > New deployment > Web app (execute as me / anyone)
 */

var CFG = {
  TZ: 'Asia/Bangkok',
  SESSION_TTL_SEC: 6 * 60 * 60,      // 6 ชั่วโมง
  ODO_MAX_JUMP: 50000,               // เลขไมล์กระโดดเกินนี้ = typo
  OIL_REMIND_KM: 1000,               // เตือนเปลี่ยนน้ำมันเมื่อเหลือ <= 1000 กม.
  DUE_SOON_DAYS: 30,                 // default ครบกำหนดเร็วๆนี้
  OIL_TASK_NAME: 'เปลี่ยนน้ำมันเครื่อง',
  STATUS_CANCEL: 'ยกเลิก',
  VEHICLE_STATUS_DEFAULT: 'ใช้งานปกติ',

  // ----- ชื่อ sheet (= ชื่อตาราง) -----
  SHEETS: {
    VEHICLE:        'Vehicle',
    PLAN:           'MaintenancePlan',
    REPAIR:         'RepairRequest',
    LOG:            'MaintenanceLog',
    LOG_DETAIL:     'MaintenanceLogDetail',
    MILEAGE:        'MileageLog',
    RECEIPT:        'Receipts',
    USER:           'Users'
  },

  // 6 menu keys (mirror ของ spec; เก็บใน Users.AllowedMenus)
  MENU_KEYS: [
    'pk_vehicle_registry',
    'pk_vehicle_plan',
    'pk_vehicle_repair',
    'pk_vehicle_log',
    'pk_vehicle_history',
    'pk_vehicle_mileage'
  ]
};

/**
 * Schema ของแต่ละ sheet : ลำดับ header สำคัญมาก (Db.gs map ตามชื่อ)
 * คอลัมน์ AUTO คำนวณ server-side เท่านั้น (ดู §5)
 * ทุกตารางลงท้ายด้วย audit cols: IsActive, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate
 */
var SCHEMA = {
  Vehicle: [
    'VehicleID','VehicleCode','LicensePlate','VehicleType','Brand','Model','Color',
    'ManufactureYear','EngineNo','ChassisNo','FuelType','CurrentMileage',
    'RegistrationDate','Department','ResponsibleEmpId','ResponsibleName','Remark',
    // ประกัน
    'InsuranceType','InsuranceCompany','InsuranceRenewDate','InsuranceEndDate', // EndDate AUTO
    // พ.ร.บ.
    'ActRenewDate','ActEndDate',                                                // EndDate AUTO
    // ทะเบียน/ภาษี
    'TaxRenewDate','TaxExpiryDate',                                             // ExpiryDate AUTO
    // ตรวจสภาพ
    'LastInspectDate','InspectFreqMonths','NextInspectDate',                   // NextInspect AUTO
    // เปลี่ยนน้ำมัน
    'LastOilChangeDate','LastOilChangeMileage','OilChangeFreqKm','NextOilChangeMileage', // Next AUTO
    'VehicleStatus',
    'IsActive','CreatedBy','CreatedDate','UpdatedBy','UpdatedDate'
  ],
  MaintenancePlan: [
    'PlanID','VehicleID','TaskName','TaskType','IntervalMonths','IntervalMileage',
    'LastDoneDate','LastDoneMileage','NextDueDate','NextDueMileage', // NextDue* AUTO
    'Status','Remark',
    'IsActive','CreatedBy','CreatedDate','UpdatedBy','UpdatedDate'
  ],
  RepairRequest: [
    'RequestID','RequestNo','VehicleID','ReportDate','ReportedByEmpId','ReportedByName',
    'ProblemDescription','Severity','CurrentMileage','Status','Remark',
    'IsActive','CreatedBy','CreatedDate','UpdatedBy','UpdatedDate'
  ],
  MaintenanceLog: [
    'LogID','LogNo','VehicleID','RequestID','PlanID','MaintenanceType',
    'ServiceDate','CompletedDate','Mileage','WorkDescription',
    'PerformedByEmpId','PerformedByName','VendorName',
    'LaborCost','PartsCost','TotalCost', // PartsCost/TotalCost AUTO
    'Status','Remark',
    'IsActive','CreatedBy','CreatedDate','UpdatedBy','UpdatedDate'
  ],
  MaintenanceLogDetail: [
    'DetailID','LogID','ItemName','ItemCode','Quantity','UnitName','UnitPrice',
    'Amount','Remark','CreatedBy','CreatedDate' // Amount AUTO = qty*price
  ],
  MileageLog: [
    'MileageID','VehicleID','MileageDate','Mileage','RecordedByEmpId','RecordedByName','Remark',
    'IsActive','CreatedBy','CreatedDate','UpdatedBy','UpdatedDate'
  ],
  Receipts: [
    'ReceiptID','Module','RefID','DriveFileId','FileName','ContentType','FileSize',
    'IsActive','CreatedBy','CreatedDate','UpdatedBy','UpdatedDate'
  ],
  Users: [
    'EmpId','EmpName','PasswordHash','IsAdmin','AllowedMenus','IsActive','CreatedDate'
  ]
};

function _spreadsheetId_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('ยังไม่ได้ตั้งค่า Script property: SPREADSHEET_ID');
  return id;
}
function _driveFolderId_() {
  return PropertiesService.getScriptProperties().getProperty('DRIVE_FOLDER_ID') || '';
}
