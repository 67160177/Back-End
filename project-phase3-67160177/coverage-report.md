# รายงาน Test Coverage Baseline

รันเมื่อ 27 ตุลาคม 2569 (2026-10-27) ด้วยคำสั่ง `npm run test:coverage` (Jest 30.5.2 + Supertest 7, Node.js 24.14.0)

## 1. สรุปผล

| ตัวชี้วัด  | Coverage   | (ครอบคลุม / ทั้งหมด) |
| ---------- | ---------- | -------------------- |
| Statements | **96.67%** | 407 / 421            |
| Branches   | **86.87%** | 225 / 259            |
| Functions  | **92.98%** | 53 / 57              |
| Lines      | **97.61%** | 368 / 377            |

**Test: 133 รายการ ผ่านทั้งหมด 133 (ล้มเหลว 0)** ใน 7 test suite ใช้เวลาประมาณ 2.5 วินาที

### Coverage แยกตามไฟล์

| ไฟล์                                    | Stmts  | Branch | Funcs  | Lines  | บรรทัดที่ไม่ถูกรัน                 |
| --------------------------------------- | ------ | ------ | ------ | ------ | ---------------------------------- |
| `src/index.js` (API หลัก)               | 98.28% | 94.41% | 96.96% | 98.44% | 845-848 (`app.listen`)             |
| `src/services/external-api.js`          | 98.30% | 88.00% | 91.66% | 100%   | - (ขาดบาง branch ดูข้อ 3)          |
| `services/notification-service/index.js`| 92.64% | 75.55% | 83.33% | 96.87% | 187-188 (`app.listen`)             |
| `db.js`                                 | 0%     | 0%     | 100%   | 0%     | 1-15 (ถูก mock ทุก test ดูข้อ 3)   |

## 2. Test Suite ที่มี

รูปแบบเดียวกับปฏิบัติการสัปดาห์ที่ 9 คือ Jest + Supertest และ mock `db` ด้วย `jest.mock()` จึงรัน test ได้โดยไม่ต้องมีฐานข้อมูล

| ไฟล์ test                            | จำนวน | ครอบคลุมอะไร                                                                                      |
| ------------------------------------ | ----- | ------------------------------------------------------------------------------------------------- |
| `tests/boardgames.test.js`           | 50    | CRUD บอร์ดเกมทั้ง 6 endpoint: สำเร็จ, validation ทุกกรณี, 404, 409, 413, JSON ผิดรูปแบบ, DB error 500, fallback แจ้งเตือน |
| `tests/categories.test.js`           | 23    | CRUD หมวดหมู่ทั้ง 5 endpoint                                                                      |
| `tests/boardgame-categories.test.js` | 18    | ผูก/ถอด/ดูหมวดหมู่ของเกม รวม 409 ALREADY_LINKED และ 404 แยกเกม/หมวดหมู่                            |
| `tests/system.test.js`               | 9     | `/`, `/api/v1/health` (ok / degraded / DB down), `/api/v1/notifications`, Swagger UI, Frontend, 404 |
| `tests/external-api.test.js`         | 16    | **Retry** (5xx, 429, network error ครบ 3 ครั้ง, ไม่ retry 4xx), **Timeout** (abort จริง), exponential backoff, **Fallback** |
| `tests/notification-service.test.js` | 12    | **Microservice (สัปดาห์ที่ 13)**: health, ส่ง Discord สำเร็จ, ไม่ได้ตั้งค่า webhook, Discord 5xx → 502, ติดต่อไม่ได้ → 502, timeout → 504, validation, ประวัติ |
| `tests/openapi-code-match.test.js`   | 5     | **Swagger/Code Match** อัตโนมัติ: route ใน Express ของทั้ง 2 service ตรงกับ `openapi.yaml` ทุกตัว, `$ref` ไม่เสีย, operationId ไม่ซ้ำ |

นอกจาก unit/integration test ด้วย Jest แล้ว ยังทดสอบกับระบบจริงอีก 2 ทาง (ไม่นับรวมในตัวเลข coverage ด้านบน)

- **Postman Collection** (`postman_collection.json`) 20 request / 40 assertion รันกับ MySQL จริงและ notification-service จริงด้วย `postman collection run` ผ่านทั้งหมด 2 รอบติดกัน
- **Failure scenario** ของการเชื่อมต่อ service ภายนอก 6 กรณี ดู `failure-scenario-results.md`

## 3. จุดที่ยังไม่มี test ครอบคลุม

| จุด                                                                 | เหตุผล / ความเสี่ยง                                                                                                       |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `db.js` (0%)                                                        | ทุก test mock `db` เพื่อให้รันได้โดยไม่ต้องมี MySQL โค้ดนี้มีแค่การสร้าง connection pool และถูกทดสอบผ่าน Postman กับฐานข้อมูลจริงแทน |
| `app.listen(...)` ของทั้ง 2 service                                 | test ใช้ Supertest เรียก app โดยตรง ไม่ได้เปิดพอร์ตจริง ส่วนนี้ทดสอบโดยรัน `npm start` จริง                              |
| ค่า default จาก env (`PORT \|\| 3000`, `NOTIFICATION_SERVICE_URL \|\| ...`, `DISCORD_TIMEOUT_MS` ไม่ถูกต้อง) | test ตั้งค่า env เอง จึงไม่ได้รัน branch ที่ใช้ค่า default                                                     |
| `req.body \|\| {}` เมื่อไม่มี body เลย                              | ทุก test ส่ง body เป็น JSON ไม่มีกรณีส่ง request ที่ไม่มี Content-Type (ทดสอบด้วยมือแล้วได้ 400 MISSING_FIELDS)         |
| `err.type \|\| "ERROR"` ใน error handler                             | error 4xx ที่ไม่มี `type` ไม่เกิดขึ้นในโค้ดปัจจุบัน (error จาก body-parser มี `type` เสมอ)                              |
| error handler 500 ของ notification-service                          | ไม่มีโค้ดใน service ที่ throw แบบไม่คาดคิด จึงจำลองกรณีนี้ไม่ได้โดยไม่แก้โค้ด                                            |
| `err.cause?.code \|\| err.message` เมื่อ error ไม่มี `cause`         | test จำลองเฉพาะ network error ที่มี `cause.code` (เหมือนที่ Node.js สร้างจริง)                                             |
| `morgan` (logging) เมื่อไม่ใช่ `NODE_ENV=test`                       | ปิด log ตอน test เพื่อไม่ให้ผลรกและช้า                                                                                    |
| `frontend/app.js`                                                   | ยังไม่มี automated test ฝั่ง Frontend (เช่น Playwright) ทดสอบด้วยการใช้งานจริงในเบราว์เซอร์                                |
| ประวัติแจ้งเตือนของ notification-service เก็บในหน่วยความจำ           | test ไม่ได้ครอบคลุมกรณีเกิน 50 รายการ (ตัดรายการเก่าทิ้ง) และข้อมูลหายเมื่อรีสตาร์ท ซึ่งเป็นข้อจำกัดที่ตั้งใจ               |

## 4. วิธีรันซ้ำ

```bash
npm install
npm test               # รัน test ทั้งหมด
npm run test:coverage  # รันพร้อมรายงาน coverage (HTML อยู่ที่ coverage/lcov-report/index.html)
```
