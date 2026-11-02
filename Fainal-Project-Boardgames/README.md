# Board Game Management System (โครงงานระยะที่ 3)

รหัสนิสิต 67160177 · Pno = (7 mod 9) + 1 = **8 ระบบข้อมูลบอร์ดเกม**

ระบบจัดการบอร์ดเกม หมวดหมู่ และความสัมพันธ์แบบ Many-to-Many แบ่งเป็น Microservices ตามปฏิบัติการสัปดาห์ที่ 13

| Process | พอร์ต | หน้าที่ |
| --- | --- | --- |
| **API Gateway** | 3000 | จุดเข้าถึงเดียว: routing, rate limiting, ตรวจ JWT ก่อนเพิ่ม/แก้ไข/ลบ, ลบได้เฉพาะ admin, 503/504, หน้าเว็บ `/app`, เอกสาร `/api-docs` |
| **boardgame-service** | 4001 | CRUD บอร์ดเกม/หมวดหมู่ เชื่อมต่อ MySQL, แบ่งหน้า/เรียงลำดับ, cache |
| **notification-service** | 4002 | ส่งแจ้งเตือนเข้า Discord |
| **auth-service** | 4003 | สมัครสมาชิก, เข้าสู่ระบบ (scrypt) ออก JWT ที่มี role (member / admin) |
| MySQL 8 | 3306 | ฐานข้อมูล (Docker) |

- การแบ่งบริการและเหตุผล: [microservices-design.md](microservices-design.md) (ใบงานสัปดาห์ที่ 13)
- ภาพรวมและการตัดสินใจทางเทคนิค: [architecture.md](architecture.md)
- รองรับการโตของข้อมูล (วัดจริง 1,000-100,000 เกม): [scalability-design.md](scalability-design.md) (สัปดาห์ที่ 14)

## ไฟล์ในโปรเจกต์

| ไฟล์ / โฟลเดอร์ | เนื้อหา | ระยะ |
| --- | --- | --- |
| [requirement.md](requirement.md) | Requirement, Use Case, Resource, Constraint | 1 |
| [erd.pdf](erd.pdf) / [ERD.mwb](ERD.mwb) | ERD (MySQL Workbench) | 1 |
| [schema.sql](schema.sql) / [seed.sql](seed.sql) | โครงสร้างล่าสุดทั้งหมด (snapshot) และข้อมูลตัวอย่าง (รัน seed ซ้ำได้) | 1 |
| [migrations/](migrations/) / [scripts/migrate.js](scripts/migrate.js) | Migration แบบมีเวอร์ชัน ขึ้น/ย้อน/ดูสถานะ (`npm run migrate`) | 3 |
| [db.js](db.js) | Connection Pool (mysql2) | 1 |
| [src/index.js](src/index.js) | boardgame-service (route ทั้งหมดของบอร์ดเกม/หมวดหมู่, pagination/sorting, `/api-docs`) | 1-3 |
| [src/cache.js](src/cache.js) | Cache ผลของ GET ล้างเมื่อมีการเปลี่ยนแปลง | 3 |
| [src/services/external-api.js](src/services/external-api.js) | เรียก notification-service พร้อม Timeout / Retry / Fallback | 2-3 |
| [openapi.yaml](openapi.yaml) | OpenAPI 3.0 ครบทุก endpoint ของ Gateway และ service ภายใน | 2-3 |
| [postman_collection.json](postman_collection.json) | 30 request พร้อมตัวอย่าง response จริง และ test (เข้าสู่ระบบ member และ admin แล้วเก็บ token อัตโนมัติ) | 2-3 |
| [failure-scenario-results.md](failure-scenario-results.md) | ผลทดสอบ failure scenario 11 กรณี (Gateway + Discord) | 2-3 |
| [gateway/](gateway/index.js) | API Gateway | 3 |
| [services/notification-service/](services/notification-service/index.js) | Microservice แจ้งเตือน | 3 |
| [services/auth-service/](services/auth-service/index.js) | Microservice สมัครสมาชิก/เข้าสู่ระบบ (JWT) | 3 |
| [frontend/](frontend/) | หน้าเว็บ HTML/CSS/JS ที่เรียก API จริง | 3 |
| [tests/](tests/) | Jest + Supertest 270 test | 3 |
| [coverage-report.md](coverage-report.md) | รายงาน Test Coverage Baseline | 3 |
| [microservices-design.md](microservices-design.md) | ออกแบบ Microservices (ใบงานสัปดาห์ที่ 13) | 3 |
| [code-walkthrough.md](code-walkthrough.md) | อธิบายโค้ดทั้งหมด เดินตามคำขอจริงทีละไฟล์ | 3 |
| [architecture.md](architecture.md) | สถาปัตยกรรมและเหตุผลการตัดสินใจทางเทคนิค | 3 |
| [scalability-design.md](scalability-design.md) | ผลวัดเมื่อข้อมูลโต จุดที่จะมีปัญหาก่อนและวิธีแก้ (สัปดาห์ที่ 14) | 3 |
| [scripts/create-admin.js](scripts/create-admin.js) | สร้างบัญชี admin / เลื่อนผู้ใช้เดิมเป็น admin (`npm run create-admin`) | 3 |
| [scripts/](scripts/) | `start-all.js` รันทุก service, `migrate.js` migration, `mock-external.js` จำลอง service ล่ม/ช้า | 3 |

## สรุปตามเกณฑ์การให้คะแนนแต่ละระยะ

โปรเจกต์นี้รวมงานระยะที่ 1-3 ไว้ในที่เดียว ตารางนี้บอกว่าเกณฑ์แต่ละข้อดูหลักฐานได้ที่ไหน

### ระยะที่ 1: Requirement และการออกแบบฐานข้อมูล (5 คะแนน)

| เกณฑ์ | คะแนน | หลักฐาน |
| --- | --- | --- |
| Requirement ชัดเจน Use Case ≥ 5 | 1 | [requirement.md](requirement.md) มี 9 use case, resource และความสัมพันธ์ |
| ERD มี PK/FK ครบ | 1.5 | [erd.pdf](erd.pdf), ตาราง constraint ใน [requirement.md](requirement.md) |
| schema.sql รันได้ + UNIQUE/FK | 1.5 | [schema.sql](schema.sql): PK, FK + ON DELETE CASCADE, UNIQUE, CHECK (ทดสอบรันบน MySQL 8 แล้ว) |
| Connection Pool + query จริง ≥ 1 endpoint | 1 | [db.js](db.js) (mysql2 pool), `GET /api/v1/boardgames` ใน [src/index.js](src/index.js) |

### ระยะที่ 2: Docs/DX (2.5) และ Integration (2.5)

| เกณฑ์ | คะแนน | หลักฐาน |
| --- | --- | --- |
| OpenAPI ครบและตรงกับโค้ด | 1.5 | [openapi.yaml](openapi.yaml) + test อัตโนมัติ [tests/openapi-code-match.test.js](tests/openapi-code-match.test.js) |
| Swagger UI เข้าถึงได้ | 0.5 | <http://localhost:3000/api-docs> |
| Postman ครบทุก endpoint พร้อมตัวอย่างจริง | 0.5 | [postman_collection.json](postman_collection.json) 30 request พร้อมตัวอย่าง response (รันผ่าน 30 request / 60 assertion) |
| Retry ทำงานถูกต้อง | 0.8 | `fetchWithRetry` ใน [src/services/external-api.js](src/services/external-api.js), test ใน [tests/external-api.test.js](tests/external-api.test.js) |
| Timeout เหมาะสมและทำงานจริง | 0.7 | ไฟล์เดียวกัน (2 วินาที), ผลทดสอบกรณี 3-4 ส่วน B |
| Fallback ตอบสนองเหมาะสม | 0.7 | เพิ่มเกมยังได้ 201 + `notification.sent=false` |
| บันทึก Failure Scenario | 0.3 | [failure-scenario-results.md](failure-scenario-results.md) ส่วน B และภาคผนวก (ระยะที่ 2) |

### ระยะที่ 3: Final Integration (5), Frontend (10), Defense (5)

| เกณฑ์ | คะแนน | หลักฐาน |
| --- | --- | --- |
| ระบบรวมทำงานได้จริง ไม่มี error | 3 | `npm start` รันทั้ง 4 process, Postman collection ผ่าน, ครบโมดูลสัปดาห์ที่ 1-14 (ตารางด้านล่าง) |
| เอกสาร API ตรงกับโค้ด | 1 | [tests/openapi-code-match.test.js](tests/openapi-code-match.test.js) ตรวจ route ของทั้ง 4 process , endpoint ที่ต้องเข้าสู่ระบบตรงกับ `security: bearerAuth` และ endpoint เฉพาะ admin ตรงกับ response 403 |
| รายงาน Test Coverage | 1 | [coverage-report.md](coverage-report.md) 270 test, Lines 92.87% / Branches 83.71% พร้อมไฟล์ coverage ต่ำสุดและจุดที่ยังไม่มี test |
| Frontend เรียก API จริง ≥ 3 endpoint (GET + เปลี่ยนแปลงข้อมูล) | 4 | [frontend/app.js](frontend/app.js) เรียก 16 endpoint รวม POST/PUT/DELETE และเข้าสู่ระบบ พร้อมแบ่งหน้าและเรียงลำดับ (ตารางปุ่ม → endpoint อยู่บนสุดของไฟล์ และด้านล่าง) |
| หน้าจอเหมาะกับผู้ใช้ มี loading/error | 3 | spinner "กำลังโหลด...", ปุ่มเปลี่ยนเป็น "กำลังบันทึก..." และกดซ้ำไม่ได้, ข้อความ error ใต้ฟอร์ม/รายการ, ป้ายสถานะระบบ, toast, การแจ้งเตือนล่าสุด |
| ฟอร์มตรวจข้อมูลก่อนบันทึก | 3 | **ตรวจฝั่ง Frontend ก่อนส่ง** (`validateGame` / `validateCategory` / `validateAuth`: รูปแบบชื่อผู้ใช้, ความยาวรหัส, รหัสยืนยันตรงกัน, ชื่อว่าง/ยาวเกิน 100, ผู้เล่นว่าง/ไม่ใช่จำนวนเต็ม/น้อยกว่า 1, max < min) แสดงข้อความใต้ช่องที่ผิดพร้อมกรอบแดง ไม่ส่งคำขอถ้าไม่ผ่าน และ API ตรวจซ้ำอีกชั้น (เช่นชื่อซ้ำ 409 แสดงใต้ฟอร์ม) |

### หน้าเว็บ: ปุ่มไหนเรียก endpoint ไหน

ทุกคำขอผ่าน Gateway (`http://localhost:3000`) ด้วยฟังก์ชัน `callApi(method, path, body)` ใน [frontend/app.js](frontend/app.js) ซึ่งแนบ token ให้อัตโนมัติเมื่อเข้าสู่ระบบแล้ว ปุ่มเพิ่ม/แก้ไข/ลบแสดงเฉพาะตอนเข้าสู่ระบบ

| ส่วนบนหน้าเว็บ | ฟังก์ชัน | Endpoint | Service ปลายทาง |
| --- | --- | --- | --- |
| ป้ายสถานะมุมขวาบน | `loadHealth()` | `GET /api/v1/health` | Gateway ถามทุก service |
| ปุ่ม "เข้าสู่ระบบ" → ฟอร์ม | `login()` | `POST /api/v1/auth/login` | auth-service |
| ปุ่ม "สมัครสมาชิก" → ฟอร์ม (สมัครแล้วเข้าสู่ระบบต่อทันที) | `register()` | `POST /api/v1/auth/register` | auth-service |
| เปิดหน้าเว็บโดยมี token เดิม | `restoreSession()` | `GET /api/v1/auth/me` | auth-service |
| ปุ่ม "ออกจากระบบ" | `logout()` | - (ลบ token ที่เบราว์เซอร์) | - |
| รายการบอร์ดเกม + เรียง/เปลี่ยนหน้า | `loadGames()` | `GET /api/v1/boardgames?page=&limit=&sort=&order=` | boardgame-service |
| ฟอร์ม "เพิ่มบอร์ดเกม" | `addGame()` | `POST /api/v1/boardgames` | boardgame-service → notification-service |
| ปุ่ม "แก้ไข" แล้วกด "บันทึกการแก้ไข" | `updateGame()` | `PUT /api/v1/boardgames/:id` | boardgame-service |
| ปุ่ม "ลบ" (เห็นเฉพาะ admin) | `deleteGame()` | `DELETE /api/v1/boardgames/:id` | boardgame-service |
| ตัวเลือกหมวดหมู่ในหน้าต่าง "หมวดหมู่" (โหลดตอนเปิดหน้าและหลังเพิ่มหมวดหมู่) | `loadCategories()` | `GET /api/v1/categories` | boardgame-service |
| ฟอร์ม "เพิ่มหมวดหมู่" | `addCategory()` | `POST /api/v1/categories` | boardgame-service |
| กดชื่อหมวดหมู่ แล้วกด "บันทึกการแก้ไข" | `updateCategory()` | `PUT /api/v1/categories/:id` | boardgame-service |
| ปุ่ม "✕" ในรายการหมวดหมู่ทั้งหมด (เห็นเฉพาะ admin) | `deleteCategory()` | `DELETE /api/v1/categories/:id` | boardgame-service |
| ปุ่ม "หมวดหมู่" ของแต่ละเกม | `loadGameCategories()` | `GET /api/v1/boardgames/:id/categories` | boardgame-service |
| ปุ่ม "เพิ่ม" ในหน้าต่างหมวดหมู่ | `linkCategory()` | `POST /api/v1/boardgames/:id/categories` | boardgame-service |
| ปุ่ม "✕" ที่หมวดหมู่ของเกม | `unlinkCategory()` | `DELETE /api/v1/boardgames/:id/categories/:categoryId` | boardgame-service |
| "การแจ้งเตือนล่าสุด" (โหลดตอนเปิดหน้า, หลังเพิ่มเกม และปุ่ม "โหลดใหม่") | `loadNotifications()` | `GET /api/v1/notifications` | notification-service |

Project Defense (5 คะแนน): ลำดับการสาธิตและคำถามที่อาจถูกถามอยู่ด้านล่าง และ [architecture.md](architecture.md)

### ระยะที่ 1 → 3 เปลี่ยนอะไรไปบ้าง

| ระยะ | สิ่งที่เพิ่ม |
| --- | --- |
| 1 | ฐานข้อมูล 3 ตาราง (N:M), endpoint บอร์ดเกม 6 ตัวใน `index.js` ไฟล์เดียว |
| 2 | endpoint หมวดหมู่และความสัมพันธ์, OpenAPI + Swagger, Postman, แจ้งเตือน Discord พร้อม retry/timeout/fallback |
| 3 | แยกเป็น Gateway + 3 microservice, ระบบสมัครสมาชิก/เข้าสู่ระบบ (JWT) พร้อมสิทธิ์ admin/member, pagination/sorting, cache, rate limiting, migration, Frontend, test 270 รายการ |

### โมดูลที่รวมไว้ (ตามรายการตรวจก่อน Demo)

| สัปดาห์ | โมดูล | อยู่ที่ |
| --- | --- | --- |
| 1-4 | Skeleton CRUD, RESTful, Middleware, Security พื้นฐาน | `src/index.js` (CRUD 14 endpoint), `helmet`, `cors`, จำกัด body 10 KB, error handler กลาง |
| 5-6 | MySQL | `db.js` (pool) |
| 7 | Caching | `src/cache.js` (30 วินาที, header `X-Cache`, ล้างเมื่อเขียน) |
| 7 | Pagination / Filtering / Sorting | `GET /api/v1/boardgames?category=&page=&limit=&sort=&order=` |
| 7 | Versioning | ทุก endpoint อยู่ใต้ `/api/v1` |
| 9 | Unit & Integration Testing | `tests/` Jest + Supertest 270 test |
| 10 | OpenAPI / Postman | `openapi.yaml`, `postman_collection.json` |
| 11 | External API + Retry/Timeout/Fallback | `src/services/external-api.js` → notification-service → Discord |
| 12 | Advanced Validation | ตรวจทุก body/params/query (ชนิด, ช่วง, ความยาว, รายการที่อนุญาต) ที่ฝั่ง API |
| 12 | Rate Limiting | `gateway/index.js` (API 300 ครั้ง/นาที, login/register 10 ครั้ง/นาที ต่อ IP) |
| 12 | Authentication (JWT) + Authorization (role) | `services/auth-service` ออก token ที่มี role, `requireAuth` / `requireAdmin` ใน `gateway/index.js` |
| 13 | Microservices | Gateway + 3 service, `microservices-design.md` |
| 14 | Migration Script | `migrations/` + `npm run migrate` / `migrate:status` / `migrate:down` |
| 14 | Scalability Design | `scalability-design.md` |

โค้ดเดิมของระยะที่ 1-2 ยังอยู่ครบใน `src/index.js` (กลายเป็น boardgame-service) ส่วนที่เปลี่ยนคือ client เรียกผ่าน Gateway แทนการเรียก service ตรง

### การเข้าสู่ระบบ

| สิ่งที่ทำ | ผู้เยี่ยมชม | member | admin |
| --- | --- | --- | --- |
| ดูรายการบอร์ดเกม หมวดหมู่ การแจ้งเตือน | ได้ | ได้ | ได้ |
| เพิ่ม / แก้ไข บอร์ดเกม หมวดหมู่, ผูก/ถอดหมวดหมู่ของเกม | ไม่ได้ (401) | ได้ | ได้ |
| ลบ บอร์ดเกม หมวดหมู่ | ไม่ได้ (401) | ไม่ได้ (403) | ได้ |

- สมัครได้เองที่ปุ่ม "สมัครสมาชิก" บนหน้าเว็บ (username 3-30 ตัว a-z/0-9/_, รหัสผ่าน 8-72 ตัว) ได้สิทธิ์ **member** เสมอ
- **admin** ไม่มีทางสมัครผ่านหน้าเว็บ/API ได้ มี 2 ทาง แล้วเข้าสู่ระบบที่ปุ่ม "เข้าสู่ระบบ" ปุ่มเดิม จะเห็นป้าย "admin" ข้างชื่อและปุ่มลบ
  1. **ตั้งใน `.env` (บัญชี admin หลัก)** ตอนเปิด auth-service จะสร้างบัญชีนี้เป็น admin ให้ ถ้ามีอยู่แล้วจะตั้งเป็น admin และเปลี่ยนรหัสผ่านให้ตรงกับ `.env` (แก้รหัสใน `.env` แล้วรีสตาร์ท = เปลี่ยนรหัส admin)

     ```ini
     ADMIN_USERNAME=admin
     ADMIN_PASSWORD=รหัสผ่านอย่างน้อย8ตัว
     ```

  2. **คำสั่ง `create-admin` (admin คนอื่นเพิ่มเติม)**

     ```bash
     npm run create-admin -- boss          # สร้าง admin ชื่อ boss (ถามรหัสผ่าน พิมพ์แล้วไม่แสดงบนจอ)
     npm run create-admin -- alice         # alice มีบัญชีอยู่แล้ว: เลื่อนเป็น admin (รหัสผ่านเดิม)
     ```

  ถ้าคนที่ถูกเลื่อนเข้าสู่ระบบอยู่ ต้องออกแล้วเข้าใหม่ จึงจะได้สิทธิ์ admin (role อยู่ใน token)
- token (JWT) อายุ 2 ชั่วโมง หมดอายุแล้วหน้าเว็บจะให้เข้าสู่ระบบใหม่
- เรียก API เอง: `POST /api/v1/auth/login` แล้วแนบ `Authorization: Bearer <token>` (ใน Swagger UI กดปุ่ม **Authorize**)

## วิธีรัน

1. ติดตั้ง dependency

   ```bash
   npm install
   ```

2. คัดลอก `.env.example` เป็น `.env` แล้วกรอกค่า โดยเฉพาะ
   - `DB_*` สำหรับเชื่อมต่อ MySQL
   - `DISCORD_WEBHOOK_URL` (ไม่ใส่ก็ได้ ระบบจะข้ามการแจ้งเตือน)
   - `ADMIN_USERNAME` / `ADMIN_PASSWORD` บัญชี admin หลัก (ไม่ใส่ก็ได้ ใช้ `npm run create-admin` แทน)
   - `JWT_SECRET` **ต้องใส่** ข้อความสุ่มยาวๆ สร้างได้ด้วย `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` (ไม่ใส่ = เข้าสู่ระบบและการแก้ไขข้อมูลได้ 503)

3. เปิด MySQL แล้วสร้าง/อัปเดตโครงสร้างฐานข้อมูลด้วย migration ใส่ข้อมูลตัวอย่าง และสร้าง admin

   ```bash
   npm run migrate              # สร้างฐานข้อมูลถ้ายังไม่มี และรันเฉพาะ migration ที่ยังไม่เคยรัน
   npm run migrate:status       # ดูว่ารันไฟล์ไหนไปแล้ว
   mysql -u root -p < seed.sql  # ข้อมูลตัวอย่าง (ล้างบอร์ดเกม/หมวดหมู่แล้วใส่ใหม่ ไม่แตะบัญชีผู้ใช้)
   npm run create-admin -- boss # (ทางเลือก) admin เพิ่มเติม นอกจากบัญชีใน .env
   ```

   (ทางเลือก: `mysql -u root -p < schema.sql` สร้างโครงสร้างล่าสุดทั้งหมดในครั้งเดียว ถ้ารัน `npm run migrate` ทีหลังก็ไม่ error)

4. รันทุก service ด้วยคำสั่งเดียว

   ```bash
   npm start        # หรือ npm run dev (รีสตาร์ทอัตโนมัติเมื่อแก้โค้ด)
   ```

   หรือแยกรันคนละ terminal: `npm run start:notification`, `npm run start:auth`, `npm run start:boardgame`, `npm run start:gateway`

5. เปิดใช้งาน (ทุกอย่างผ่าน Gateway พอร์ต 3000)

   | หน้า | URL |
   | --- | --- |
   | Frontend | <http://localhost:3000/app> |
   | Swagger UI | <http://localhost:3000/api-docs> |
   | สถานะระบบ | <http://localhost:3000/api/v1/health> |

   ใน Swagger UI: เรียก `POST /api/v1/auth/login` เอา `data.token` ไปวางที่ปุ่ม **Authorize** แล้วจึงลองเพิ่ม/แก้ไข/ลบ (GET ลองได้เลย)

## การทดสอบ

```bash
npm test                 # Jest 239 test (ไม่ต้องมีฐานข้อมูล)
npm run test:coverage    # พร้อม coverage

# ทดสอบกับระบบจริง: รัน seed.sql ใหม่ และสร้าง admin ที่ Postman ใช้ (ครั้งเดียว) ก่อน
npm run create-admin -- admin_demo admin-pass-123
postman collection run postman_collection.json   # A. Auth สมัคร demo_user (member) และเข้าสู่ระบบ admin_demo ให้เอง
```

## ลำดับการสาธิต (Project Defense, 3-4 นาที)

> แนะนำให้รันแยก 4 terminal (`npm run start:*`) จะได้ปิดทีละ service ได้ในข้อ 7
>
> **ก่อน demo:** สมัครบัญชี member ไว้ 1 บัญชี (เช่น `demo` / `demo-pass-123`) ส่วน admin ใช้บัญชีใน `.env` (`ADMIN_USERNAME` / `ADMIN_PASSWORD`) จะได้ไม่เสียเวลาตอนนำเสนอ
>
> **ก่อน demo:** รัน `seed.sql` ใหม่ให้ข้อมูลตรงกับที่ซ้อมไว้
>
> **เคล็ดลับ:** เปิด DevTools → แท็บ Network ไว้ตลอด กดปุ่มไหนจะเห็น endpoint ที่ถูกเรียกจริงทันที (ดูตาราง "ปุ่มไหนเรียก endpoint ไหน" ด้านบน)

1. **ภาพรวม:** เปิด <http://localhost:3000/app> ชี้ป้ายเขียว "ระบบพร้อมใช้งาน" (`GET /api/v1/health` Gateway เช็ค `/health` ของทั้ง 3 service) ยังไม่เข้าสู่ระบบ: ดูรายการได้ แต่ไม่มีฟอร์มและปุ่มแก้ไข/ลบ
2. **เข้าสู่ระบบ:** กด "เข้าสู่ระบบ" ลองรหัสผิดก่อน (401 แสดงในฟอร์ม) แล้วใส่รหัสถูก (`POST /api/v1/auth/login`) ชื่อผู้ใช้ขึ้นมุมขวาบน ฟอร์มและปุ่มแก้ไข/ลบโผล่ ใน DevTools → Network ดู header `Authorization: Bearer ...` ของคำขอถัดไป
3. **ดูรายการ:** เปลี่ยนการเรียงเป็น "ชื่อ A → Z" และเลือก "หน้าละ 3" ให้เห็นปุ่มเปลี่ยนหน้า (ทุกครั้งเรียก `GET /api/v1/boardgames` พร้อม query ต่างกัน)
4. **Validation:** ใส่ผู้เล่นขั้นต่ำ 5 สูงสุด 2 แล้วกดเพิ่ม หน้าเว็บแสดงข้อความใต้ช่อง "ผู้เล่นสูงสุด" พร้อมกรอบแดงทันที และแท็บ Network ไม่มีคำขอถูกส่ง (ตรวจฝั่ง Frontend) จากนั้นลองเพิ่มชื่อเกมที่มีอยู่แล้ว ผ่านฝั่ง Frontend แต่ API ตอบ 409 และแสดงข้อความใต้ฟอร์ม
5. **Use case หลัก (เพิ่มเกม):** กรอก `Azul` 2-4 คน กดเพิ่ม (`POST /api/v1/boardgames`) เกมขึ้นในรายการ (เลือกเรียง "เพิ่มล่าสุดก่อน" จะอยู่บนสุด) ข้อความเข้าห้อง Discord และ "การแจ้งเตือนล่าสุด" มีรายการ "ส่งแล้ว"
6. **แก้ไขเกม** (`PUT`) และ **ผูกหมวดหมู่** (`POST /boardgames/:id/categories`) ด้วยบัญชี member ชี้ว่าไม่มีปุ่ม "ลบ" จากนั้นออกจากระบบแล้วเข้าด้วยบัญชี admin มีป้าย "admin" และปุ่มลบ แล้ว **ลบเกม** (`DELETE`) (ถ้ามีเวลา: ใน Postman ใช้ token ของ member เรียก DELETE ได้ 403)
7. **ความทนทาน:** ปิด notification-service (Ctrl+C) กดป้ายสถานะ เปลี่ยนเป็นสีเหลือง เพิ่มเกมได้ตามปกติ (หลัง retry ~1.5 วินาที) พร้อมข้อความว่าแจ้งเตือนไม่สำเร็จ จากนั้นลองปิด boardgame-service ให้เห็น 503 จาก Gateway และเปิดกลับมาใช้ได้ทันที (ถ้ามีเวลา: ปิด auth-service แล้วยังเพิ่มเกมได้ด้วย token เดิม เพราะ Gateway ตรวจ JWT เอง)
8. (ถ้ามีเวลา) **Cache:** ในแท็บ Network กด "โหลดใหม่" สองครั้ง ดู header `X-Cache` เปลี่ยนจาก `MISS` เป็น `HIT`
9. (ถ้ามีเวลา) **Migration:** `npm run migrate:status` ให้เห็นว่าโครงสร้างฐานข้อมูลมีเวอร์ชัน

### คำถามที่อาจถูกถาม (เตรียมตอบ)

- ทำไมแยก notification แต่ไม่แยกบอร์ดเกมกับหมวดหมู่? → `microservices-design.md` หัวข้อ "เหตุผลของการแบ่ง"
- ทำไม Gateway ไม่ retry แต่ boardgame-service retry? ทำไม timeout ของแต่ละชั้นไม่เท่ากัน? → `architecture.md` ข้อ 3
- ปุ่มนี้เรียก endpoint ไหน? → ตาราง "หน้าเว็บ: ปุ่มไหนเรียก endpoint ไหน" ด้านบน หรือคอมเมนต์บนสุดของ `frontend/app.js` และใน `gateway/index.js` แต่ละบรรทัดคือ 1 endpoint
- ระบบ login ทำงานอย่างไร? เก็บรหัสผ่านอย่างไร? → auth-service เก็บ scrypt hash + salt สุ่ม ไม่เก็บรหัสจริง เข้าสู่ระบบแล้วได้ JWT อายุ 2 ชั่วโมง Gateway ตรวจ JWT ด้วย `requireAuth` ก่อนส่งต่อคำขอเพิ่ม/แก้ไข/ลบ (`architecture.md` ข้อ 2)
- ทำไม Gateway ตรวจ token เองไม่ถาม auth-service? → ไม่เพิ่ม hop ทุกคำขอ และ auth-service ล่มก็ยังแก้ไขข้อมูลได้ด้วย token เดิม ข้อแลกเปลี่ยนคือเพิกถอน token ก่อนหมดอายุไม่ได้ จึงตั้งอายุสั้น (`architecture.md` ข้อ 3)
- ทำไม member ลบไม่ได้ และ admin มาจากไหน? → การลบย้อนไม่ได้จึงจำกัดไว้ที่ admin (`requireAdmin` ที่ Gateway ตอบ 403) admin มาจาก `ADMIN_USERNAME`/`ADMIN_PASSWORD` ใน `.env` หรือ `npm run create-admin` บนเครื่องเซิร์ฟเวอร์เท่านั้น สมัครผ่าน API ได้ member เสมอแม้ส่ง `role: "admin"` มา (`architecture.md` ข้อ 2)
- ใครแก้ role ใน token เองได้ไหม? → ไม่ได้ token ลงชื่อด้วย `JWT_SECRET` แก้แม้ตัวอักษรเดียวลายเซ็นไม่ตรง Gateway ตอบ 401 (มี test)
- ถ้าเรียก boardgame-service (4001) ตรงจะข้ามการตรวจ token ได้ไหม? → ได้ ตอนนี้พึ่ง Gateway อย่างเดียว ถ้า deploy จริงต้องให้ service ภายในอยู่ใน network ที่เข้าถึงได้จาก Gateway เท่านั้น (`architecture.md` ข้อ 5)
- ถ้าข้อมูลเพิ่ม 10 เท่า ส่วนไหนมีปัญหาก่อน? → 10 เท่าของตอนนี้ (30 เกม) ยังไม่มีปัญหา วัดจริงแล้ว 10,000 เกมใช้ ~40 ms แต่ที่ 100,000 เกม `GET /boardgames` ใช้ ~560 ms เพราะ `GROUP BY` ทุกเกมก่อน `LIMIT` วิธีแก้คือแบ่งหน้า 2 ขั้น + index (`scalability-design.md`)
- cache ทำให้ผู้ใช้เห็นข้อมูลเก่าไหม? → ไม่ เพราะล้างทันทีเมื่อเพิ่ม/แก้ไข/ลบสำเร็จ และไม่เก็บข้อมูลที่อ่านก่อนการแก้ไข (ตัวนับ generation ใน `src/cache.js`) แต่ถ้ารันหลาย instance ต้องย้ายไป Redis
- ทำไม rate limit ที่ Gateway ไม่ใช่ที่แต่ละ service? → คำขอเกินโควตาถูกตัดตั้งแต่ทางเข้า ไม่เปลือง service/ฐานข้อมูล และตั้งค่าที่เดียว
- ทำไมต้องมี migration ทั้งที่มี `schema.sql`? → `schema.sql` สร้างจากศูนย์ได้อย่างเดียว ฐานข้อมูลที่มีข้อมูลอยู่แล้ว (เช่นเพิ่มคอลัมน์ `created_at`) ต้องเปลี่ยนทีละขั้นโดยไม่ลบข้อมูล และต้องรู้ว่าเครื่องไหนอยู่เวอร์ชันไหน (`schema_migrations`)
- endpoint ไหนยังไม่มี test และเสี่ยงอะไร? → `coverage-report.md` ข้อ 2 (ไฟล์ coverage ต่ำสุด) และข้อ 4
- เจอปัญหาอะไรระหว่างพัฒนา? → เช่น MySQL 8.0 ไม่สน `ORDER BY` เมื่อใช้ `GROUP_CONCAT(... ORDER BY)` คู่กับ window function unit test ผ่านเพราะ mock ฐานข้อมูล แต่ E2E กับ MySQL จริงจับได้ (`coverage-report.md`)
- จุดอ่อนของระบบคืออะไร? → `architecture.md` ข้อ 5 และ `scalability-design.md` ข้อ 2
