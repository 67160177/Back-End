# ปฏิบัติการสัปดาห์ที่ 13: แยกบริการแบบ Microservices (services-lab)

แยก student-api ออกเป็น **Student Service** (พอร์ต 4001) และ **API Gateway** (พอร์ต 3000) ตามใบงาน

```
services-lab/
├── student-service/   CRUD ข้อมูลนิสิต (ข้อมูลจำลองในหน่วยความจำ)
└── gateway/           Authentication (JWT) ส่วนกลาง + routing ไป Student Service
```

## วิธีรัน (เปิด terminal 2 หน้าต่าง)

```bash
# terminal 1
cd services-lab/student-service
npm install
npm start                 # Student Service running on port 4001

# terminal 2
cd services-lab/gateway
npm install
cp .env.example .env      # JWT_SECRET=lab-secret-key-for-classroom-use-only
npm start                 # API Gateway running on port 3000
npm run token             # สร้าง token ทดสอบ (หน้าต่างอื่น)
```

> ถ้ามีโปรแกรมอื่นใช้พอร์ต 3000 อยู่ (เช่น เซิร์ฟเวอร์ของโครงงาน) ให้ปิดก่อน

## ผลการทดสอบ

ทดสอบเมื่อ 27 ตุลาคม 2569 (2026-10-27) ด้วย curl บน Node.js 24

### จุดตรวจสอบที่ 1

| รายการ | ผล |
| --- | --- |
| ชุดทดสอบ Jest/Supertest เดิมของ student-api | ✅ `Test Suites: 8 passed`, `Tests: 46 passed` |
| endpoint `GET /api/v1/students/:id/enrichment` (สัปดาห์ที่ 11) | ⚠️ **ไม่พบใน student-api** (`app.js` ไม่มี route นี้ และไม่มี `services/external-api.js`) ต้องทำงานสัปดาห์ที่ 11 บน student-api เพิ่ม |

การแบ่งบริการ

| บริการ | พอร์ต | ความรับผิดชอบ |
| --- | --- | --- |
| Student Service | 4001 | CRUD ข้อมูลนิสิต (ย้ายจาก route เดิม) |
| API Gateway | 3000 | Authentication ส่วนกลาง + routing ไปยัง Student Service |

### จุดตรวจสอบที่ 2

**2.2 เรียก Student Service ตรง (ไม่ผ่าน Gateway)**

```
GET http://localhost:4001/students
200 {"data":[{"id":1,"name":"สมชาย ใจดี","major":"Computer Science"},{"id":2,"name":"สมหญิง รักเรียน","major":"Information Technology"}]}
```

**2.5 เรียกผ่าน Gateway พร้อม token**

```
GET http://localhost:3000/api/v1/students        Authorization: Bearer <token>
200 {"data":[{"id":1,...},{"id":2,...}]}

GET http://localhost:3000/api/v1/students/2      Authorization: Bearer <token>
200 {"data":{"id":2,"name":"สมหญิง รักเรียน","major":"Information Technology"}}

GET http://localhost:3000/api/v1/students/99     Authorization: Bearer <token>
404 {"error":{"code":"NOT_FOUND","message":"Student not found"}}   (Gateway ส่งต่อ 404 จาก service ตามเดิม)
```

**2.5 เรียกผ่าน Gateway โดยไม่มี token / token ผิด**

```
GET http://localhost:3000/api/v1/students        (ไม่มี header)
401 {"error":{"code":"UNAUTHORIZED","message":"Missing or invalid token"}}

GET http://localhost:3000/api/v1/students        Authorization: Bearer abc.def.ghi
401 {"error":{"code":"UNAUTHORIZED","message":"Invalid or expired token"}}
```

log ของ Student Service ก่อนและหลังเรียกแบบไม่มี token มี 5 บรรทัดเท่าเดิม แสดงว่า **request ที่ไม่มี token ถูกปฏิเสธที่ Gateway และไม่ถูกส่งต่อไปที่ Student Service**

```
Student Service running on port 4001
[student-service] GET /students        <- เรียกตรง (2.2)
[student-service] GET /students        <- ผ่าน Gateway พร้อม token
[student-service] GET /students/2
[student-service] GET /students/99
                                        <- ไม่มีบรรทัดใหม่จากคำขอที่ไม่มี token
```

### จุดตรวจสอบที่ 3

**3.1 หยุด Student Service แล้วเรียกผ่าน Gateway**

```
GET http://localhost:3000/api/v1/students        Authorization: Bearer <token>
503 {"error":{"code":"SERVICE_UNAVAILABLE","message":"Student service is currently unavailable"}}   (ตอบใน 0.004 วินาที)

GET http://localhost:3000/api/v1/students/1      (เรียกซ้ำ)
503 {"error":{"code":"SERVICE_UNAVAILABLE",...}}                                                    (Gateway ยังทำงานอยู่)
```

เปิด Student Service กลับมา แล้วเรียกซ้ำได้ `200` ทันทีโดยไม่ต้องรีสตาร์ท Gateway

| รายการ | ผล |
| --- | --- |
| Gateway ตอบ 503 พร้อมข้อความที่มีความหมาย | ✅ |
| ไม่ค้าง | ✅ ตอบภายในไม่กี่มิลลิวินาที (connection refused ทันที และมี `timeout: 3000` กันกรณี service ค้าง) |
| Gateway ไม่ crash | ✅ เรียกซ้ำได้ และกลับมาใช้งานได้เมื่อ service กลับมา |

**3.2 ออกแบบสถาปัตยกรรมของระบบโครงงาน** อยู่ที่ `project-phase3-67160177/microservices-design.md`

## สิ่งที่ต่างจากโค้ดในใบงาน

1. **`gateway/generate-test-token.js` ใช้ `require("dotenv").config({ quiet: true })`** เพราะ dotenv v17 พิมพ์ข้อความ `◇ injected env (1) from .env ...` ออก stdout ก่อน token ทำให้ค่าที่คัดลอกไปมีข้อความปน และ Gateway ตอบ 400 (header ไม่ถูกต้อง) พบจากการทดสอบจริง
2. **Student Service มี middleware log ทุก request** (`[student-service] GET /students`) เพื่อใช้ยืนยันจุดตรวจสอบที่ 2 ว่าคำขอที่ไม่มี token ไม่ถูกส่งต่อมา
3. ระหว่างทดสอบ พอร์ต 3000 ถูกใช้โดยเซิร์ฟเวอร์โครงงานที่เปิดค้างอยู่ จึงรัน Gateway สำเนาที่ต่างกันเฉพาะเลขพอร์ต (3300) ในการทดสอบ ผลข้างต้นแสดงเป็นพอร์ต 3000 ตามใบงาน
