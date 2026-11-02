# รายงาน Test Coverage Baseline

รันเมื่อ 1 พฤศจิกายน 2569 (2026-11-01) กับโค้ดปัจจุบัน (API Gateway + boardgame-service + notification-service + auth-service) ด้วยคำสั่ง `npm run test:coverage` (Jest 30.5.2 + Supertest 7, Node.js 24.14.0)

## 1. สรุปผล

| ตัวชี้วัด  | Coverage   | (ครอบคลุม / ทั้งหมด) |
| ---------- | ---------- | -------------------- |
| Statements | **92.03%** | 740 / 804            |
| Branches   | **83.71%** | 437 / 522            |
| Functions  | **83.89%** | 99 / 118             |
| Lines      | **92.87%** | 678 / 730            |

**Test: 270 รายการ ผ่านทั้งหมด 270 (ล้มเหลว 0)** ใน 12 test suite ครอบคลุมโค้ดของทั้ง 4 process (Gateway และ 3 microservice) และสคริปต์สร้าง admin

> ตัวเลขรวมลดลงจากรอบก่อน (Lines 95.53%) เพราะเพิ่ม `scripts/create-admin.js` เข้ามาในการวัด ส่วนที่ไม่ถูกรันคือการถามรหัสผ่านทางหน้าจอและส่วนที่รันจาก command line (ดูข้อ 2) โค้ดเดิมไม่ได้มี test ลดลง

### Coverage แยกตามไฟล์

| ไฟล์                                      | Stmts  | Branch | Funcs  | Lines  | บรรทัดที่ไม่ถูกรัน              |
| ----------------------------------------- | ------ | ------ | ------ | ------ | ------------------------------- |
| `src/cache.js` (cache, สัปดาห์ที่ 7)       | 100%   | 100%   | 100%   | 100%   | -                               |
| `src/index.js` (boardgame-service)        | 98.08% | 94.58% | 96.96% | 98.20% | 916-922 (`app.listen`)          |
| `src/services/external-api.js`            | 98.21% | 92.00% | 90.00% | 100%   | - (ขาดบาง branch ดูข้อ 4)       |
| `gateway/index.js` (API Gateway)          | 91.86% | 78.88% | 96.00% | 92.92% | 227 (ส่งต่อ header `X-Cache`), 372-380 (`app.listen`) |
| `services/auth-service/index.js`          | 88.97% | 74.15% | 81.25% | 90.51% | 171, 199 (DB error ของ login, /me), 229-230 (ข้อความตอนอัปเดต admin จาก .env), 254-261 (`app.listen`) |
| `services/auth-service/password.js`       | 100%   | 100%   | 100%   | 100%   | -                               |
| `services/auth-service/admin.js` (สร้าง/sync admin) | 100% | 100% | 100% | 100% | -                       |
| `scripts/create-admin.js` (คำสั่ง create-admin) | 24.13% | 12.50% | 0%  | 25.92% | 22-30 (ถามรหัสผ่านแบบซ่อน), 36-54 (ส่วนที่รันจาก command line) |
| `services/notification-service/index.js`  | 88.73% | 72.34% | 83.33% | 92.53% | 189-195 (`app.listen`)          |
| `db.js`                                   | 0%     | 0%     | 100%   | 0%     | 9-23 (ถูก mock ทุก test)         |

## 2. ไฟล์ที่ coverage ต่ำสุด (เรียงตาม Lines)

| อันดับ | ไฟล์ | Lines / Branch | ทำไมยังต่ำ | ความเสี่ยงของการไม่มี test | ลดความเสี่ยงด้วย |
| --- | --- | --- | --- | --- | --- |
| 1 | `db.js` | 0% / 0% | ทุก test `jest.mock("../db")` เพื่อให้รันได้โดยไม่ต้องมี MySQL ไฟล์นี้จึงไม่ถูกโหลดจริงเลย | ค่า config ผิด (เช่นชื่อ env สะกดผิด ค่า default ผิด) แล้ว test ทั้งหมดยังผ่าน แต่ระบบจริงต่อฐานข้อมูลไม่ได้ | ไฟล์มีแค่ `createPool` ไม่มี logic, ตรวจด้วย `GET /api/v1/health` (รายงาน `database: up/down`), Postman และ failure scenario บน MySQL จริง |
| 2 | `scripts/create-admin.js` | 25.92% / 12.50% | ไฟล์เหลือแค่ส่วนรับคำสั่ง: `askHidden()` ที่ต้องมีหน้าจอ terminal จริง และส่วนอ่าน argument/พิมพ์ผล/ปิด pool ส่วน logic ทั้งหมดย้ายไป `services/auth-service/admin.js` ซึ่ง coverage 100% (สร้างใหม่, เลื่อนผู้ใช้เดิม, เป็น admin อยู่แล้ว, ข้อมูลผิด) | ถ้าส่วนถามรหัสผ่านพัง ผู้ดูแลยังใส่รหัสในคำสั่งได้ ไม่กระทบระบบที่รันอยู่ เพราะสคริปต์รันเฉพาะตอนผู้ดูแลสั่งเอง | ทดสอบรันจริงกับ MySQL (E2E สิทธิ์ admin): สร้าง admin ใหม่ และเลื่อนผู้ใช้เดิมเป็น admin ได้ข้อความถูกต้อง |
| 3 | `services/auth-service/index.js` | 90.51% / 74.15% | `app.listen`, ฐานข้อมูลล่มระหว่าง login และ /me (ส่งเข้า error handler 500) | ฐานข้อมูลล่มตอน login อาจตอบ 500 แทนข้อความที่ชัดกว่า แต่ไม่รั่วข้อมูล (ข้อความ 500 เป็นข้อความกลาง) | ส่วนสำคัญด้านความปลอดภัยมี test ครบ: hash + salt สุ่ม, ไม่เก็บรหัสจริง, รหัสผิด/ไม่มีผู้ใช้ตอบเหมือนกัน, token ปลอม/หมดอายุ, ไม่มี JWT_SECRET → 503 |
| 4 | `services/notification-service/index.js` | 92.53% / 72.34% | `app.listen`, ค่า default ของ env, error handler 500, การตัดประวัติเกิน 50 รายการ | ประวัติแจ้งเตือนอาจโตเกิน 50 ถ้าการตัดทิ้งผิด (กินหน่วยความจำเพิ่มทีละน้อย) แต่ไม่กระทบการเพิ่มบอร์ดเกม เพราะมี fallback | ส่วนส่ง Discord / timeout / 502 / 504 มี test ครบแล้ว ส่วนที่ขาดเป็นงานเสริม ไม่ใช่เส้นทางหลัก |
| 5 | `gateway/index.js` | 92.92% / 78.88% | `app.listen` (test ใช้ Supertest ไม่เปิดพอร์ตจริง), การส่งต่อ header `X-Cache` (stub service ใน test ไม่ส่ง header นี้), ค่า default ของ env, branch ที่ service ตอบกลับไม่ใช่ JSON | Gateway เป็นจุดเข้าถึงเดียว ถ้าส่วนที่ไม่มี test พังคือทั้งระบบใช้ไม่ได้ แต่ส่วนที่ขาดเป็นการเปิดพอร์ตและกรณีป้องกันที่ service ในระบบไม่เคยตอบ | รัน `npm start` จริงก่อน demo (ถ้าพอร์ตไม่ว่างจะแจ้ง error ชัดเจนและหยุด), Postman 30 request ผ่าน Gateway จริง, failure scenario ส่วน A |

## 3. Test Suite ที่มี

รูปแบบเดียวกับปฏิบัติการสัปดาห์ที่ 9 คือ Jest + Supertest และ mock `db` ด้วย `jest.mock()` จึงรัน test ได้โดยไม่ต้องมีฐานข้อมูล
(`tests/setup-env.js` ปิด cache ระหว่าง test เพื่อไม่ให้ผลของ test ก่อนหน้าค้าง ส่วน cache ทดสอบแยกใน `cache.test.js`)

| ไฟล์ test                            | จำนวน | ครอบคลุมอะไร |
| ------------------------------------ | ----- | --- |
| `tests/boardgames.test.js`           | 67    | **boardgame-service** CRUD บอร์ดเกม 6 endpoint: สำเร็จ, validation ทุกกรณี, 404, 409, 413, JSON ผิดรูปแบบ, DB error 500, fallback แจ้งเตือน, **Pagination/Sorting (สัปดาห์ที่ 7)**: LIMIT/OFFSET, ข้อมูลหน้า, เรียง 5 แบบ, หน้าเกินจำนวนจริง, query ไม่ถูกต้อง 9 กรณีรวม `sort` ที่พยายามแทรก SQL → 400 โดยไม่แตะฐานข้อมูล |
| `tests/gateway.test.js`              | 56    | **API Gateway (สัปดาห์ที่ 13)** ด้วย stub service จริงผ่าน HTTP: ส่งต่อคำขอและ query string, ส่งต่อ 4xx ของ service, **ตรวจ JWT**: เพิ่ม/แก้ไข/ลบทั้ง 9 endpoint ไม่มี token → 401 และไม่ถูกส่งต่อ / token admin → ส่งต่อ, **สิทธิ์ตาม role**: member เพิ่ม/แก้ไข/ผูก-ถอดหมวดหมู่ได้ 7 endpoint, member ลบบอร์ดเกม/หมวดหมู่ → 403 ไม่ถูกส่งต่อ, token รุ่นเก่าที่ไม่มี role ถือเป็น member, ปลอม role admin โดยไม่มี secret → 401, token หมดอายุ → `TOKEN_EXPIRED`, token ลงชื่อด้วย secret อื่น/เสีย → `INVALID_TOKEN`, ไม่ตั้ง `JWT_SECRET` → 503, GET ยังไม่ต้องใช้ token, ส่งต่อ register/login/me ไป auth-service (พร้อม header Authorization), auth-service ล่ม → login 503 แต่ token เดิมยังเขียนข้อมูลได้, service ล่ม → 503 แล้วกลับมาใช้ได้, service ช้า → 504, health ok/degraded/down (รวม authService), JSON ผิดรูปแบบถูกปฏิเสธที่ Gateway, เสิร์ฟ `/app` และ `/api-docs` |
| `tests/auth-service.test.js`         | 30    | **auth-service**: health (DB up/down), สมัครได้ role member เสมอแม้ส่ง `role: "admin"` มา, เข้าสู่ระบบ admin ได้ token ที่มี role admin, สมัคร: เก็บ scrypt hash ไม่ใช่รหัสจริง, salt สุ่มต่างกันทุกครั้ง, ชื่อซ้ำ → 409, validation 8 กรณี → 400 โดยไม่แตะฐานข้อมูล, DB error → 500, เข้าสู่ระบบ: JWT ที่ verify ได้และมีอายุ 2 ชั่วโมง, `JWT_EXPIRES_IN`, รหัสผิด/ไม่มีผู้ใช้ → 401 ข้อความเดียวกัน, hash เสียไม่ทำให้ crash, ไม่ตั้ง `JWT_SECRET` → 503, /auth/me: token ถูก/ไม่มี/ไม่ใช่ Bearer/secret อื่น/หมดอายุ/ผู้ใช้ถูกลบ |
| `tests/categories.test.js`           | 23    | CRUD หมวดหมู่ 5 endpoint |
| `tests/boardgame-categories.test.js` | 18    | ผูก/ถอด/ดูหมวดหมู่ของเกม รวม 409 และ 404 แยกเกม/หมวดหมู่ |
| `tests/external-api.test.js`         | 14    | **Retry** (5xx, 429, network error ครบ 3 ครั้ง, ไม่ retry 4xx), **Timeout** (abort จริง), exponential backoff, **Fallback**, URL ค่าเริ่มต้น |
| `tests/notification-service.test.js` | 12    | **notification-service**: health, ส่ง Discord สำเร็จ, ไม่ได้ตั้งค่า webhook, Discord 5xx → 502, ติดต่อไม่ได้ → 502, timeout → 504, validation, ประวัติ |
| `tests/cache.test.js`                | 11    | **Caching (สัปดาห์ที่ 7)**: ครั้งแรก MISS ครั้งที่สอง HIT ไม่แตะฐานข้อมูล, query string ต่างกันเก็บแยก, เขียนสำเร็จล้าง cache / เขียนไม่สำเร็จไม่ล้าง, ไม่ cache 404, หมดอายุตาม TTL, ข้อมูลที่อ่านก่อนการแก้ไขไม่ค้างใน cache, จำกัด 100 รายการ, ปิดด้วย `CACHE_TTL_MS=0` |
| `tests/create-admin.test.js`         | 17    | **สร้าง admin**: ชื่อใหม่ → INSERT เป็น admin พร้อม scrypt hash, ไม่ใส่รหัสในคำสั่ง → ถามรหัส, ผู้ใช้เดิม → เลื่อนเป็น admin ไม่แตะรหัสผ่าน, เป็น admin อยู่แล้ว → ไม่เปลี่ยน, ชื่อ/รหัสผิด → error ไม่ INSERT / **admin จาก .env**: ยังไม่มี → สร้าง, ตรงแล้ว → ไม่แตะฐานข้อมูล (รีสตาร์ทได้), member ชื่อเดียวกัน → ตั้งเป็น admin, รหัสใน .env เปลี่ยน → รหัสในฐานข้อมูลเปลี่ยนตาม, ค่าผิดกฎ → ไม่แตะฐานข้อมูล, ตั้งไม่ครบคู่ → ข้าม, ตารางยังไม่มี → แจ้งให้ migrate แต่ service ไม่ล่ม |
| `tests/openapi-code-match.test.js`   | 9     | **Swagger/Code Match** อัตโนมัติ: route ที่มี `requireAdmin` ตรงกับ operation ที่มี response 403 พอดี (2 endpoint), route ของ Gateway, notification-service และ auth-service ตรงกับ `openapi.yaml`, route ที่ Gateway ส่งต่อตรงกับ route ของ boardgame-service, route ที่มี `requireAuth` ตรงกับ operation ที่มี `security: bearerAuth` พอดี (10 endpoint), ทุก operation มี `operationId`/`summary`/`responses`, `operationId` ไม่ซ้ำ, `$ref` ไม่เสีย |
| `tests/rate-limit.test.js`           | 9     | **Rate limiting (สัปดาห์ที่ 12)**: เกินโควตา → 429 + `Retry-After` และไม่ถูกส่งต่อ, ทุก endpoint ใต้ `/api/v1` ใช้โควตาร่วมกัน, โควตากลับมาเมื่อครบช่วงเวลา, health ไม่ถูกจำกัด, ปิดด้วย `MAX=0`, ค่าเริ่มต้น 300 ครั้ง/นาที, **login/register** 10 ครั้ง/นาทีใช้โควตาร่วมกัน ถูกบล็อกแล้วยังดูข้อมูลได้ |
| `tests/system.test.js`               | 4     | `/health` ของ boardgame-service (DB up/down), Swagger UI, 404 |

นอกจาก Jest แล้ว ยังทดสอบกับระบบจริง (ไม่นับรวมในตัวเลข coverage ด้านบน)

- **admin จาก .env** (1 พ.ย. 2569) บน MySQL จริง (ฐานข้อมูลชั่วคราว) ด้วยค่า `ADMIN_USERNAME`/`ADMIN_PASSWORD` จริงใน `.env`: เปิด auth-service แล้วสร้างบัญชี admin, เข้าสู่ระบบได้ role admin, ลบเกมได้, รีสตาร์ทแล้วไม่สร้างซ้ำ (ยังมี 1 บัญชี)
- **สิทธิ์ admin/member E2E** (1 พ.ย. 2569) บน MySQL จริง + Edge แบบ headless **22 รายการผ่านทั้งหมด**: สร้าง admin ด้วย `npm run create-admin`, สมัครโดยส่ง `role: "admin"` ยังได้ member, member เพิ่ม/แก้ไข/ผูก-ถอดหมวดหมู่ได้, member ลบเกม/หมวดหมู่ → 403 และเกมยังอยู่, admin ลบได้, เลื่อนผู้ใช้เดิมเป็น admin แล้ว token เดิมยังเป็น member จนเข้าสู่ระบบใหม่, หน้าเว็บ member ไม่มีปุ่มลบ / admin มีป้าย "admin" และลบผ่านหน้าเว็บได้
- **ระบบ login E2E** (1 พ.ย. 2569) บน MySQL จริง + Microsoft Edge แบบ headless ควบคุมด้วย DevTools Protocol **27 รายการผ่านทั้งหมด**: สมัคร 201, ชื่อซ้ำแบบตัวพิมพ์ต่างกัน (`ALICE`) → 409, รหัสผิด → 401, เพิ่มเกมไม่มี token/token ถูกแก้ → 401, มี token → 201, GET ไม่ต้องใช้ token, หน้าเว็บโหมดผู้เยี่ยมชมซ่อนฟอร์มและปุ่มแก้ไข/ลบ, ฟอร์มสมัครตรวจรูปแบบและรหัสยืนยันฝั่ง Frontend, สมัครแล้วเข้าสู่ระบบอัตโนมัติ, เพิ่มเกมผ่านฟอร์ม, รีเฟรชแล้วยังเข้าสู่ระบบอยู่, token เสีย → ออกจากระบบและเปิดหน้าต่างเข้าสู่ระบบ, ออกจากระบบ
- **Failure scenario ผ่าน Gateway บน MySQL จริง** (1 พ.ย. 2569) 5 กรณี G0-G4 ผ่านตามที่ออกแบบทั้งหมด: notification ล่ม → เพิ่มเกมยังได้ 201 + retry 3 ครั้ง, boardgame-service ล่ม → 503 แล้วกลับมาเองได้, service ค้าง → 504 ที่ 10 วินาที, Discord URL ไม่มีอยู่จริง → fallback ดู `failure-scenario-results.md`
- **Frontend บนเบราว์เซอร์จริง** (Microsoft Edge แบบ headless, 1 พ.ย. 2569): เปิด `http://localhost:3000/app` แล้วป้ายสถานะเป็น "ระบบพร้อมใช้งาน", รายการเกมพร้อมหมวดหมู่และตัวแบ่งหน้า, หมวดหมู่ และการแจ้งเตือนล่าสุดโหลดจาก API จริงครบ
- **ตรวจฟอร์มฝั่ง Frontend** (`validateGame` / `validateCategory` ใน `frontend/app.js`) ทดสอบ 9 กรณี: ชื่อว่าง, ชื่อเกิน 100 ตัวอักษร, ผู้เล่นว่าง, ทศนิยม, 0, max < min, ข้อมูลถูกต้อง, ชื่อหมวดหมู่ว่าง/ถูกต้อง ได้ผลตรงกับกฎของ API ทุกกรณี
- **Postman Collection** (`postman_collection.json`) รันด้วย `postman collection run` กับ service จริงทั้ง 4 ตัวและฐานข้อมูลที่รัน `seed.sql` ใหม่ + สร้าง `admin_demo` (1 พ.ย. 2569): **30 request / 60 assertion ผ่านทั้งหมด** รวมโฟลเดอร์ Auth (สมัคร, รหัสผิด 401, เข้าสู่ระบบเก็บ token, /me, เพิ่มเกมไม่มี token 401, เข้าสู่ระบบ admin, member ลบ 403) และการลบที่ใช้ token ของ admin
- **Migration** ทดสอบบนฐานข้อมูลชั่วคราว: ขึ้นครบ 6 ไฟล์จากฐานข้อมูลว่าง (1 พ.ย. 2569), รันซ้ำไม่มีอะไรเปลี่ยน, ย้อนและขึ้นใหม่ได้
- **วัดประสิทธิภาพเมื่อข้อมูลโต** 1,000 / 10,000 / 100,000 เกม ดู `scalability-design.md`
- **บั๊กที่ unit test จับไม่ได้แต่ทดสอบกับ MySQL จริงจับได้**: MySQL 8.0 ไม่สน `ORDER BY` เมื่อใช้ `GROUP_CONCAT(... ORDER BY)` คู่กับ `COUNT(*) OVER()` ใน SELECT เดียวกัน (unit test mock ฐานข้อมูลจึงเห็นแค่ข้อความ SQL ที่ถูกต้อง) แก้โดยจัดกลุ่มใน subquery ก่อนแล้วจึงเรียง/แบ่งหน้าข้างนอก

## 4. จุดที่ยังไม่มี test ครอบคลุม

| จุด | เหตุผล / ความเสี่ยง |
| --- | --- |
| `db.js` (0%) | ดูข้อ 2 อันดับ 1 |
| `app.listen(...)` ของทั้ง 4 process | test ใช้ Supertest เรียก app โดยตรง ไม่ได้เปิดพอร์ตจริง ส่วนนี้ทดสอบโดยรัน `npm start` จริง |
| ค่า default จาก env (`PORT \|\| 3000`, `BOARDGAME_SERVICE_URL \|\| ...` ฯลฯ ใน Gateway และพอร์ตของแต่ละ service) | test ตั้งค่า env เอง จึงไม่ได้รัน branch ที่ใช้ค่า default |
| Gateway: service ตอบกลับเป็นข้อความที่ไม่ใช่ JSON (`res.send`) | service ทุกตัวในระบบตอบ JSON เสมอ กรณีนี้เป็นการป้องกันไว้เท่านั้น |
| Gateway / notification / auth: error ที่ไม่มี `err.code` หรือ `err.type`, error handler 500 และฐานข้อมูลล่มระหว่าง login หรือ /me ของ auth-service | ไม่มีโค้ดที่ throw แบบไม่คาดคิด จึงจำลองไม่ได้โดยไม่แก้โค้ด |
| `req.body \|\| {}` เมื่อไม่มี body เลย | ทุก test ส่ง body เป็น JSON (ทดสอบด้วยมือแล้วได้ 400 MISSING_FIELDS) |
| `morgan` (logging) เมื่อไม่ใช่ `NODE_ENV=test` | ปิด log ตอน test เพื่อไม่ให้ผลรกและช้า |
| `scripts/migrate.js`, `scripts/start-all.js`, `scripts/mock-external.js` (`create-admin.js` วัดแล้ว ดูข้อ 2) | ไม่อยู่ใน `collectCoverageFrom` เพราะเป็นเครื่องมือรัน/ทดสอบ ไม่ใช่โค้ดของ API ทดสอบด้วยการใช้งานจริง |
| `frontend/app.js` | ไม่อยู่ในตัวเลข coverage ของ Jest (โค้ดฝั่งเบราว์เซอร์) ทดสอบด้วย E2E บนเบราว์เซอร์จริง 27 รายการ (ข้อ 3) แต่สคริปต์ E2E ยังไม่ได้เก็บเป็นไฟล์ test ในโปรเจกต์ |
| การปิดบัญชี / เปลี่ยนรหัสผ่าน / เพิกถอน token ก่อนหมดอายุ | ยังไม่มีฟีเจอร์นี้ token ที่ออกไปแล้วใช้ได้จนหมดอายุ (2 ชั่วโมง) แม้ออกจากระบบ (ออกจากระบบ = ลบ token ที่เบราว์เซอร์) |
| ประวัติแจ้งเตือนเกิน 50 รายการ | ไม่ได้ทดสอบการตัดรายการเก่าทิ้ง |

## 5. วิธีรันซ้ำ

```bash
npm install
npm test               # รัน test ทั้งหมด
npm run test:coverage  # รันพร้อมรายงาน coverage (HTML อยู่ที่ coverage/lcov-report/index.html)
```
