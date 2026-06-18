# 🚗 ระบบทะเบียนรถยนต์ & บำรุงรักษาเชิงป้องกัน (Vehicle PM)

โมดูลรถยนต์ครบ **6 เมนู** สร้างใหม่จากศูนย์ให้รันบน **GitHub Pages** โดยใช้
**Google Sheets เป็นฐานข้อมูล** + **Google Drive เก็บไฟล์แนบใบเสร็จ** ผ่าน **Google Apps Script Web App** เป็น backend

> ดัดแปลงสถาปัตยกรรมจาก spec เดิม (ASP.NET Core + SQL Server) มาเป็น serverless ทั้งหมด
> แต่ **กฎทางธุรกิจ / การคำนวณอัตโนมัติ / gotchas** ทั้งหมดถูกย้ายมาครบ

```
┌─────────────────┐     POST JSON      ┌──────────────────────┐
│  GitHub Pages   │ ─────────────────▶ │ Google Apps Script   │
│  (docs/ static) │ ◀───────────────── │  Web App (/exec)     │
│  HTML + JS       │      JSON          │   ├─ Google Sheets   │ ← ฐานข้อมูล (1 tab = 1 ตาราง)
└─────────────────┘                    │   └─ Google Drive    │ ← ไฟล์แนบใบเสร็จ
                                       └──────────────────────┘
```

---

## โครงสร้างไฟล์

```
vehicle-pm/
├─ gas/                         ← Backend (Google Apps Script)
│  ├─ appsscript.json           manifest (timezone, scopes Drive/Sheets, web app)
│  ├─ Config.gs                 ค่าคงที่ + SCHEMA ของทุก sheet
│  ├─ Setup.gs                  รันครั้งเดียว: สร้าง sheet + seed admin
│  ├─ Db.gs                     generic CRUD บน Sheets (id, soft-delete, audit, lock)
│  ├─ Util.gs                   date math, round2, gen เลขเอกสาร, Safe* coercion
│  ├─ Auth.gs                   login + session token + permission gate
│  ├─ Code.gs                   doGet/doPost router (action → handler)
│  ├─ Vehicle.gs                เมนู 1 ทะเบียนรถ (canonical) + 5 AUTO fields
│  ├─ Plan.gs                   เมนู 2 แผน PM + reminder engine (3 sources)
│  ├─ RepairRequest.gs          เมนู 3 แจ้งซ่อม (VR{yyMM}-000)
│  ├─ MaintenanceLog.gs         เมนู 4 บันทึกซ่อม (ML{yyMM}-000) + Drive แนบไฟล์
│  ├─ History.gs                เมนู 5 ประวัติ (read-only) + สรุปยอด
│  └─ Mileage.gs                เมนู 6 เลขไมล์ + odometer guard + auto oil-plan
├─ docs/                        ← Frontend (GitHub Pages เสิร์ฟจากโฟลเดอร์นี้)
│  ├─ index.html                shell + login
│  ├─ config.js                 ★ วาง URL ของ GAS Web App ตรงนี้
│  ├─ api.js                    ตัวเชื่อม backend (token, fetch)
│  ├─ app.js                    SPA 6 เมนู (escapeHtml, recalcAuto, กริดเลขไมล์)
│  └─ style.css
├─ .github/workflows/pages.yml  (ทางเลือก) auto-deploy doc/ ขึ้น Pages
└─ README.md
```

---

## ขั้นตอนติดตั้ง (ครั้งเดียว ~15 นาที)

### 1) เตรียม Google Sheets + Drive
1. สร้าง **Google Spreadsheet** เปล่า 1 ไฟล์ → คัดลอก **Spreadsheet ID** จาก URL
   `https://docs.google.com/spreadsheets/d/`**`<นี่คือ ID>`**`/edit`
2. สร้าง **โฟลเดอร์ใน Google Drive** สำหรับเก็บไฟล์แนบ → เปิดโฟลเดอร์ คัดลอก **Folder ID** จาก URL
   `https://drive.google.com/drive/folders/`**`<นี่คือ Folder ID>`**

### 2) สร้าง Apps Script project
**วิธี A — ผูกกับ Spreadsheet (ง่ายสุด):**
เปิด Spreadsheet → เมนู **ส่วนขยาย (Extensions) → Apps Script** → ลบไฟล์ตัวอย่าง
แล้วสร้างไฟล์ตามรายชื่อในโฟลเดอร์ `gas/` คัดลอกเนื้อหาทุกไฟล์มาวาง
(ไฟล์ `appsscript.json` ดูได้ที่ Project Settings → ☑ Show "appsscript.json")

**วิธี B — ใช้ clasp (push ทั้งโฟลเดอร์ทีเดียว):**
```bash
npm i -g @google/clasp
clasp login
clasp create --type standalone --title "Vehicle PM" --rootDir ./gas
# คัดลอก scriptId ที่ได้ไปใส่ gas/.clasp.json (ดูตัวอย่าง .clasp.json.example)
clasp push
```

### 3) ตั้งค่า Script Properties
ใน Apps Script editor → ⚙️ **Project Settings → Script properties → Add**
| Property | ค่า |
|---|---|
| `SPREADSHEET_ID`  | ID จากข้อ 1.1 |
| `DRIVE_FOLDER_ID` | Folder ID จากข้อ 1.2 |

### 4) รัน Setup
ในเมนู editor เลือกฟังก์ชัน **`Setup`** → กด **Run** → กดอนุญาตสิทธิ์ (Sheets + Drive)
จะสร้าง sheet ทุกตาราง + ผู้ใช้แอดมินเริ่มต้น **`admin` / `admin123`**

### 5) Deploy เป็น Web App
**Deploy → New deployment → ⚙️ → Web app**
- Execute as: **Me**
- Who has access: **Anyone**
- กด Deploy → คัดลอก **Web app URL** (ลงท้าย `/exec`)

> ทุกครั้งที่แก้โค้ด backend ต้อง **Deploy → Manage deployments → แก้ deployment เดิม → Version: New** เพื่ออัปเดต (ไม่งั้น URL เดิมยังรันโค้ดเก่า)

### 6) ตั้งค่า Frontend + เปิด GitHub Pages
1. แก้ `docs/config.js` → วาง Web app URL ลงใน `API_URL`
2. push โปรเจ็คขึ้น GitHub
3. **Settings → Pages → Source: Deploy from a branch → Branch: `main` / folder: `/docs`** → Save
   (หรือใช้ workflow `pages.yml` ที่ให้มา — Settings → Pages → Source: GitHub Actions)
4. เปิด URL ของ Pages → login ด้วย `admin` / `admin123`

---

## การจัดการผู้ใช้ & สิทธิ์

- ผู้ใช้เก็บใน sheet **`Users`** : `EmpId, EmpName, PasswordHash, IsAdmin, AllowedMenus, IsActive`
- เพิ่ม/แก้ผู้ใช้: รันฟังก์ชัน `addUser(empId, empName, password, isAdmin, allowedMenusCsv)` จาก editor
  เช่น `addUser('somchai','สมชาย','1234', false, 'pk_vehicle_registry,pk_vehicle_mileage')`
- **menu keys** (ใส่ใน AllowedMenus คั่นด้วย comma):
  `pk_vehicle_registry, pk_vehicle_plan, pk_vehicle_repair, pk_vehicle_log, pk_vehicle_history, pk_vehicle_mileage`
- มี key `pk_vehicle_*` อย่างน้อย 1 ตัว → อ่าน/ใช้ dropdown ข้ามจอได้ ; ส่วน **write** ต้องมี key ของจอนั้นเอง
- `IsAdmin = TRUE` ผ่านทุกอย่าง

---

## กฎทางธุรกิจที่ย้ายมาครบ (mapping กับ spec)

| spec | ไฟล์ที่ทำ | หมายเหตุ |
|---|---|---|
| §5.1 AUTO 5 ฟิลด์ของรถ | `Vehicle.gs:bindVehicleParams_` | EndDate=renew+1y, NextInspect=last+freq, NextOilKm=lastM+freq — server เป็นตัวตัดสิน |
| §4.2 reminder 3 sources | `Plan.gs:Plan_dueSoon` | plan(ตัดน้ำมัน) + registry(unpivot 4, ไม่มี lower bound→overdue โชว์) + oilchange(≤1000กม.) |
| §4.2 หมุนวงรอบ | `Plan.gs:Plan_renewRegistry/completePlan/renewOilChange` | คำนวณวันถัดไป server-side |
| §5.3 เลขเอกสาร | `Util.gs:genDocNo` + `withLock` | LockService = analog ของ TABLOCKX ; reset ทุกเดือน |
| §4.4 ใบงาน 1 ธุรกรรม | `MaintenanceLog.gs:Log_save` | คำนวณยอด server-side, replace detail, roll plan, sync request status |
| §5.2 ยอดเงิน | `Util.gs:round2` | Amount=qty×price, Parts=Σ, Total=Labor+Parts (ปัด away-from-zero) |
| §6 ไฟล์แนบ | `MaintenanceLog.gs` (Drive) | scope ด้วย (Module, RefID) + IDOR guard ทุก get/delete |
| §4.6 เลขไมล์ | `Mileage.gs` | `syncVehicleMileage_` = ผู้เขียน CurrentMileage คนเดียว |
| §8.6 odometer guard | `Mileage.gs:odoGuard_` | reject ถอยหลัง + jump>50,000 |
| §8.4 auto oil-plan | `Mileage.gs:maybeCreateOilPlan_` | dedup ที่ vehicle+TaskName |
| §8.9 monthlyKm | `Mileage.gs:monthlyKm_` | Σ max(0, r[i]-r[i-1]) รองรับ reset |
| §8.7 request revert | `RepairRequest.gs:recomputeRequestStatus_` | ลบ/ยกเลิก log ปิดงาน → คำนวณสถานะใหม่ |
| §8.13 stored XSS | `app.js:escapeHtml` | escape ทุก field ที่มาจากผู้ใช้ |

---

## ข้อแตกต่างจาก spec เดิม (เพราะเปลี่ยน stack)

- **transaction/TABLOCKX** → ใช้ `LockService.getScriptLock()` ครอบทุก write (serialize ทั้งสคริปต์)
- **UNIQUE filtered index** → ใช้ logic UPSERT by key ในโค้ด (กัน active ซ้ำต่อวัน/ทะเบียนซ้ำ) แทน DB constraint
- **PostgreSQL BLOB** → Google Drive (เก็บ metadata ใน sheet `Receipts`, ไฟล์จริงใน Drive folder)
- **session ใน SQL** → token ใน `CacheService` (TTL 6 ชม., sliding) — cache หาย = ต้อง login ใหม่
- **VIEW** เมนู 5 → อ่าน `MaintenanceLog` (active) + join `Vehicle` ในโค้ด
- วันที่เก็บเป็น string `yyyy-MM-dd` (Gregorian, timezone Asia/Bangkok ไม่ shift UTC)

---

## ทดสอบหลัง deploy (smoke test)

1. login `admin/admin123`
2. เมนู 1 → เพิ่มรถ (กรอกวันต่อทะเบียน → ดูช่อง AUTO เด้งวันหมดอายุ)
3. เมนู 6 → เลือกรถ+เดือน → กรอกเลขไมล์ไล่วัน → บันทึก (ลองกรอกถอยหลัง = ต้อง error)
4. เมนู 3 → แจ้งซ่อม → ได้เลข `VR....-001`
5. เมนู 4 → บันทึกงานอ้างใบแจ้งซ่อม + ใส่อะไหล่ → ยอดรวมคำนวณเอง → สถานะใบแจ้งซ่อมเป็น "เสร็จสิ้น"
6. เมนู 2 → ดูกล่อง "ครบกำหนดเร็วๆนี้" (รถที่ใกล้หมดทะเบียน/น้ำมันใกล้ครบ ต้องโผล่)
7. เมนู 5 → ดูประวัติ + สรุปยอดต่อคัน

> ⚠️ ความปลอดภัย: รหัสผ่าน hash ด้วย SHA-256 + salt คงที่ และ Web app เปิด public —
> เหมาะกับงานภายใน/ทีมเล็ก ถ้าใช้จริงจังควรเปลี่ยน salt, บังคับเปลี่ยนรหัส admin, และพิจารณา IP allowlist/Google login
```
