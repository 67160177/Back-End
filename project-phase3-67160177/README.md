# Board Game Management System (โครงงานระยะที่ 3)

รหัสนิสิต 67160177 · Pno = (7 mod 9) + 1 = **8 ระบบข้อมูลบอร์ดเกม**

ระบบจัดการบอร์ดเกม หมวดหมู่ และความสัมพันธ์แบบ Many-to-Many ประกอบด้วย

- **Board Game API** (พอร์ต 3000): REST API + Swagger UI + หน้าเว็บ Frontend
- **notification-service** (พอร์ต 3001): microservice ส่งแจ้งเตือนเข้า Discord
- **MySQL 8** ใน Docker

ดูแผนภาพและเหตุผลการออกแบบใน [architecture.md](architecture.md)

## ไฟล์ในโปรเจกต์

| ไฟล์ / โฟลเดอร์                                                  | เนื้อหา                                                          | ระยะ |
| ---------------------------------------------------------------- | ---------------------------------------------------------------- | ---- |
| [requirement.md](requirement.md)                                 | Requirement, Use Case, Resource, Constraint                      | 1    |
| [erd.pdf](erd.pdf) / [ERD.mwb](ERD.mwb)                          | ERD (MySQL Workbench)                                            | 1    |
| [schema.sql](schema.sql) / [seed.sql](seed.sql)                  | สร้างตาราง และข้อมูลตัวอย่าง (รัน seed ซ้ำได้)                    | 1    |
| [db.js](db.js)                                                   | Connection Pool (mysql2)                                         | 1    |
| [src/index.js](src/index.js)                                     | Express app ทุก route, `/api-docs`, เสิร์ฟ Frontend ที่ `/app`    | 1-3  |
| [src/services/external-api.js](src/services/external-api.js)     | เรียก notification-service พร้อม Timeout / Retry / Fallback      | 2-3  |
| [openapi.yaml](openapi.yaml)                                     | OpenAPI 3.0 ครบทุก endpoint ของทั้ง 2 service                    | 2-3  |
| [postman_collection.json](postman_collection.json)               | 20 request พร้อมตัวอย่าง response จริง และ test                   | 2-3  |
| [failure-scenario-results.md](failure-scenario-results.md)       | ผลทดสอบ failure scenario 6 กรณี (+ ภาคผนวกระยะที่ 2)             | 2-3  |
| [services/notification-service/](services/notification-service/) | Microservice แจ้งเตือน                                           | 3    |
| [frontend/](frontend/)                                           | หน้าเว็บ HTML/CSS/JS ที่เรียก API จริง                            | 3    |
| [tests/](tests/)                                                 | Jest + Supertest 133 test                                        | 3    |
| [coverage-report.md](coverage-report.md)                         | รายงาน Test Coverage Baseline                                    | 3    |
| [architecture.md](architecture.md)                               | สถาปัตยกรรมและเหตุผลการตัดสินใจทางเทคนิค                        | 3    |
| [scripts/](scripts/)                                             | `start-all.js` รันทั้ง 2 service, `mock-external.js` จำลอง service ล่ม | 3    |

## วิธีรัน

1. ติดตั้ง dependency

   ```bash
   npm install
   ```

2. เปิด MySQL แล้วสร้างฐานข้อมูลและข้อมูลตัวอย่าง

   ```bash
   mysql -u root -p < schema.sql
   mysql -u root -p < seed.sql
   ```

3. คัดลอก `.env.example` เป็น `.env` แล้วกรอกค่า DB และ `DISCORD_WEBHOOK_URL`

4. รันทั้ง 2 service ด้วยคำสั่งเดียว

   ```bash
   npm start        # หรือ npm run dev (รีสตาร์ทอัตโนมัติเมื่อแก้โค้ด)
   ```

   หรือแยกรันทีละ service คนละ terminal: `npm run start:notification` และ `npm run start:api`

5. เปิดใช้งาน

   | หน้า            | URL                                  |
   | --------------- | ------------------------------------ |
   | Frontend        | <http://localhost:3000/app>          |
   | Swagger UI      | <http://localhost:3000/api-docs>     |
   | สถานะระบบ       | <http://localhost:3000/api/v1/health> |

## การทดสอบ

```bash
npm test                 # Jest 133 test (ไม่ต้องมีฐานข้อมูล)
npm run test:coverage    # พร้อม coverage
postman collection run postman_collection.json   # ทดสอบกับระบบจริง (ต้องรัน seed.sql ใหม่ก่อน)
```

## ลำดับการสาธิต (Project Defense, 3-4 นาที)

1. **ระบบพร้อม:** เปิด <http://localhost:3000/app> ชี้ป้ายเขียว "ระบบพร้อมใช้งาน" ที่มุมขวาบน (มาจาก `/api/v1/health` ที่เช็คทั้ง DB และ notification-service)
2. **ดูและกรอง:** เลือกหมวด "Strategy" ในช่องกรอง
3. **Validation:** ในฟอร์มเพิ่มบอร์ดเกม ใส่ผู้เล่นขั้นต่ำ 5 สูงสุด 2 แล้วกดเพิ่ม จะเห็นข้อความเตือนใต้ช่องทันทีโดยไม่ได้ส่งไป API
4. **Use case หลัก (เพิ่มเกม):** กรอก `Azul` 2-4 คน กดเพิ่ม เกมขึ้นในรายการ ข้อความใน Discord เข้าห้อง และ "การแจ้งเตือนล่าสุด" มีรายการ "ส่งแล้ว"
5. **ผูกหมวดหมู่:** กดปุ่ม "หมวดหมู่" ของ Azul แล้วเพิ่ม "Strategy"
6. **ความทนทาน:** ปิด notification-service (หรือรันแยกแล้วกด Ctrl+C เฉพาะตัวนั้น) แล้วกดป้ายสถานะ จะเปลี่ยนเป็นสีเหลือง "แจ้งเตือนใช้งานไม่ได้ชั่วคราว" จากนั้นเพิ่มเกมอีกเกม ยังเพิ่มได้ (หลัง retry ประมาณ 1.5 วินาที) พร้อมข้อความเตือนว่าแจ้งเตือนไม่สำเร็จ
7. **ลบ:** ลบเกมที่เพิ่ม
8. (ถ้ามีเวลา) เปิด `/api-docs` ให้ดูว่า endpoint ตรงกับที่ใช้

> ถ้าจะสาธิตข้อ 6 ให้รันแยก 2 terminal (`npm run start:notification` และ `npm run start:api`) จะปิดเฉพาะ notification-service ได้ง่ายกว่า
