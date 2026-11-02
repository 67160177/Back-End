// ==========================================
// Auth Service (Microservice) - สมัครสมาชิก / เข้าสู่ระบบ
//
// - เป็น process แยก (พอร์ต 4003) เป็นเจ้าของตาราง users เพียงผู้เดียว (service อื่นไม่อ่าน/เขียนตารางนี้)
// - เก็บรหัสผ่านเป็น scrypt hash + salt สุ่มต่อผู้ใช้ ไม่เก็บรหัสผ่านจริง
// - เข้าสู่ระบบสำเร็จได้ JWT (HS256) อายุ JWT_EXPIRES_IN (ค่าเริ่มต้น 2 ชั่วโมง) ใน token มี role ด้วย
// - role: สมัครผ่าน API ได้ member เสมอ ส่วน admin มาจาก 2 ทาง
//   1) ADMIN_USERNAME / ADMIN_PASSWORD ใน .env: ตอนเปิด service จะสร้าง/อัปเดตบัญชีนี้ให้เป็น admin (syncEnvAdmin)
//   2) npm run create-admin (scripts/create-admin.js) สำหรับ admin คนอื่นเพิ่มเติม
// - Gateway ตรวจ JWT เองด้วย JWT_SECRET เดียวกัน (ไม่ต้องเรียก service นี้ทุกคำขอ)
//   auth-service ล่ม -> สมัคร/เข้าสู่ระบบใหม่ไม่ได้ แต่ token ที่ได้ไปแล้วยังใช้ได้จนหมดอายุ
// ==========================================

require("dotenv").config({ quiet: true });

const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const morgan = require("morgan");
const jwt = require("jsonwebtoken");
const pool = require("../../db");
const {
  hashPassword,
  verifyPassword,
  USERNAME_PATTERN,
  PASSWORD_MIN,
  PASSWORD_MAX,
} = require("./password");
const { syncEnvAdmin } = require("./admin");

const app = express();
const PORT = process.env.AUTH_PORT || 4003;

const log = (message) => console.log(`[auth-service] ${message}`);

app.use(helmet());
if (process.env.NODE_ENV !== "test") app.use(morgan("dev"));
app.use(express.json({ limit: "10kb" }));

const sendError = (res, status, code, message) =>
  res.status(status).json({ error: { code, message } });

// hash ของรหัสที่ไม่มีใครใช้ ใช้ตอนไม่พบชื่อผู้ใช้ เพื่อให้เวลาตอบเท่ากับกรณีรหัสผิด
// (กันการเดาว่าชื่อผู้ใช้ไหนมีอยู่จากเวลาตอบ)
const dummyHash = hashPassword(crypto.randomBytes(16).toString("hex"));

const publicUser = (row) => ({
  id: row.id,
  username: row.username,
  role: row.role,
  createdAt: row.created_at,
});

// ==========================================
// ตรวจข้อมูลที่ส่งมา
// ==========================================

function validateCredentials({ username, password }, res, { strict }) {
  if (username === undefined || password === undefined) {
    sendError(res, 400, "MISSING_FIELDS", "กรุณาระบุ username และ password ให้ครบถ้วน");
    return false;
  }
  if (typeof username !== "string" || typeof password !== "string") {
    sendError(res, 400, "INVALID_CREDENTIALS_FORMAT", "username และ password ต้องเป็นข้อความ");
    return false;
  }
  // ตอนสมัครตรวจรูปแบบเต็ม ตอนเข้าสู่ระบบไม่บอกกฎ (ผิดก็แค่ 401)
  if (strict && !USERNAME_PATTERN.test(username)) {
    sendError(
      res,
      400,
      "INVALID_USERNAME",
      "username ต้องยาว 3-30 ตัวอักษร ใช้ได้เฉพาะ a-z, A-Z, 0-9 และ _",
    );
    return false;
  }
  if (strict && (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX)) {
    sendError(
      res,
      400,
      "INVALID_PASSWORD",
      `password ต้องยาว ${PASSWORD_MIN}-${PASSWORD_MAX} ตัวอักษร`,
    );
    return false;
  }
  return true;
}

// ไม่ได้ตั้ง JWT_SECRET = ออก token ไม่ได้ (ไม่ใช้ค่า default เพราะใครก็ปลอม token ได้)
function jwtSecret(res) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    sendError(res, 503, "AUTH_NOT_CONFIGURED", "ระบบยังไม่ได้ตั้งค่า JWT_SECRET");
    return null;
  }
  return secret;
}

// ==========================================
// ROUTES
// ==========================================

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).json({ status: "ok", service: "auth-service", database: "up" });
  } catch {
    res.status(503).json({ status: "down", service: "auth-service", database: "down" });
  }
});

// สมัครสมาชิก
app.post("/auth/register", async (req, res, next) => {
  const body = req.body || {};
  if (!validateCredentials(body, res, { strict: true })) return;

  try {
    const passwordHash = await hashPassword(body.password);
    const [result] = await pool.query(
      "INSERT INTO users (username, password_hash) VALUES (?, ?)",
      [body.username, passwordHash],
    );
    log(`สมัครสมาชิกใหม่: ${body.username}`);
    // ไม่รับ role จาก body: สมัครเองได้ member เสมอ (กันการสมัครเป็น admin เอง)
    res.status(201).json({
      message: "สมัครสมาชิกสำเร็จ",
      data: { id: result.insertId, username: body.username, role: "member" },
    });
  } catch (err) {
    // UNIQUE ของ username (collation ของ MySQL ไม่สนตัวพิมพ์เล็ก/ใหญ่: Alice กับ alice ถือว่าซ้ำ)
    if (err.code === "ER_DUP_ENTRY") {
      return sendError(res, 409, "USERNAME_TAKEN", "username นี้ถูกใช้แล้ว");
    }
    next(err);
  }
});

// เข้าสู่ระบบ -> JWT
app.post("/auth/login", async (req, res, next) => {
  const body = req.body || {};
  if (!validateCredentials(body, res, { strict: false })) return;

  const secret = jwtSecret(res);
  if (!secret) return;

  try {
    const [rows] = await pool.query(
      "SELECT id, username, password_hash, role, created_at FROM users WHERE username = ?",
      [body.username],
    );
    const user = rows[0];
    const ok = await verifyPassword(body.password, user ? user.password_hash : await dummyHash);

    // ชื่อไม่มี หรือรหัสผิด ตอบเหมือนกัน ไม่บอกว่าผิดที่ช่องไหน
    if (!user || !ok) {
      return sendError(res, 401, "INVALID_CREDENTIALS", "username หรือ password ไม่ถูกต้อง");
    }

    const expiresIn = process.env.JWT_EXPIRES_IN || "2h";
    const token = jwt.sign({ sub: String(user.id), username: user.username, role: user.role }, secret, {
      algorithm: "HS256",
      expiresIn,
    });

    log(`เข้าสู่ระบบ: ${user.username} (${user.role})`);
    res.status(200).json({
      message: "เข้าสู่ระบบสำเร็จ",
      data: { token, tokenType: "Bearer", expiresIn, user: publicUser(user) },
    });
  } catch (err) {
    next(err);
  }
});

// ข้อมูลผู้ใช้จาก token (Gateway ตรวจ token แล้วส่ง header Authorization ต่อมา ที่นี่ตรวจซ้ำเอง)
app.get("/auth/me", async (req, res, next) => {
  const secret = jwtSecret(res);
  if (!secret) return;

  const [scheme, token] = (req.headers.authorization || "").split(" ");
  let payload;
  try {
    if (scheme !== "Bearer" || !token) throw new Error("no token");
    payload = jwt.verify(token, secret, { algorithms: ["HS256"] });
  } catch {
    return sendError(res, 401, "UNAUTHORIZED", "กรุณาเข้าสู่ระบบ (token ไม่ถูกต้องหรือหมดอายุ)");
  }

  try {
    const [rows] = await pool.query(
      "SELECT id, username, role, created_at FROM users WHERE id = ?",
      [Number(payload.sub)],
    );
    if (rows.length === 0) {
      return sendError(res, 401, "UNAUTHORIZED", "ไม่พบผู้ใช้ของ token นี้");
    }
    res.status(200).json({ message: "สำเร็จ", data: publicUser(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// 404: ไม่พบ Route
app.use((req, res) => {
  sendError(res, 404, "ROUTE_NOT_FOUND", "ไม่พบเส้นทางที่ร้องขอ");
});

// Error-handling middleware (JSON ผิดรูปแบบ, ฐานข้อมูลล่ม ฯลฯ)
app.use((err, req, res, next) => {
  const statusCode = err.status || err.statusCode || 500;
  if (statusCode === 500) console.error(err.stack);

  sendError(
    res,
    statusCode,
    statusCode === 500 ? "INTERNAL_SERVER_ERROR" : err.type || "ERROR",
    statusCode === 500 ? "เกิดข้อผิดพลาดที่ไม่คาดคิดภายในระบบ" : err.message,
  );
});

// ==========================================
// บัญชี admin จาก .env (ADMIN_USERNAME / ADMIN_PASSWORD)
// ไม่ตั้งค่า = ข้าม / ฐานข้อมูลยังไม่พร้อม = แจ้งเตือนแต่ service ยังทำงานต่อ (เปิดใหม่ภายหลังจะลองอีกครั้ง)
// ==========================================

const ENV_ADMIN_MESSAGES = {
  created: (u) => `สร้างบัญชี admin "${u}" จาก .env แล้ว`,
  updated: (u, r) =>
    `อัปเดตบัญชี "${u}" ตาม .env: ${[r.roleChanged && "ตั้งเป็น admin", r.passwordChanged && "เปลี่ยนรหัสผ่าน"].filter(Boolean).join(", ")}`,
  unchanged: (u) => `บัญชี admin "${u}" ตรงกับ .env แล้ว`,
};

async function setupEnvAdmin({ pool: db = pool, env = process.env } = {}) {
  const username = env.ADMIN_USERNAME;
  const password = env.ADMIN_PASSWORD;
  if (!username && !password) return null;
  if (!username || !password) {
    log("คำเตือน: ตั้ง ADMIN_USERNAME หรือ ADMIN_PASSWORD ไม่ครบคู่ ข้ามการสร้าง admin จาก .env");
    return null;
  }

  try {
    const result = await syncEnvAdmin({ pool: db, username, password });
    log(ENV_ADMIN_MESSAGES[result.action](username, result));
    return result;
  } catch (err) {
    const hint = err.code === "ER_NO_SUCH_TABLE" || err.code === "ER_BAD_FIELD_ERROR" ? " (รัน npm run migrate ก่อน)" : "";
    log(`คำเตือน: สร้าง admin จาก .env ไม่สำเร็จ: ${err.message}${hint}`);
    return null;
  }
}

if (require.main === module) {
  app.listen(PORT, (err) => {
    if (err) {
      log(`พอร์ต ${PORT} ถูกใช้งานอยู่หรือเปิดไม่ได้: ${err.message}`);
      process.exit(1);
    }
    if (!process.env.JWT_SECRET) log("คำเตือน: ยังไม่ได้ตั้งค่า JWT_SECRET เข้าสู่ระบบจะได้ 503");
    log(`กำลังทำงานที่ http://localhost:${PORT}`);
    setupEnvAdmin();
  });
}

module.exports = app;
module.exports.setupEnvAdmin = setupEnvAdmin;
