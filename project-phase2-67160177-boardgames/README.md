# Board Game Management API (โครงงานระยะที่ 2)

รหัสนิสิต 67160177 · Pno = (7 mod 9) + 1 = **8 ระบบข้อมูลบอร์ดเกม**

REST API สำหรับจัดการบอร์ดเกม หมวดหมู่ และความสัมพันธ์แบบ Many-to-Many ระหว่างกัน พร้อมเอกสาร OpenAPI/Swagger และการแจ้งเตือนผ่าน Discord Webhook ที่มี Timeout + Retry + Fallback

## ไฟล์ในโปรเจกต์

| ไฟล์                                                             | เนื้อหา                                                  |
| ---------------------------------------------------------------- | -------------------------------------------------------- |
| [requirement.md](requirement.md)                                 | Requirement Specification, Use Case, Resource, Constraint |
| [erd.pdf](erd.pdf) / [ERD.mwb](ERD.mwb)                          | ERD (MySQL Workbench)                                    |
| [schema.sql](schema.sql) / [seed.sql](seed.sql)                  | สร้างฐานข้อมูล/ตาราง และข้อมูลตัวอย่าง                   |
| [src/db.js](src/db.js)                                           | Connection Pool (mysql2)                                 |
| [src/index.js](src/index.js)                                     | Express app และทุก route                                  |
| [src/services/external-api.js](src/services/external-api.js)     | เรียก Discord Webhook พร้อม Timeout / Retry / Fallback   |
| [openapi.yaml](openapi.yaml)                                     | OpenAPI 3.0 Specification                                |
| [postman_collection.json](postman_collection.json)               | Postman Collection พร้อมตัวอย่าง response จริง และ test   |
| [failure-scenario-results.md](failure-scenario-results.md)       | ผลการทดสอบ Failure Scenario ของ API ภายนอก               |

## วิธีรัน

1. ติดตั้ง dependency

   ```bash
   npm install
   ```

2. สร้างฐานข้อมูลและใส่ข้อมูลตัวอย่าง (MySQL 8)

   ```bash
   mysql -u root -p < schema.sql
   mysql -u root -p < seed.sql
   ```

3. คัดลอก `.env.example` เป็น `.env` แล้วกรอกค่า DB และ `DISCORD_WEBHOOK_URL` (ถ้าไม่ใส่ webhook ระบบยังทำงานได้ แต่จะข้ามการแจ้งเตือน)

4. รันเซิร์ฟเวอร์

   ```bash
   npm run dev     # หรือ npm start
   ```

5. เปิดเอกสาร API ที่ <http://localhost:3000/api-docs>

## ทดสอบด้วย Postman

Import `postman_collection.json` แล้วกด Run collection หรือใช้ Postman CLI:

```bash
postman collection run postman_collection.json
```

ควรเริ่มจากฐานข้อมูลที่รัน `schema.sql` + `seed.sql` ใหม่ request ที่สร้างข้อมูลจะเก็บ id ลงตัวแปร `boardgameId` / `categoryId` และลบข้อมูลนั้นทิ้งตอนท้าย จึงรันซ้ำได้

## Endpoint

| Method | Path                                             | คำอธิบาย                          |
| ------ | ------------------------------------------------ | --------------------------------- |
| GET    | `/`                                              | ตรวจสอบสถานะเซิร์ฟเวอร์           |
| GET    | `/api/v1/boardgames?category=&category_id=`      | รายการบอร์ดเกม (กรองตามหมวดหมู่ได้) |
| POST   | `/api/v1/boardgames`                             | เพิ่มบอร์ดเกม + แจ้งเตือน Discord |
| GET    | `/api/v1/boardgames/:id`                         | ดูบอร์ดเกมตาม ID                  |
| PUT    | `/api/v1/boardgames/:id`                         | แก้ไขทั้งระเบียน                  |
| PATCH  | `/api/v1/boardgames/:id`                         | แก้ไขบางฟิลด์                     |
| DELETE | `/api/v1/boardgames/:id`                         | ลบบอร์ดเกม                        |
| GET    | `/api/v1/categories`                             | รายการหมวดหมู่ + จำนวนเกม         |
| POST   | `/api/v1/categories`                             | เพิ่มหมวดหมู่                     |
| GET    | `/api/v1/categories/:id`                         | ดูหมวดหมู่ตาม ID                  |
| PUT    | `/api/v1/categories/:id`                         | แก้ไขชื่อหมวดหมู่                 |
| DELETE | `/api/v1/categories/:id`                         | ลบหมวดหมู่                        |
| GET    | `/api/v1/boardgames/:id/categories`              | หมวดหมู่ของบอร์ดเกม               |
| POST   | `/api/v1/boardgames/:id/categories`              | ผูกหมวดหมู่กับบอร์ดเกม            |
| DELETE | `/api/v1/boardgames/:id/categories/:categoryId`  | ถอดหมวดหมู่ออกจากบอร์ดเกม         |
