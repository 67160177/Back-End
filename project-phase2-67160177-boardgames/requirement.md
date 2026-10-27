# 1. เอกสาร Requirement Specification

## 1.1 ชื่อระบบและวัตถุประสงค์

**ชื่อระบบ:** ระบบจัดการข้อมูลบอร์ดเกม (Board Game Management System)

**ปัญหาที่ระบบแก้ไข:**

- การจัดเก็บข้อมูลบอร์ดเกมที่ไม่เป็นระบบ
- การค้นหาและจัดหมวดหมู่บอร์ดเกมทำได้ยาก
- ไม่สามารถรองรับบอร์ดเกมที่อยู่ได้หลายหมวดหมู่
- ข้อมูลบอร์ดเกมซ้ำกันหรือมีข้อมูลจำนวนผู้เล่นไม่ถูกต้อง

**กลุ่มผู้ใช้เป้าหมาย:**

- **ผู้ใช้งานทั่วไป (General Users):** สามารถดูรายการบอร์ดเกม ดูรายละเอียด และค้นหาบอร์ดเกมตามหมวดหมู่
- **ผู้ดูแลระบบ (Admin):** สามารถเพิ่ม แก้ไข และลบข้อมูลบอร์ดเกม

---

## รายการ Use Case หลักอย่างน้อย 5 รายการ

1. **ดูรายการบอร์ดเกม (Browse Board Games):** ผู้ใช้สามารถเรียกดูรายการบอร์ดเกมทั้งหมด และกรองตามหมวดหมู่ได้
2. **ดูรายละเอียดบอร์ดเกม (Get Board Game Details):** ผู้ใช้สามารถเรียกดูรายละเอียดของบอร์ดเกมตาม ID พร้อมข้อมูลหมวดหมู่
3. **เพิ่มบอร์ดเกม (Create Board Game):** ผู้ดูแลระบบสามารถเพิ่มบอร์ดเกมใหม่ โดยระบุชื่อ จำนวนผู้เล่นขั้นต่ำ และจำนวนผู้เล่นสูงสุด
4. **แก้ไขข้อมูลบอร์ดเกม (Update Board Game):** ผู้ดูแลระบบสามารถแก้ไขข้อมูลบอร์ดเกมทั้งหมด หรือแก้ไขเฉพาะบางฟิลด์ได้
5. **ลบบอร์ดเกม (Delete Board Game):** ผู้ดูแลระบบสามารถลบบอร์ดเกมที่ไม่ต้องการออกจากระบบได้
6. **ค้นหาบอร์ดเกมตามหมวดหมู่ (Filter by Category):** ผู้ใช้สามารถค้นหาบอร์ดเกมตามชื่อหรือ ID ของหมวดหมู่ได้

---

## รายการ Resource หลักของระบบ (Core Resources & Entities)

### 1. Boardgames

- **Resource:** `boardgames`
- **คำอธิบาย:** ข้อมูลบอร์ดเกมที่จัดเก็บในระบบ
- **Primary Key:** `id`
- **ข้อมูลหลัก:** `name`, `minPlayers`, `maxPlayers`

### 2. Categories

- **Resource:** `categories`
- **คำอธิบาย:** ข้อมูลหมวดหมู่ของบอร์ดเกม
- **Primary Key:** `id`
- **ข้อมูลหลัก:** `name`

### 3. Boardgame Categories

- **Resource:** `boardgame_categories`
- **คำอธิบาย:** ตารางกลางสำหรับเชื่อมโยงบอร์ดเกมกับหมวดหมู่
- **Primary Key:** `boardgame_id`, `category_id`
- **Foreign Keys:** `boardgame_id`, `category_id`

---

## ความสัมพันธ์ระหว่าง Resource

| Resource ต้นทาง | ความสัมพันธ์       | Resource ปลายทาง       | รายละเอียด                                                                              |
| --------------- | ------------------ | ---------------------- | --------------------------------------------------------------------------------------- |
| `boardgames`    | 1:N (One-to-Many)  | `boardgame_categories` | บอร์ดเกม 1 รายการสามารถมีหลายหมวดหมู่                                                   |
| `categories`    | 1:N (One-to-Many)  | `boardgame_categories` | หมวดหมู่ 1 หมวดสามารถมีบอร์ดเกมได้หลายรายการ                                            |
| `boardgames`    | N:M (Many-to-Many) | `categories`           | บอร์ดเกม 1 รายการสามารถอยู่ได้หลายหมวดหมู่ และหมวดหมู่ 1 หมวดสามารถมีบอร์ดเกมหลายรายการ |

---

## สรุปโครงสร้างความสัมพันธ์

```text
boardgames (1) ──────── (N) boardgame_categories (N) ──────── (1) categories

                    Boardgames (N:M) Categories
```

- `boardgames.id` เชื่อมกับ `boardgame_categories.boardgame_id`
- `categories.id` เชื่อมกับ `boardgame_categories.category_id`
- `boardgame_categories` เป็นตารางกลางที่เชื่อมความสัมพันธ์แบบ Many-to-Many ระหว่าง `boardgames` และ `categories`

---

## Constraint ของฐานข้อมูล (ดูใน `schema.sql` และ `erd.pdf`)

| ตาราง                  | Constraint                                                        | เหตุผล                                                     |
| ---------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------- |
| `boardgames`           | `PRIMARY KEY (id)` AUTO_INCREMENT                                 | ระบุบอร์ดเกมแต่ละรายการ                                    |
| `boardgames`           | `name` NOT NULL **UNIQUE**                                        | ป้องกันข้อมูลบอร์ดเกมซ้ำกัน                                |
| `boardgames`           | `CHECK (minPlayers >= 1 AND maxPlayers >= minPlayers)`            | ป้องกันข้อมูลจำนวนผู้เล่นไม่ถูกต้อง                        |
| `categories`           | `PRIMARY KEY (id)`, `name` NOT NULL **UNIQUE**                    | ป้องกันหมวดหมู่ชื่อซ้ำ                                     |
| `boardgame_categories` | Composite `PRIMARY KEY (boardgame_id, category_id)`               | เกมหนึ่งอยู่ในหมวดเดียวกันซ้ำสองครั้งไม่ได้                |
| `boardgame_categories` | `FOREIGN KEY (boardgame_id) → boardgames(id)` **ON DELETE CASCADE** | ลบเกมแล้วความสัมพันธ์กับหมวดหมู่ถูกลบตาม ไม่เหลือข้อมูลกำพร้า |
| `boardgame_categories` | `FOREIGN KEY (category_id) → categories(id)` **ON DELETE CASCADE**  | ลบหมวดหมู่แล้วความสัมพันธ์ถูกลบตาม แต่ตัวเกมยังอยู่          |
