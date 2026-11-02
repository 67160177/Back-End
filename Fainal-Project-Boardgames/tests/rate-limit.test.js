// ทดสอบ Rate limiting ที่ API Gateway (สัปดาห์ที่ 12)
// โหลด Gateway ใหม่ทุก test (jest.isolateModules) ให้ตัวนับคำขอเริ่มจาก 0 เสมอ
// service ปลายทางชี้ไปที่พอร์ตที่ไม่มีใครฟัง: คำขอที่ผ่าน limiter จะได้ 503 ส่วนที่ถูกบล็อกได้ 429
const request = require("supertest");

const DEAD_URL = "http://127.0.0.1:1";
const ENV_KEYS = ["RATE_LIMIT_MAX", "RATE_LIMIT_WINDOW_MS", "AUTH_RATE_LIMIT_MAX", "AUTH_RATE_LIMIT_WINDOW_MS"];

function loadGateway() {
  let app;
  jest.isolateModules(() => {
    app = require("../gateway");
  });
  return app;
}

const browse = (app) => request(app).get("/api/v1/boardgames");

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
  process.env.BOARDGAME_SERVICE_URL = DEAD_URL;
  process.env.NOTIFICATION_SERVICE_URL = DEAD_URL;
  process.env.AUTH_SERVICE_URL = DEAD_URL;
});

afterEach(() => {
  console.log.mockRestore();
  ENV_KEYS.forEach((key) => delete process.env[key]);
});

test("request over RATE_LIMIT_MAX -> 429 with Retry-After and not forwarded", async () => {
  process.env.RATE_LIMIT_MAX = "3";
  const app = loadGateway();

  const allowed = [];
  for (let i = 0; i < 3; i++) allowed.push((await browse(app)).status);
  const blocked = await browse(app);

  expect(allowed).toEqual([503, 503, 503]); // ผ่าน limiter ไปถึง (boardgame-service ที่ล่มอยู่)
  expect(blocked.status).toBe(429);
  expect(blocked.body.error.code).toBe("TOO_MANY_REQUESTS");
  expect(blocked.body.error.message).toMatch(/^ส่งคำขอบ่อยเกินไป กรุณาลองใหม่ในอีก \d+ วินาที$/);
  expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  expect(blocked.headers["ratelimit-policy"]).toBe("3;w=60");
});

test("all /api/v1 endpoints share the same quota", async () => {
  process.env.RATE_LIMIT_MAX = "2";
  const app = loadGateway();

  await browse(app);
  await request(app).get("/api/v1/categories");
  const blocked = await request(app).get("/api/v1/notifications");

  expect(blocked.status).toBe(429);
});

test("quota resets after RATE_LIMIT_WINDOW_MS", async () => {
  process.env.RATE_LIMIT_MAX = "1";
  process.env.RATE_LIMIT_WINDOW_MS = "200";
  const app = loadGateway();

  await browse(app);
  expect((await browse(app)).status).toBe(429);

  await new Promise((resolve) => setTimeout(resolve, 300));
  expect((await browse(app)).status).toBe(503);
});

test("health check is never rate limited", async () => {
  process.env.RATE_LIMIT_MAX = "1";
  const app = loadGateway();

  const statuses = [];
  for (let i = 0; i < 3; i++) statuses.push((await request(app).get("/api/v1/health")).status);

  expect(statuses).not.toContain(429);
});

test("RATE_LIMIT_MAX=0 disables the limiter (e.g. while rehearsing the demo)", async () => {
  process.env.RATE_LIMIT_MAX = "0";
  const app = loadGateway();

  const statuses = [];
  for (let i = 0; i < 15; i++) statuses.push((await browse(app)).status);

  expect(statuses).not.toContain(429);
});

test("defaults: 300 requests per minute", async () => {
  const app = loadGateway();

  const response = await browse(app);

  expect(response.headers["ratelimit-policy"]).toBe("300;w=60");
});

describe("login / register limiter (กันการเดารหัสผ่าน)", () => {
  const login = (app) => request(app).post("/api/v1/auth/login").send({ username: "alice", password: "guess" });

  test("over AUTH_RATE_LIMIT_MAX -> 429, login and register share the quota", async () => {
    process.env.AUTH_RATE_LIMIT_MAX = "2";
    const app = loadGateway();

    await login(app);
    await request(app).post("/api/v1/auth/register").send({ username: "bob", password: "s3cret-pass" });
    const blocked = await login(app);

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.message).toMatch(/^พยายามเข้าสู่ระบบ\/สมัครสมาชิกบ่อยเกินไป/);
  });

  test("blocked from login but browsing still works", async () => {
    process.env.AUTH_RATE_LIMIT_MAX = "1";
    const app = loadGateway();

    await login(app);
    expect((await login(app)).status).toBe(429);
    expect((await browse(app)).status).toBe(503); // ผ่าน limiter ไปถึง service (ที่ล่มอยู่)
  });

  test("defaults: 10 attempts per minute", async () => {
    const app = loadGateway();

    const response = await login(app);

    expect(response.headers["ratelimit-policy"]).toBe("10;w=60");
  });
});
