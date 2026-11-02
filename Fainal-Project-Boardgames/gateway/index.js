// ==========================================
// API Gateway (พอร์ต 3000) - จุดเข้าถึงเดียวของ client
//
// หน้าที่ (ตามปฏิบัติการสัปดาห์ที่ 13)
// 1. Routing: ส่งต่อคำขอไปยัง service ที่รับผิดชอบ
// 2. Failure handling: service ล่ม -> 503, service ตอบช้าเกิน timeout -> 504 (Gateway ไม่ crash ไม่ค้าง)
// 3. Rate limiting (สัปดาห์ที่ 12): จำกัดจำนวนคำขอต่อ IP ก่อนถึง service ใดๆ
// 4. Authentication: คำขอเพิ่ม/แก้ไข/ลบต้องแนบ JWT (ออกโดย auth-service) ส่วนการดูข้อมูล (GET) ไม่ต้อง
//    Authorization: ลบบอร์ดเกม/หมวดหมู่ได้เฉพาะ role admin
// 5. ให้บริการหน้าเว็บ Frontend (/app) และเอกสาร API (/api-docs)
//
// Gateway ไม่มี business logic และไม่ต่อฐานข้อมูลเอง
// ==========================================

require("dotenv").config({ quiet: true });

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const swaggerUi = require("swagger-ui-express");
const { rateLimit } = require("express-rate-limit");
const jwt = require("jsonwebtoken");

const app = express();
const PORT = process.env.PORT || 3000;

const log = (message) => console.log(`[gateway] ${message}`);

// อ่านค่าจาก env ตอนเรียกใช้ (ไม่ใช่ตอนโหลดไฟล์) เพื่อให้ test เปลี่ยนค่าได้
const SERVICES = () => ({
  boardgame: {
    name: "boardgame-service",
    url: process.env.BOARDGAME_SERVICE_URL || "http://localhost:4001",
  },
  notification: {
    name: "notification-service",
    url: process.env.NOTIFICATION_SERVICE_URL || "http://localhost:4002",
  },
  auth: {
    name: "auth-service",
    url: process.env.AUTH_SERVICE_URL || "http://localhost:4003",
  },
});

// timeout ต้องมากกว่าเวลาที่แย่ที่สุดของ service ปลายทาง
// (POST /boardgames อาจใช้ ~7.6 วินาทีเมื่อ notification-service มีปัญหา ดู failure-scenario-results.md)
const timeoutMs = () => {
  const value = Number(process.env.GATEWAY_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : 10000;
};

// ==========================================
// MIDDLEWARE
// ==========================================

app.use(helmet());
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGIN || "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
if (process.env.NODE_ENV !== "test") app.use(morgan("dev"));
app.use(express.json({ limit: "10kb" }));

// หน้าเว็บ Frontend (HTML/CSS/JS ล้วน)
app.use("/app", express.static(path.join(__dirname, "..", "frontend")));

// เอกสาร API (ไฟล์เดียวกับที่ boardgame-service ใช้)
const openapiDocument = yaml.load(
  fs.readFileSync(path.join(__dirname, "..", "openapi.yaml"), "utf8"),
);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openapiDocument));

// ==========================================
// RATE LIMITING (สัปดาห์ที่ 12)
// ==========================================

// อ่านจำนวนจาก env ทุกคำขอ (ตั้ง 0 = ปิด) เช่นปิดชั่วคราวระหว่างซ้อม demo ได้โดยไม่แก้โค้ด
const envNumber = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

// เก็บจำนวนคำขอในหน่วยความจำของ Gateway (ถ้ารัน Gateway หลาย instance ต้องใช้ store กลาง เช่น Redis)
const createLimiter = ({
  windowEnv,
  maxEnv,
  defaultWindowMs,
  defaultMax,
  message,
}) => {
  const max = () => envNumber(maxEnv, defaultMax);

  return rateLimit({
    windowMs: envNumber(windowEnv, defaultWindowMs) || defaultWindowMs,
    limit: max,
    skip: (req) => max() === 0 || req.path === "/health", // health ไม่นับ ให้ป้ายสถานะระบบทำงานเสมอ
    standardHeaders: "draft-7", // RateLimit / RateLimit-Policy และ Retry-After เมื่อเกิน
    legacyHeaders: false,
    handler: (req, res) => {
      const seconds = req.rateLimit.resetTime
        ? Math.max(1, Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000))
        : Math.ceil(envNumber(windowEnv, defaultWindowMs) / 1000);
      log(`rate limit: ${req.ip} ${req.method} ${req.originalUrl}`);
      res.status(429).json({
        error: {
          code: "TOO_MANY_REQUESTS",
          message: `${message} กรุณาลองใหม่ในอีก ${seconds} วินาที`,
        },
      });
    },
  });
};

// API ทั้งหมด: กันการยิงคำขอจำนวนมากจนระบบช้า
const apiLimiter = createLimiter({
  windowEnv: "RATE_LIMIT_WINDOW_MS",
  maxEnv: "RATE_LIMIT_MAX",
  defaultWindowMs: 60 * 1000,
  defaultMax: 300,
  message: "ส่งคำขอบ่อยเกินไป",
});

// สมัครสมาชิก/เข้าสู่ระบบ: เข้มกว่า กันการเดารหัสผ่านทีละหลายพันครั้ง (นับรวมกับโควตาทั่วไปด้วย)
const authLimiter = createLimiter({
  windowEnv: "AUTH_RATE_LIMIT_WINDOW_MS",
  maxEnv: "AUTH_RATE_LIMIT_MAX",
  defaultWindowMs: 60 * 1000,
  defaultMax: 10,
  message: "พยายามเข้าสู่ระบบ/สมัครสมาชิกบ่อยเกินไป",
});

app.use("/api/v1", apiLimiter);
app.use(["/api/v1/auth/login", "/api/v1/auth/register"], authLimiter);

// ==========================================
// AUTHENTICATION
// ==========================================

// ตรวจ JWT ที่ Gateway เอง (ใช้ JWT_SECRET เดียวกับ auth-service) ไม่ต้องถาม auth-service ทุกคำขอ
// ผ่าน -> req.user = { id, username } แล้วไปต่อ / ไม่ผ่าน -> 401 และไม่ส่งต่อไป service ใด
function requireAuth(req, res, next) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return res.status(503).json({
      error: { code: "AUTH_NOT_CONFIGURED", message: "ระบบยังไม่ได้ตั้งค่า JWT_SECRET" },
    });
  }

  const [scheme, token] = (req.headers.authorization || "").split(" ");
  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบก่อน (ไม่พบ token)" },
    });
  }

  try {
    const payload = jwt.verify(token, secret, { algorithms: ["HS256"] });
    // token รุ่นก่อนมี role ไม่มีฟิลด์ role ถือเป็น member
    req.user = {
      id: Number(payload.sub),
      username: payload.username,
      role: payload.role === "admin" ? "admin" : "member",
    };
    next();
  } catch (err) {
    const expired = err.name === "TokenExpiredError";
    res.status(401).json({
      error: {
        code: expired ? "TOKEN_EXPIRED" : "INVALID_TOKEN",
        message: expired
          ? "การเข้าสู่ระบบหมดอายุ กรุณาเข้าสู่ระบบใหม่"
          : "token ไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่",
      },
    });
  }
}

// ใช้หลัง requireAuth: ไม่ใช่ admin -> 403 (เข้าสู่ระบบแล้ว แต่ไม่มีสิทธิ์) และไม่ส่งต่อไป service ใด
function requireAdmin(req, res, next) {
  if (req.user.role === "admin") return next();
  res.status(403).json({
    error: { code: "FORBIDDEN", message: "เฉพาะผู้ดูแลระบบ (admin) เท่านั้นที่ลบข้อมูลได้" },
  });
}

// ==========================================
// FORWARDING
// ==========================================

// ส่งต่อคำขอไปยัง service แล้วคืนผลตามเดิม (รวม 4xx/5xx ที่ service ตอบมา)
// ถ้าติดต่อ service ไม่ได้ -> 503 / เกิน timeout -> 504
//
// forward(serviceKey, toPath) คืน "route handler" ให้ Express
// - serviceKey: ส่งไป service ไหน (boardgame / notification)
// - toPath: path ปลายทาง ค่าเริ่มต้นใช้ path เดิมทั้งหมดรวม query string
//   เช่น /api/v1/boardgames?page=2 -> http://localhost:4001/api/v1/boardgames?page=2
//   ส่วน notification ใช้ path สั้นของตัวเอง เช่น /api/v1/notifications -> http://localhost:4002/notifications
// ไม่ retry ที่ชั้นนี้: POST/DELETE ไม่ idempotent ส่งซ้ำอาจเพิ่มเกมซ้ำ (architecture.md ข้อ 3)
const forward =
  (serviceKey, toPath = (req) => req.originalUrl) =>
  async (req, res) => {
    const service = SERVICES()[serviceKey];

    try {
      const response = await axios({
        method: req.method,
        url: `${service.url}${toPath(req)}`,
        data: req.body,
        // ส่ง token ต่อให้ service ที่ต้องรู้ว่าใครเรียก (เช่น auth-service /auth/me)
        headers: req.headers.authorization
          ? { Authorization: req.headers.authorization }
          : {},
        timeout: timeoutMs(),
        validateStatus: () => true, // ไม่ throw เมื่อ service ตอบ 4xx/5xx
      });

      // บอก client ว่าคำตอบมาจาก cache ของ boardgame-service หรือไม่
      if (response.headers["x-cache"])
        res.set("X-Cache", response.headers["x-cache"]);

      return typeof response.data === "object"
        ? res.status(response.status).json(response.data)
        : res.status(response.status).send(response.data);
    } catch (err) {
      // มาถึงตรงนี้ได้แค่ 2 กรณี (4xx/5xx ไม่ throw เพราะ validateStatus):
      // ติดต่อ service ไม่ได้เลย (เช่น ECONNREFUSED = service ปิดอยู่) หรือรอเกิน timeout
      const timedOut = err.code === "ECONNABORTED" || err.code === "ETIMEDOUT";
      log(
        `${service.name} ${timedOut ? "ตอบช้าเกิน timeout" : "ไม่พร้อมใช้งาน"} (${err.code || err.message})`,
      );

      return res.status(timedOut ? 504 : 503).json({
        error: timedOut
          ? {
              code: "GATEWAY_TIMEOUT",
              message: `${service.name} ไม่ตอบภายในเวลาที่กำหนด กรุณาลองใหม่`,
            }
          : {
              code: "SERVICE_UNAVAILABLE",
              message: `${service.name} ไม่พร้อมใช้งานในขณะนี้`,
            },
      });
    }
  };

// ==========================================
// ROUTES
// ==========================================

app.get("/", (req, res) => {
  res.status(200).json({
    message: "Board Game API Gateway พร้อมใช้งาน",
    frontend: "/app",
    docs: "/api-docs",
  });
});

// ตรวจสถานะทุก service พร้อมกัน
// boardgame-service ล่ม = down (503) เพราะใช้งานหลักไม่ได้
// notification หรือ auth ล่ม = degraded (200) เพราะยังดู/ค้นหาบอร์ดเกมได้
app.get("/api/v1/health", async (req, res) => {
  const check = async (service) => {
    try {
      const r = await axios.get(`${service.url}/health`, {
        timeout: 2000,
        validateStatus: () => true,
      });
      return { up: r.status === 200, body: r.data };
    } catch {
      return { up: false, body: null };
    }
  };

  // ถามทุก service พร้อมกัน (Promise.all) แทนทีละตัว: แย่สุดรอ 2 วินาที ไม่ใช่ 6 วินาที
  const services = SERVICES();
  const [boardgame, notification, auth] = await Promise.all([
    check(services.boardgame),
    check(services.notification),
    check(services.auth),
  ]);

  const status = !boardgame.up
    ? "down"
    : notification.up && auth.up
      ? "ok"
      : "degraded";

  res.status(boardgame.up ? 200 : 503).json({
    status,
    services: {
      gateway: "up",
      boardgameService: boardgame.up ? "up" : "down",
      database: boardgame.body?.database || "unknown",
      notificationService: notification.up ? "up" : "down",
      authService: auth.up ? "up" : "down",
    },
  });
});

// Notification Service (ดูประวัติได้ทุกคน)
app.get(
  "/api/v1/notifications",
  forward("notification", () => "/notifications"),
);

// Auth Service: สมัคร/เข้าสู่ระบบไม่ต้องมี token, /me ต้องมี
app.post("/api/v1/auth/register", forward("auth", () => "/auth/register")); // สมัครสมาชิก
app.post("/api/v1/auth/login", forward("auth", () => "/auth/login")); // เข้าสู่ระบบ -> JWT
app.get("/api/v1/auth/me", requireAuth, forward("auth", () => "/auth/me")); // ข้อมูลผู้ใช้จาก token

// Boardgame Service: เส้นทางเดียวกันทุกตัว ส่งต่อไปที่ boardgame-service (พอร์ต 4001) แบบ path เดิม
// GET ดูได้ทุกคน / เพิ่ม แก้ไข ต้องเข้าสู่ระบบ (requireAuth) / ลบบอร์ดเกม-หมวดหมู่ ต้องเป็น admin (requireAdmin)
// บอร์ดเกม
app.get("/api/v1/boardgames", forward("boardgame")); // รายการบอร์ดเกม (กรอง/แบ่งหน้า/เรียง)
app.post("/api/v1/boardgames", requireAuth, forward("boardgame")); // เพิ่มบอร์ดเกม
app.get("/api/v1/boardgames/:id", forward("boardgame")); // ดูบอร์ดเกม 1 เกม
app.put("/api/v1/boardgames/:id", requireAuth, forward("boardgame")); // แก้ไขบอร์ดเกม (ส่งครบทุกฟิลด์)
app.patch("/api/v1/boardgames/:id", requireAuth, forward("boardgame")); // แก้ไขบางฟิลด์
app.delete("/api/v1/boardgames/:id", requireAuth, requireAdmin, forward("boardgame")); // ลบบอร์ดเกม (admin)

// หมวดหมู่
app.get("/api/v1/categories", forward("boardgame")); // รายการหมวดหมู่
app.post("/api/v1/categories", requireAuth, forward("boardgame")); // เพิ่มหมวดหมู่
app.get("/api/v1/categories/:id", forward("boardgame")); // ดูหมวดหมู่ 1 หมวด
app.put("/api/v1/categories/:id", requireAuth, forward("boardgame")); // แก้ไขหมวดหมู่
app.delete("/api/v1/categories/:id", requireAuth, requireAdmin, forward("boardgame")); // ลบหมวดหมู่ (admin)

// ความสัมพันธ์ บอร์ดเกม <-> หมวดหมู่ (Many-to-Many)
app.get("/api/v1/boardgames/:id/categories", forward("boardgame")); // หมวดหมู่ของเกม
app.post("/api/v1/boardgames/:id/categories", requireAuth, forward("boardgame")); // ผูกหมวดหมู่กับเกม
app.delete(
  "/api/v1/boardgames/:id/categories/:categoryId",
  requireAuth,
  forward("boardgame"),
); // ถอดหมวดหมู่ออกจากเกม (แค่แก้ความสัมพันธ์ member ทำได้)

// 404: ไม่พบ Route (ไม่ส่งต่อไปที่ service ใด)
app.use((req, res) => {
  res.status(404).json({
    error: {
      code: "ROUTE_NOT_FOUND",
      message: "ไม่พบเส้นทางที่ร้องขอ",
    },
  });
});

// Error-handling middleware (เช่น JSON ผิดรูปแบบ, body ใหญ่เกิน 10 KB)
app.use((err, req, res, next) => {
  const statusCode = err.status || err.statusCode || 500;
  if (statusCode === 500) console.error(err.stack);

  res.status(statusCode).json({
    error: {
      code: statusCode === 500 ? "INTERNAL_SERVER_ERROR" : err.type || "ERROR",
      message:
        statusCode === 500
          ? "เกิดข้อผิดพลาดที่ไม่คาดคิดภายในระบบ"
          : err.message,
    },
  });
});

if (require.main === module) {
  app.listen(PORT, (err) => {
    // Express 5 ส่ง error (เช่น EADDRINUSE) มาที่ callback แทนการ throw
    if (err) {
      log(`พอร์ต ${PORT} ถูกใช้งานอยู่หรือเปิดไม่ได้: ${err.message}`);
      process.exit(1);
    }
    log(`กำลังทำงานที่ http://localhost:${PORT}`);
    log(`Frontend:   http://localhost:${PORT}/app`);
    log(`Swagger UI: http://localhost:${PORT}/api-docs`);
  });
}

module.exports = app;
