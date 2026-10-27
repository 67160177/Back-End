# ผลการทดสอบ Failure Scenario ของการเชื่อมต่อ Service ภายนอก

## ระยะที่ 3: สถาปัตยกรรมแบบ Microservice

ทดสอบเมื่อ 27 ตุลาคม 2569 (2026-10-27) บนเครื่อง local (Node.js 24 + MySQL 8 ใน Docker) โดยยิง `POST /api/v1/boardgames` ด้วย curl

### 1. สิ่งที่เปลี่ยนจากระยะที่ 2

ในระยะที่ 2 API หลักเรียก Discord Webhook เองโดยตรง ระยะที่ 3 แยกการแจ้งเตือนออกเป็น **notification-service** (microservice พอร์ต 3001) เส้นทางของคำขอจึงเป็น

```
Board Game API (3000) --HTTP--> notification-service (3001) --HTTP--> Discord Webhook
   timeout 2000 ms                 timeout 1500 ms (ครั้งเดียว)
   retry 2 ครั้ง + backoff         Discord ล้มเหลว -> ตอบ 502 / ช้า -> ตอบ 504
   fallback: ยังตอบ 201             ไม่ได้ตั้งค่า webhook -> ตอบ 200 sent:false
```

- **Retry/Timeout/Fallback อยู่ที่ฝั่งผู้เรียก** (`src/services/external-api.js` ใน API หลัก) เหมือนเดิม
- notification-service ส่ง Discord ครั้งเดียวและแปลงความล้มเหลวเป็น 5xx เพื่อให้ API หลัก retry ได้ จึงไม่เกิด retry ซ้อนกัน 2 ชั้น
- timeout ของ notification-service (1500 ms) ตั้งให้น้อยกว่าของ API หลัก (2000 ms) เพื่อให้ service ตอบ 504 ได้ทันก่อนที่ API หลักจะตัดการรอ

### 2. วิธีจำลองความล้มเหลว

ใช้ `scripts/mock-external.js` (อยู่ในโปรเจกต์) จำลอง Discord หรือ service ที่มีปัญหา

```bash
npm run mock:external -- ok   4001   # ตอบ 204 ทันที (Discord ปกติ)
npm run mock:external -- fail 4002   # ตอบ 503 ทุกครั้ง
npm run mock:external -- slow 4003   # รอ 10 วินาทีก่อนตอบ
```

แล้วตั้ง `DISCORD_WEBHOOK_URL` ของ notification-service หรือ `NOTIFICATION_SERVICE_URL` ของ API หลักให้ชี้ไปที่ mock

### 3. สรุปผลการทดสอบ

| #   | สถานการณ์                                | การตั้งค่า                                                     | Status | `notification`               | เวลา   | `GET /api/v1/health`   |
| --- | ---------------------------------------- | -------------------------------------------------------------- | ------ | ---------------------------- | ------ | ---------------------- |
| 0   | ปกติ (baseline)                          | Discord = mock `ok`                                            | 201    | `sent: true`, `attempts: 1`  | 0.11 s | `ok`                   |
| 1   | notification-service ปิดอยู่             | `NOTIFICATION_SERVICE_URL=http://localhost:3199` (ไม่มี service) | 201    | `sent: false`, `attempts: 3` | 1.58 s | `degraded`             |
| 2   | Discord ตอบ 503                          | Discord = mock `fail`                                          | 201    | `sent: false`, `attempts: 3` | 1.65 s | `ok`                   |
| 3   | Discord ตอบช้า (เกิน timeout ของ service) | Discord = mock `slow`                                          | 201    | `sent: false`, `attempts: 3` | 6.12 s | `ok`                   |
| 4   | notification-service ค้าง (ไม่ตอบ)        | `NOTIFICATION_SERVICE_URL` = mock `slow`                       | 201    | `sent: false`, `attempts: 3` | 7.57 s | `degraded`             |
| 5   | ไม่ได้ตั้งค่า webhook                     | notification-service ไม่มี `DISCORD_WEBHOOK_URL`               | 201    | `sent: false`, `attempts: 1` | 0.07 s | `ok`                   |

ทุกกรณี response เป็น **201 Created** ข้อมูลเกมถูกบันทึกลงฐานข้อมูล เซิร์ฟเวอร์ไม่ crash และไม่ค้าง

### 4. รายละเอียดแต่ละกรณี

#### กรณี 0: ปกติ (baseline)

```
[external-api] localhost:3111 สำเร็จ (HTTP 200) ครั้งที่ 1/3
POST /api/v1/boardgames 201 104.808 ms - 265
```

ฝั่ง notification-service

```
[notification-service] ส่งไป Discord สำเร็จ (HTTP 204)
POST /notifications 200 46.475 ms - 114
```

ประวัติใน `GET /api/v1/notifications` มีรายการ `status: "sent"`

> กรณีนี้ใช้ mock แทน Discord จริงเพื่อให้ผลทดสอบทำซ้ำได้ ส่วนการส่งเข้า Discord จริงทดสอบด้วย Webhook URL จริงแล้ว ได้ `HTTP 204` ครั้งที่ 1 (ดูภาคผนวกกรณี 0)

#### กรณี 1: notification-service ปิดอยู่ (ECONNREFUSED)

```
[external-api] localhost:3199 ล้มเหลวครั้งที่ 1/3: ECONNREFUSED
[external-api] รอ 500 ms แล้วลองใหม่
[external-api] localhost:3199 ล้มเหลวครั้งที่ 2/3: ECONNREFUSED
[external-api] รอ 1000 ms แล้วลองใหม่
[external-api] localhost:3199 ล้มเหลวครั้งที่ 3/3: ECONNREFUSED
[external-api] ลองครบ 3 ครั้งแล้วยังล้มเหลว (ECONNREFUSED)
POST /api/v1/boardgames 201 1576.063 ms - 346
```

ผลที่ได้: retry ครบ 3 ครั้ง เวลารวม 1.58 วินาที ตรงกับ backoff 500 + 1000 ms แล้วตอบ 201 พร้อม fallback

ผลต่อ endpoint อื่น
- `GET /api/v1/health` ได้ 200 `{"status":"degraded", "services": {"notificationService":"down", ...}}` (ระบบหลักยังใช้ได้)
- `GET /api/v1/notifications` ได้ 503 `NOTIFICATION_SERVICE_UNAVAILABLE` พร้อมข้อความอธิบาย (ไม่ crash)

#### กรณี 2: Discord ตอบ HTTP 503

ฝั่ง API หลัก

```
[external-api] localhost:3112 ล้มเหลวครั้งที่ 1/3: HTTP 502
[external-api] รอ 500 ms แล้วลองใหม่
[external-api] localhost:3112 ล้มเหลวครั้งที่ 2/3: HTTP 502
[external-api] รอ 1000 ms แล้วลองใหม่
[external-api] localhost:3112 ล้มเหลวครั้งที่ 3/3: HTTP 502
[external-api] ลองครบ 3 ครั้งแล้วยังล้มเหลว (HTTP 502)
POST /api/v1/boardgames 201 1648.567 ms - 346
```

ฝั่ง notification-service และ mock Discord

```
[notification-service] ส่งไป Discord ไม่สำเร็จ: Discord ตอบ HTTP 503
POST /notifications 502 58.194 ms - 73
(ซ้ำอีก 2 ครั้ง)
[mock-external:fail] คำขอที่ 1: POST /webhook
[mock-external:fail] คำขอที่ 2: POST /webhook
[mock-external:fail] คำขอที่ 3: POST /webhook
```

ผลที่ได้: notification-service แปลง 503 ของ Discord เป็น 502 แล้ว API หลัก retry ครบ 3 ครั้ง Discord (mock) ได้รับคำขอ **3 ครั้งพอดี** ไม่มี retry ซ้อน ประวัติใน notification-service บันทึก `status: "failed"` 3 รายการ

#### กรณี 3: Discord ตอบช้าเกิน timeout ของ notification-service

```
[notification-service] ส่งไป Discord ไม่สำเร็จ: Discord ไม่ตอบภายใน 1500 ms
POST /notifications 504 1522.409 ms - 98
(ซ้ำอีก 2 ครั้ง: 1508 ms, 1512 ms)

[external-api] localhost:3113 ล้มเหลวครั้งที่ 1/3: HTTP 504
[external-api] รอ 500 ms แล้วลองใหม่
[external-api] localhost:3113 ล้มเหลวครั้งที่ 2/3: HTTP 504
[external-api] รอ 1000 ms แล้วลองใหม่
[external-api] localhost:3113 ล้มเหลวครั้งที่ 3/3: HTTP 504
[external-api] ลองครบ 3 ครั้งแล้วยังล้มเหลว (HTTP 504)
POST /api/v1/boardgames 201 6121.742 ms - 346
```

ผลที่ได้: mock หน่วง 10 วินาที แต่ notification-service ตัดที่ 1.5 วินาทีจริงทุกครั้ง เวลารวม 6.12 วินาที (1.5 × 3 + backoff 1.5) แล้วตอบ 201 พร้อม fallback

#### กรณี 4: notification-service ค้าง (timeout ของ API หลัก)

```
[external-api] localhost:4004 ล้มเหลวครั้งที่ 1/3: timeout (เกิน 2000 ms)
[external-api] รอ 500 ms แล้วลองใหม่
[external-api] localhost:4004 ล้มเหลวครั้งที่ 2/3: timeout (เกิน 2000 ms)
[external-api] รอ 1000 ms แล้วลองใหม่
[external-api] localhost:4004 ล้มเหลวครั้งที่ 3/3: timeout (เกิน 2000 ms)
[external-api] ลองครบ 3 ครั้งแล้วยังล้มเหลว (timeout (เกิน 2000 ms))
POST /api/v1/boardgames 201 7571.133 ms - 347
```

ผลที่ได้: API หลักตัดการรอที่ 2 วินาทีจริงทั้ง 3 ครั้ง เวลารวม 7.57 วินาที (2 × 3 + 1.5) ไม่ค้างตามที่ service หน่วงไว้ 10 วินาที และ `GET /api/v1/health` รายงาน `degraded` เพราะเช็ค `/health` ของ service ไม่ทันใน 1 วินาที

#### กรณี 5: ไม่ได้ตั้งค่า webhook

```
[notification-service] ไม่ได้ตั้งค่า DISCORD_WEBHOOK_URL ข้ามการแจ้งเตือน
POST /notifications 200 8.074 ms - 162
[external-api] localhost:3115 สำเร็จ (HTTP 200) ครั้งที่ 1/3
POST /api/v1/boardgames 201 66.639 ms - 347
```

ผลที่ได้: service ตอบ 200 พร้อม `sent: false` (ไม่ใช่ความผิดพลาดชั่วคราว) API หลักจึง **ไม่ retry** (`attempts: 1`) และตอบ 201 พร้อม fallback ทันที ประวัติบันทึก `status: "skipped"`

### 5. ข้อสรุประยะที่ 3

- **Retry:** network error, 5xx และ timeout ลองใหม่ครบ 3 ครั้งพร้อม exponential backoff (500 → 1000 ms) และนับจำนวนครั้งที่ปลายทางได้รับจริงตรงกัน (กรณี 2)
- **Timeout:** ทำงานทั้ง 2 ชั้น คือ notification-service ตัดที่ 1500 ms (กรณี 3) และ API หลักตัดที่ 2000 ms (กรณี 4)
- **Fallback:** ทุกกรณีผู้ใช้ได้ 201 และข้อมูลถูกบันทึก พร้อม `notification.sent = false` และข้อความอธิบาย หน้าเว็บ Frontend แสดงเป็นข้อความเตือนสีเหลืองว่า "เพิ่มแล้ว แต่ส่งแจ้งเตือนไม่สำเร็จ"
- **Graceful degradation:** เมื่อ notification-service ล่ม ระบบหลัก (บอร์ดเกม/หมวดหมู่) ยังใช้งานได้ปกติ `/api/v1/health` บอกสถานะ `degraded` และหน้า Frontend แสดงป้าย "แจ้งเตือนใช้งานไม่ได้ชั่วคราว"
- **ข้อสังเกต:** กรณีแย่ที่สุด (กรณี 4) การเพิ่มเกมใช้เวลาประมาณ 7.6 วินาที เพราะระบบรอผลแจ้งเตือนก่อนตอบ ปรับให้เร็วขึ้นได้ผ่าน `EXTERNAL_API_TIMEOUT_MS`, `EXTERNAL_API_MAX_RETRIES` และ `DISCORD_TIMEOUT_MS` ใน `.env` โดยไม่ต้องแก้โค้ด

---

# ภาคผนวก: ผลการทดสอบระยะที่ 2 (API เรียก Discord โดยตรง)

ผลด้านล่างเป็นการทดสอบในระยะที่ 2 ก่อนแยก notification-service เก็บไว้เพื่ออ้างอิง


ทดสอบเมื่อ 12 ตุลาคม 2569 (2026-10-12) บนเครื่อง local (Node.js + MySQL) โดยยิง `POST /api/v1/boardgames` ผ่าน Postman

### 1. ฟีเจอร์ที่ทดสอบ

เมื่อเพิ่มบอร์ดเกมใหม่สำเร็จ ระบบจะส่งข้อความแจ้งเตือนไปที่ห้อง Discord ผ่าน Discord Webhook (API ภายนอก) โค้ดอยู่ที่ `src/services/external-api.js`

| กลไก     | ค่าที่ตั้งไว้                                     | พฤติกรรม                                      |
| -------- | ------------------------------------------------- | --------------------------------------------- |
| Timeout  | 2000 ms ต่อ 1 ครั้งที่เรียก                       | เกินเวลาถือว่าล้มเหลว                         |
| Retry    | ลองใหม่ 2 ครั้ง (เรียกรวมสูงสุด 3 ครั้ง)          | ลองใหม่เมื่อ network error, timeout, HTTP 5xx |
| Backoff  | รอ 500 ms แล้วรอ 1000 ms (เพิ่มเป็น 2 เท่า)       | คั่นระหว่างแต่ละครั้ง                         |
| Fallback | ตอบ 201 ตามปกติ พร้อม `notification.sent = false` | การเพิ่มเกมไม่ล้มเหลวเพราะแจ้งเตือนไม่ได้     |

URL ของ Webhook เก็บในตัวแปร `DISCORD_WEBHOOK_URL` ใน `.env` และเปลี่ยนค่านี้เพื่อจำลองสถานการณ์ต่างๆ (หลังแก้ `.env` รีสตาร์ท nodemon ด้วย `rs` ทุกครั้ง)

### 2. สรุปผลการทดสอบ

| #   | สถานการณ์                            | ค่า `DISCORD_WEBHOOK_URL`        | เกมที่ใช้ทดสอบ | Status | `notification`               | เวลา            |
| --- | ------------------------------------ | -------------------------------- | -------------- | ------ | ---------------------------- | --------------- |
| 0   | ปกติ (baseline)                      | URL จริงของ Discord              | Pandemic       | 201    | `sent: true`, ครั้งที่ 1     | 665 ms          |
| 1   | เชื่อมต่อไม่ได้ (connection refused) | `http://localhost:59999/hook`    | Fail-1, Fail-2 | 201    | `sent: false`, `attempts: 3` | 1.58 s / 1.62 s |
| 2   | เซิร์ฟเวอร์ภายนอกตอบ 5xx             | `https://httpbin.org/status/503` | Fail-3         | 201    | `sent: false`, `attempts: 3` | 3.81 s          |
| 3   | ตอบช้าเกิน timeout                   | `https://httpbin.org/delay/10`   | Fail-4         | 201    | `sent: false`, `attempts: 3` | 7.61 s          |
| 4   | ไม่ได้ตั้งค่า URL                    | ไม่ได้ตั้งค่า                    | Fail-5, Fail-6 | 201    | `sent: false`, `attempts: 0` | 45-61 ms        |

กรณีที่ 1 และ 4 ทดสอบ 2 รอบ และได้ผลเหมือนกันทั้งสองรอบ

ทุกกรณี response ยังเป็น **201 Created**, ข้อมูลเกมถูกบันทึกลงฐานข้อมูล, เซิร์ฟเวอร์ไม่ crash และไม่ค้าง

### 3. รายละเอียดแต่ละกรณี

#### กรณี 0: ปกติ (baseline)

ใช้ Webhook URL จริง ข้อความ `🎲 เพิ่มบอร์ดเกมใหม่: Pandemic (2-4 ผู้เล่น)` ปรากฏในห้อง Discord

```
[external-api] discordapp.com สำเร็จ (HTTP 204) ครั้งที่ 1/3
POST /api/v1/boardgames 201 665.481 ms - 262
```

#### กรณี 1: เชื่อมต่อไม่ได้ (ECONNREFUSED)

ตั้ง URL ไปยังพอร์ตที่ไม่มีโปรแกรมรับฟังอยู่ ทดสอบ 2 รอบ (Fail-1 และ Fail-2) ได้ผลเหมือนกัน log ด้านล่างเป็นของรอบแรก (Fail-1)

```
[external-api] localhost:59999 ล้มเหลวครั้งที่ 1/3: ECONNREFUSED
[external-api] รอ 500 ms แล้วลองใหม่
[external-api] localhost:59999 ล้มเหลวครั้งที่ 2/3: ECONNREFUSED
[external-api] รอ 1000 ms แล้วลองใหม่
[external-api] localhost:59999 ล้มเหลวครั้งที่ 3/3: ECONNREFUSED
[external-api] ลองครบ 3 ครั้งแล้วยังล้มเหลว (ECONNREFUSED)
POST /api/v1/boardgames 201 1575.086 ms - 343
```

ผลที่ได้: เรียก 3 ครั้งตามที่กำหนด (ครั้งแรก + retry 2 ครั้ง) เวลารวมประมาณ 1.6 วินาที ซึ่งตรงกับ backoff 500 + 1000 ms ตอบ 201 พร้อม `notification.sent = false`, `attempts = 3` (รอบที่สองใช้เวลา 1618 ms ได้ผลเหมือนกัน)

#### กรณี 2: เซิร์ฟเวอร์ภายนอกตอบ HTTP 503

```
[external-api] httpbin.org ล้มเหลวครั้งที่ 1/3: HTTP 503
[external-api] รอ 500 ms แล้วลองใหม่
[external-api] httpbin.org ล้มเหลวครั้งที่ 2/3: HTTP 503
[external-api] รอ 1000 ms แล้วลองใหม่
[external-api] httpbin.org ล้มเหลวครั้งที่ 3/3: HTTP 503
[external-api] ลองครบ 3 ครั้งแล้วยังล้มเหลว (HTTP 503)
POST /api/v1/boardgames 201 3812.404 ms - 343
```

ผลที่ได้: retry เมื่อได้ 5xx ครบ 3 ครั้ง เวลารวม 3.81 วินาที (backoff 1.5 วินาที บวกเวลาเดินทางไปยัง httpbin.org ทั้ง 3 ครั้ง) แล้วตอบ 201 พร้อมข้อความ fallback

#### กรณี 3: ตอบช้าเกิน timeout

httpbin.org ถูกตั้งให้หน่วงการตอบ 10 วินาที แต่ระบบรอแค่ 2 วินาทีต่อครั้ง

```
[external-api] httpbin.org ล้มเหลวครั้งที่ 1/3: timeout (เกิน 2000 ms)
[external-api] รอ 500 ms แล้วลองใหม่
[external-api] httpbin.org ล้มเหลวครั้งที่ 2/3: timeout (เกิน 2000 ms)
[external-api] รอ 1000 ms แล้วลองใหม่
[external-api] httpbin.org ล้มเหลวครั้งที่ 3/3: timeout (เกิน 2000 ms)
[external-api] ลองครบ 3 ครั้งแล้วยังล้มเหลว (timeout (เกิน 2000 ms))
POST /api/v1/boardgames 201 7604.418 ms - 343
```

ผลที่ได้: timeout ตัดการรอที่ 2 วินาทีจริงทั้ง 3 ครั้ง เวลารวม 7.6 วินาที (2 × 3 + 1.5) ไม่ได้รอครบ 10 วินาทีต่อครั้ง แล้วตอบ 201 พร้อมข้อความ fallback

#### กรณี 4: ไม่ได้ตั้งค่า URL

ทดสอบ 2 รอบ (Fail-5 และ Fail-6) ได้ผลเหมือนกัน

```
[external-api] ไม่ได้ตั้งค่า DISCORD_WEBHOOK_URL ข้ามการแจ้งเตือน
POST /api/v1/boardgames 201 51.618 ms - 344
```

ผลที่ได้: ระบบข้ามการเรียก API ภายนอก (`attempts = 0`) ตอบ 201 ทันทีโดยไม่ crash (รอบที่สองใช้เวลา 38 ms)

### 4. ข้อสรุป

- **Retry:** ล้มเหลวจาก network error, 5xx และ timeout จะลองใหม่ครบ 3 ครั้ง (ครั้งแรก + 2 ครั้ง) พร้อม exponential backoff ตรงตามที่ออกแบบ
- **Timeout:** ตัดการรอที่ 2000 ms ต่อครั้งจริง (กรณี 3)
- **Fallback:** ทุกกรณีที่ API ภายนอกล้มเหลว ผู้ใช้ได้ 201 และข้อความอธิบายใน `notification` แทนที่ระบบจะ error ข้อมูลเกมถูกบันทึกแล้ว
- **ข้อสังเกต:** เนื่องจากระบบรอผลการแจ้งเตือนก่อนตอบ ในกรณีที่แย่ที่สุด (timeout ทั้ง 3 ครั้ง) การเพิ่มเกมใช้เวลาประมาณ 7.6 วินาที เป็นข้อแลกเปลี่ยนที่เลือกไว้เพื่อให้ response บอกสถานะการแจ้งเตือนได้ ถ้าต้องการให้ตอบเร็วขึ้น สามารถปรับ `EXTERNAL_API_TIMEOUT_MS` หรือ `EXTERNAL_API_MAX_RETRIES` ผ่านไฟล์ `.env` ได้โดยไม่ต้องแก้โค้ด
