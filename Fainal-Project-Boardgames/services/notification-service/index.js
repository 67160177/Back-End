// ==========================================
// Notification Service (Microservice)
// รับคำขอแจ้งเตือนจาก API หลักผ่าน HTTP แล้วส่งต่อไปที่ Discord Webhook
//
// - เป็น process แยกจาก boardgame-service (พอร์ต 4002) ไม่ใช้ฐานข้อมูลร่วมกัน
// - boardgame-service เรียก POST /notifications ตรง ส่วน client ดูประวัติผ่าน Gateway
// - ส่งไป Discord ครั้งเดียวต่อคำขอ พร้อม timeout ส่วนการ retry/fallback
//   เป็นหน้าที่ของฝั่งผู้เรียก (src/services/external-api.js ใน API หลัก)
// - เก็บประวัติการแจ้งเตือนล่าสุดไว้ในหน่วยความจำ (หายเมื่อรีสตาร์ท)
// ==========================================

require("dotenv").config({ quiet: true });

const express = require("express");
const helmet = require("helmet");
const morgan = require("morgan");

const app = express();
const PORT = process.env.NOTIFICATION_PORT || 4002;

const MAX_HISTORY = 50;
const history = []; // ใหม่สุดอยู่หน้าสุด
let nextId = 1;

const discordTimeoutMs = () => {
  const value = Number(process.env.DISCORD_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : 1500;
};

const log = (message) => console.log(`[notification-service] ${message}`);

app.use(helmet());
if (process.env.NODE_ENV !== "test") app.use(morgan("dev"));
app.use(express.json({ limit: "10kb" }));

const badRequest = (res, message) =>
  res.status(400).json({
    error: { code: "INVALID_NOTIFICATION", message },
  });

// บันทึกประวัติ: ใส่ใหม่ไว้หน้าสุด (unshift) แล้วตัดให้เหลือ 50 รายการล่าสุด กันหน่วยความจำโตเรื่อยๆ
const record = (entry) => {
  const saved = { id: nextId++, ...entry, createdAt: new Date().toISOString() };
  history.unshift(saved);
  history.length = Math.min(history.length, MAX_HISTORY);
  return saved;
};

// ส่งข้อความไป Discord 1 ครั้ง คืน { ok, status?, error?, timeout? }
async function sendToDiscord(url, content) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        allowed_mentions: { parse: [] }, // กันชื่อเกมที่มี @everyone ไปแท็กคนในห้อง
      }),
      signal: AbortSignal.timeout(discordTimeoutMs()),
    });
    await response.text().catch(() => "");

    return response.ok
      ? { ok: true, status: response.status }
      : { ok: false, error: `Discord ตอบ HTTP ${response.status}` };
  } catch (err) {
    if (err.name === "TimeoutError") {
      return {
        ok: false,
        timeout: true,
        error: `Discord ไม่ตอบภายใน ${discordTimeoutMs()} ms`,
      };
    }
    return {
      ok: false,
      error: `เชื่อมต่อ Discord ไม่ได้ (${err.cause?.code || err.message})`,
    };
  }
}

// ==========================================
// ROUTES
// ==========================================

// ตรวจสอบสถานะ service
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "notification-service",
    discordConfigured: Boolean(process.env.DISCORD_WEBHOOK_URL),
  });
});

// ประวัติการแจ้งเตือนล่าสุด
app.get("/notifications", (req, res) => {
  res.status(200).json({
    message: "สำเร็จ",
    data: history,
  });
});

// รับคำขอแจ้งเตือนว่ามีบอร์ดเกมใหม่
app.post("/notifications", async (req, res) => {
  const { type, boardgame } = req.body || {};

  if (type !== "boardgame.created") {
    return badRequest(res, 'type ต้องเป็น "boardgame.created"');
  }

  if (
    !boardgame ||
    typeof boardgame.name !== "string" ||
    !Number.isInteger(boardgame.minPlayers) ||
    !Number.isInteger(boardgame.maxPlayers)
  ) {
    return badRequest(
      res,
      "boardgame ต้องมี name (ข้อความ), minPlayers และ maxPlayers (จำนวนเต็ม)",
    );
  }

  const message = `🎲 เพิ่มบอร์ดเกมใหม่: ${boardgame.name} (${boardgame.minPlayers}-${boardgame.maxPlayers} ผู้เล่น)`;
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

  // ไม่ได้ตั้งค่า webhook: ไม่ใช่ความผิดพลาดชั่วคราว จึงตอบ 200 พร้อม sent: false (ผู้เรียกไม่ต้อง retry)
  if (!webhookUrl) {
    log("ไม่ได้ตั้งค่า DISCORD_WEBHOOK_URL ข้ามการแจ้งเตือน");
    const saved = record({
      type,
      message,
      status: "skipped",
      error: "ยังไม่ได้ตั้งค่า Discord Webhook",
    });
    return res.status(200).json({
      message: "ไม่ได้ตั้งค่า Discord Webhook จึงไม่ได้ส่งแจ้งเตือน",
      data: { id: saved.id, sent: false },
    });
  }

  const result = await sendToDiscord(webhookUrl, message);

  if (result.ok) {
    log(`ส่งไป Discord สำเร็จ (HTTP ${result.status})`);
    const saved = record({ type, message, status: "sent" });
    return res.status(200).json({
      message: "ส่งแจ้งเตือนไปที่ Discord แล้ว",
      data: { id: saved.id, sent: true },
    });
  }

  // Discord ล้มเหลว: ตอบ 5xx ให้ผู้เรียกรู้ว่าเป็นความผิดพลาดชั่วคราวและ retry ได้
  log(`ส่งไป Discord ไม่สำเร็จ: ${result.error}`);
  record({ type, message, status: "failed", error: result.error });

  return res.status(result.timeout ? 504 : 502).json({
    error: {
      code: result.timeout ? "DISCORD_TIMEOUT" : "DISCORD_ERROR",
      message: result.error,
    },
  });
});

// 404: ไม่พบ Route
app.use((req, res) => {
  res.status(404).json({
    error: {
      code: "ROUTE_NOT_FOUND",
      message: "ไม่พบเส้นทางที่ร้องขอ",
    },
  });
});

// Error-handling middleware (เช่น JSON ผิดรูปแบบ)
app.use((err, req, res, next) => {
  const statusCode = err.status || err.statusCode || 500;
  if (statusCode === 500) console.error(err.stack);

  res.status(statusCode).json({
    error: {
      code: statusCode === 500 ? "INTERNAL_SERVER_ERROR" : err.type || "ERROR",
      message:
        statusCode === 500 ? "เกิดข้อผิดพลาดที่ไม่คาดคิดภายในระบบ" : err.message,
    },
  });
});

// เริ่ม server เมื่อรันไฟล์นี้โดยตรงเท่านั้น (ตอน test จะ require ไปใช้กับ supertest)
if (require.main === module) {
  app.listen(PORT, (err) => {
    // Express 5 ส่ง error (เช่น EADDRINUSE) มาที่ callback แทนการ throw
    if (err) {
      log(`พอร์ต ${PORT} ถูกใช้งานอยู่หรือเปิดไม่ได้: ${err.message}`);
      process.exit(1);
    }
    log(`กำลังทำงานที่ http://localhost:${PORT}`);
  });
}

module.exports = app;
