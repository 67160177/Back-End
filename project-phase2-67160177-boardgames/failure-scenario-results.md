# ผลการทดสอบ Failure Scenario ของ External API

ทดสอบเมื่อ 12 ตุลาคม 2569 (2026-10-12) บนเครื่อง local (Node.js + MySQL) โดยยิง `POST /api/v1/boardgames` ผ่าน Postman

## 1. ฟีเจอร์ที่ทดสอบ

เมื่อเพิ่มบอร์ดเกมใหม่สำเร็จ ระบบจะส่งข้อความแจ้งเตือนไปที่ห้อง Discord ผ่าน Discord Webhook (API ภายนอก) โค้ดอยู่ที่ `src/services/external-api.js`

| กลไก     | ค่าที่ตั้งไว้                                     | พฤติกรรม                                      |
| -------- | ------------------------------------------------- | --------------------------------------------- |
| Timeout  | 2000 ms ต่อ 1 ครั้งที่เรียก                       | เกินเวลาถือว่าล้มเหลว                         |
| Retry    | ลองใหม่ 2 ครั้ง (เรียกรวมสูงสุด 3 ครั้ง)          | ลองใหม่เมื่อ network error, timeout, HTTP 5xx |
| Backoff  | รอ 500 ms แล้วรอ 1000 ms (เพิ่มเป็น 2 เท่า)       | คั่นระหว่างแต่ละครั้ง                         |
| Fallback | ตอบ 201 ตามปกติ พร้อม `notification.sent = false` | การเพิ่มเกมไม่ล้มเหลวเพราะแจ้งเตือนไม่ได้     |

URL ของ Webhook เก็บในตัวแปร `DISCORD_WEBHOOK_URL` ใน `.env` และเปลี่ยนค่านี้เพื่อจำลองสถานการณ์ต่างๆ (หลังแก้ `.env` รีสตาร์ท nodemon ด้วย `rs` ทุกครั้ง)

## 2. สรุปผลการทดสอบ

| #   | สถานการณ์                            | ค่า `DISCORD_WEBHOOK_URL`        | เกมที่ใช้ทดสอบ | Status | `notification`               | เวลา            |
| --- | ------------------------------------ | -------------------------------- | -------------- | ------ | ---------------------------- | --------------- |
| 0   | ปกติ (baseline)                      | URL จริงของ Discord              | Pandemic       | 201    | `sent: true`, ครั้งที่ 1     | 665 ms          |
| 1   | เชื่อมต่อไม่ได้ (connection refused) | `http://localhost:59999/hook`    | Fail-1, Fail-2 | 201    | `sent: false`, `attempts: 3` | 1.58 s / 1.62 s |
| 2   | เซิร์ฟเวอร์ภายนอกตอบ 5xx             | `https://httpbin.org/status/503` | Fail-3         | 201    | `sent: false`, `attempts: 3` | 3.81 s          |
| 3   | ตอบช้าเกิน timeout                   | `https://httpbin.org/delay/10`   | Fail-4         | 201    | `sent: false`, `attempts: 3` | 7.61 s          |
| 4   | ไม่ได้ตั้งค่า URL                    | ไม่ได้ตั้งค่า                    | Fail-5, Fail-6 | 201    | `sent: false`, `attempts: 0` | 45-61 ms        |

กรณีที่ 1 และ 4 ทดสอบ 2 รอบ และได้ผลเหมือนกันทั้งสองรอบ

ทุกกรณี response ยังเป็น **201 Created**, ข้อมูลเกมถูกบันทึกลงฐานข้อมูล, เซิร์ฟเวอร์ไม่ crash และไม่ค้าง

## 3. รายละเอียดแต่ละกรณี

### กรณี 0: ปกติ (baseline)

ใช้ Webhook URL จริง ข้อความ `🎲 เพิ่มบอร์ดเกมใหม่: Pandemic (2-4 ผู้เล่น)` ปรากฏในห้อง Discord

```
[external-api] discordapp.com สำเร็จ (HTTP 204) ครั้งที่ 1/3
POST /api/v1/boardgames 201 665.481 ms - 262
```

### กรณี 1: เชื่อมต่อไม่ได้ (ECONNREFUSED)

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

### กรณี 2: เซิร์ฟเวอร์ภายนอกตอบ HTTP 503

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

### กรณี 3: ตอบช้าเกิน timeout

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

### กรณี 4: ไม่ได้ตั้งค่า URL

ทดสอบ 2 รอบ (Fail-5 และ Fail-6) ได้ผลเหมือนกัน

```
[external-api] ไม่ได้ตั้งค่า DISCORD_WEBHOOK_URL ข้ามการแจ้งเตือน
POST /api/v1/boardgames 201 51.618 ms - 344
```

ผลที่ได้: ระบบข้ามการเรียก API ภายนอก (`attempts = 0`) ตอบ 201 ทันทีโดยไม่ crash (รอบที่สองใช้เวลา 38 ms)

## 4. ข้อสรุป

- **Retry:** ล้มเหลวจาก network error, 5xx และ timeout จะลองใหม่ครบ 3 ครั้ง (ครั้งแรก + 2 ครั้ง) พร้อม exponential backoff ตรงตามที่ออกแบบ
- **Timeout:** ตัดการรอที่ 2000 ms ต่อครั้งจริง (กรณี 3)
- **Fallback:** ทุกกรณีที่ API ภายนอกล้มเหลว ผู้ใช้ได้ 201 และข้อความอธิบายใน `notification` แทนที่ระบบจะ error ข้อมูลเกมถูกบันทึกแล้ว
- **ข้อสังเกต:** เนื่องจากระบบรอผลการแจ้งเตือนก่อนตอบ ในกรณีที่แย่ที่สุด (timeout ทั้ง 3 ครั้ง) การเพิ่มเกมใช้เวลาประมาณ 7.6 วินาที เป็นข้อแลกเปลี่ยนที่เลือกไว้เพื่อให้ response บอกสถานะการแจ้งเตือนได้ ถ้าต้องการให้ตอบเร็วขึ้น สามารถปรับ `EXTERNAL_API_TIMEOUT_MS` หรือ `EXTERNAL_API_MAX_RETRIES` ผ่านไฟล์ `.env` ได้โดยไม่ต้องแก้โค้ด
