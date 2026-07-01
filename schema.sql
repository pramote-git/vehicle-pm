-- schema.sql — โครงฐานข้อมูล D1 (SQLite) สำหรับ Vehicle PM บน Cloudflare
-- พอร์ตจาก SCHEMA ใน gas/Config.gs : 1 ตาราง = 1 table
-- วันที่เก็บเป็น TEXT 'yyyy-MM-dd' (ให้ logic เทียบวันแบบ string ทำงานเหมือน GAS)
-- รันครั้งเดียว: wrangler d1 execute <db> --file=./schema.sql  (idempotent)

CREATE TABLE IF NOT EXISTS Vehicle (
  VehicleID INTEGER PRIMARY KEY AUTOINCREMENT,
  VehicleCode TEXT, LicensePlate TEXT NOT NULL, VehicleType TEXT, Brand TEXT, Model TEXT, Color TEXT,
  ManufactureYear INTEGER, EngineNo TEXT, ChassisNo TEXT, FuelType TEXT, CurrentMileage REAL DEFAULT 0,
  RegistrationDate TEXT, Department TEXT, ResponsibleEmpId TEXT, ResponsibleName TEXT, Remark TEXT,
  InsuranceType TEXT, InsuranceCompany TEXT, InsuranceRenewDate TEXT, InsuranceEndDate TEXT,
  ActRenewDate TEXT, ActEndDate TEXT,
  TaxRenewDate TEXT, TaxExpiryDate TEXT,
  LastInspectDate TEXT, InspectFreqMonths INTEGER, NextInspectDate TEXT,
  LastOilChangeDate TEXT, LastOilChangeMileage REAL, OilChangeFreqKm INTEGER, NextOilChangeMileage REAL,
  VehicleStatus TEXT NOT NULL DEFAULT 'ใช้งานปกติ',
  IsActive INTEGER NOT NULL DEFAULT 1, CreatedBy TEXT, CreatedDate TEXT, UpdatedBy TEXT, UpdatedDate TEXT
);
CREATE INDEX IF NOT EXISTS IX_Vehicle_Active ON Vehicle(IsActive);
CREATE INDEX IF NOT EXISTS IX_Vehicle_Plate  ON Vehicle(LicensePlate);

CREATE TABLE IF NOT EXISTS MaintenancePlan (
  PlanID INTEGER PRIMARY KEY AUTOINCREMENT,
  VehicleID INTEGER NOT NULL, TaskName TEXT NOT NULL, TaskType TEXT,
  IntervalMonths INTEGER, IntervalMileage INTEGER, LastDoneDate TEXT, LastDoneMileage REAL,
  NextDueDate TEXT, NextDueMileage REAL, Status TEXT NOT NULL DEFAULT 'ใช้งาน', Remark TEXT,
  IsActive INTEGER NOT NULL DEFAULT 1, CreatedBy TEXT, CreatedDate TEXT, UpdatedBy TEXT, UpdatedDate TEXT
);
CREATE INDEX IF NOT EXISTS IX_Plan_Vehicle ON MaintenancePlan(VehicleID, IsActive);

CREATE TABLE IF NOT EXISTS RepairRequest (
  RequestID INTEGER PRIMARY KEY AUTOINCREMENT,
  RequestNo TEXT, VehicleID INTEGER NOT NULL, ReportDate TEXT,
  ReportedByEmpId TEXT, ReportedByName TEXT, ProblemDescription TEXT, Severity TEXT,
  CurrentMileage REAL, Status TEXT NOT NULL DEFAULT 'รอดำเนินการ', Remark TEXT,
  IsActive INTEGER NOT NULL DEFAULT 1, CreatedBy TEXT, CreatedDate TEXT, UpdatedBy TEXT, UpdatedDate TEXT
);
CREATE INDEX IF NOT EXISTS IX_Repair_Vehicle ON RepairRequest(VehicleID, IsActive);

CREATE TABLE IF NOT EXISTS MaintenanceLog (
  LogID INTEGER PRIMARY KEY AUTOINCREMENT,
  LogNo TEXT, VehicleID INTEGER NOT NULL, RequestID INTEGER, PlanID INTEGER,
  MaintenanceType TEXT NOT NULL DEFAULT 'ซ่อม', ServiceDate TEXT, CompletedDate TEXT, Mileage REAL,
  WorkDescription TEXT, PerformedByEmpId TEXT, PerformedByName TEXT, VendorName TEXT,
  LaborCost REAL DEFAULT 0, PartsCost REAL DEFAULT 0, TotalCost REAL DEFAULT 0,
  Status TEXT NOT NULL DEFAULT 'เสร็จสิ้น', Remark TEXT,
  IsActive INTEGER NOT NULL DEFAULT 1, CreatedBy TEXT, CreatedDate TEXT, UpdatedBy TEXT, UpdatedDate TEXT
);
CREATE INDEX IF NOT EXISTS IX_Log_Vehicle ON MaintenanceLog(VehicleID, IsActive);

CREATE TABLE IF NOT EXISTS MaintenanceLogDetail (
  DetailID INTEGER PRIMARY KEY AUTOINCREMENT,
  LogID INTEGER NOT NULL, ItemName TEXT, ItemCode TEXT, Quantity REAL DEFAULT 1,
  UnitName TEXT, UnitPrice REAL, Amount REAL, Remark TEXT, CreatedBy TEXT, CreatedDate TEXT
);
CREATE INDEX IF NOT EXISTS IX_Detail_Log ON MaintenanceLogDetail(LogID);

CREATE TABLE IF NOT EXISTS MileageLog (
  MileageID INTEGER PRIMARY KEY AUTOINCREMENT,
  VehicleID INTEGER NOT NULL, MileageDate TEXT, Mileage REAL NOT NULL,
  RecordedByEmpId TEXT, RecordedByName TEXT, Remark TEXT,
  IsActive INTEGER NOT NULL DEFAULT 1, CreatedBy TEXT, CreatedDate TEXT, UpdatedBy TEXT, UpdatedDate TEXT
);
CREATE INDEX IF NOT EXISTS IX_Mileage_Vehicle ON MileageLog(VehicleID, IsActive);

CREATE TABLE IF NOT EXISTS Receipts (
  ReceiptID INTEGER PRIMARY KEY AUTOINCREMENT,
  Module TEXT, RefID INTEGER, StorageKey TEXT, FileName TEXT, ContentType TEXT, FileSize REAL,
  IsActive INTEGER NOT NULL DEFAULT 1, CreatedBy TEXT, CreatedDate TEXT, UpdatedBy TEXT, UpdatedDate TEXT
);
CREATE INDEX IF NOT EXISTS IX_Receipt_Ref ON Receipts(Module, RefID, IsActive);

CREATE TABLE IF NOT EXISTS Users (
  EmpId TEXT PRIMARY KEY, EmpName TEXT, PasswordHash TEXT, IsAdmin INTEGER DEFAULT 0,
  AllowedMenus TEXT, IsActive INTEGER NOT NULL DEFAULT 1, CreatedDate TEXT
);

CREATE TABLE IF NOT EXISTS Sessions (
  token TEXT PRIMARY KEY, empId TEXT, empName TEXT, isAdmin INTEGER,
  allowedMenus TEXT, expiresAt INTEGER
);
CREATE INDEX IF NOT EXISTS IX_Sessions_Exp ON Sessions(expiresAt);

-- seed admin (admin / admin123)  hash = sha256('pk_salt::admin123')
INSERT OR IGNORE INTO Users (EmpId, EmpName, PasswordHash, IsAdmin, AllowedMenus, IsActive, CreatedDate)
VALUES ('admin', 'ผู้ดูแลระบบ',
        '9cc174b2309ea87c53a5dd18dfb1b529b6a3f3dd5dc5bc8854cacee92f09215f',
        1,
        'pk_vehicle_registry,pk_vehicle_plan,pk_vehicle_repair,pk_vehicle_log,pk_vehicle_history,pk_vehicle_mileage',
        1, '2026-07-01');
