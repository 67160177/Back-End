// ทดสอบ API Gateway: routing, การตรวจ JWT ก่อนเพิ่ม/แก้ไข/ลบ, failure handling (503/504) และ health
// ใช้ stub server จริง (HTTP) แทน service ปลายทาง เพื่อยืนยันว่า Gateway ส่งต่อคำขอจริงหรือไม่
const http = require("http");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../gateway");

const SECRET = "gateway-test-secret";
const tokenFor = (options = {}, secret = SECRET, role = "member") =>
  jwt.sign({ sub: "7", username: "alice", role }, secret, { expiresIn: "1h", ...options });
const bearer = (token = tokenFor()) => `Bearer ${token}`;
const adminBearer = () => bearer(tokenFor({}, SECRET, "admin"));

const DEAD_URL = "http://127.0.0.1:1"; // ไม่มี service รับฟังอยู่

// สร้าง stub service ที่บันทึกทุกคำขอที่ได้รับ
function startStub(setup) {
  const stub = express();
  stub.use(express.json());
  stub.calls = [];
  stub.use((req, res, next) => {
    stub.calls.push({
      method: req.method,
      url: req.originalUrl,
      body: req.body,
      authorization: req.headers.authorization,
    });
    next();
  });
  setup(stub);
  return new Promise((resolve) => {
    const server = http.createServer(stub).listen(0, "127.0.0.1", () => {
      resolve({ server, calls: stub.calls, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

let boardgame, notification, auth;

beforeAll(async () => {
  boardgame = await startStub((s) => {
    s.get("/health", (req, res) => res.json({ status: "ok", database: "up" }));
    s.get("/api/v1/boardgames", (req, res) => res.json({ message: "สำเร็จ", data: [{ id: 1, name: "Rov" }] }));
    s.get("/api/v1/boardgames/:id", (req, res) =>
      res.status(404).json({ error: { code: "NOT_FOUND", message: "ไม่พบบอร์ดเกม" } }),
    );
    s.get("/api/v1/categories", (req, res) => setTimeout(() => res.json({ data: [] }), 300));
    s.all("/{*rest}", (req, res) => res.status(req.method === "POST" ? 201 : 200).json({ echo: req.body ?? null }));
  });
  notification = await startStub((s) => {
    s.get("/health", (req, res) => res.json({ status: "ok" }));
    s.get("/notifications", (req, res) => res.json({ message: "สำเร็จ", data: [{ id: 1, status: "sent" }] }));
  });
  auth = await startStub((s) => {
    s.get("/health", (req, res) => res.json({ status: "ok" }));
    s.post("/auth/register", (req, res) => res.status(201).json({ data: { id: 1, username: req.body.username } }));
    s.post("/auth/login", (req, res) =>
      req.body.password === "correct-horse"
        ? res.json({ data: { token: "issued-token" } })
        : res.status(401).json({ error: { code: "INVALID_CREDENTIALS" } }),
    );
    s.get("/auth/me", (req, res) => res.json({ data: { id: 7, username: "alice" } }));
  });
});

afterAll(async () => {
  await Promise.all([boardgame, notification, auth].map((s) => new Promise((r) => s.server.close(r))));
});

beforeEach(() => {
  process.env.BOARDGAME_SERVICE_URL = boardgame.url;
  process.env.NOTIFICATION_SERVICE_URL = notification.url;
  process.env.AUTH_SERVICE_URL = auth.url;
  process.env.GATEWAY_TIMEOUT_MS = "2000";
  process.env.JWT_SECRET = SECRET;
  [boardgame, notification, auth].forEach((s) => (s.calls.length = 0));
});

describe("routing", () => {
  test("GET / returns gateway info", async () => {
    const response = await request(app).get("/");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ frontend: "/app", docs: "/api-docs" });
  });

  test("public GET is forwarded without token (query string kept)", async () => {
    const response = await request(app).get("/api/v1/boardgames?category=Strategy");

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([{ id: 1, name: "Rov" }]);
    expect(boardgame.calls).toEqual([
      expect.objectContaining({ method: "GET", url: "/api/v1/boardgames?category=Strategy" }),
    ]);
  });

  test("upstream 4xx is passed through unchanged", async () => {
    const response = await request(app).get("/api/v1/boardgames/999");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  test("write with valid token is forwarded with body, token and upstream status", async () => {
    const body = { name: "Azul", minPlayers: 2, maxPlayers: 4 };

    const response = await request(app)
      .post("/api/v1/boardgames")
      .set("Authorization", bearer())
      .send(body);

    expect(response.status).toBe(201);
    expect(response.body.echo).toEqual(body);
    expect(boardgame.calls[0]).toMatchObject({ method: "POST", url: "/api/v1/boardgames", body });
  });

  test("POST /api/v1/auth/register is forwarded to auth-service /auth/register", async () => {
    const response = await request(app)
      .post("/api/v1/auth/register")
      .send({ username: "bob", password: "s3cret-pass" });

    expect(response.status).toBe(201);
    expect(auth.calls[0]).toMatchObject({ method: "POST", url: "/auth/register" });
  });

  test("POST /api/v1/auth/login passes through token or 401 from auth-service", async () => {
    const ok = await request(app).post("/api/v1/auth/login").send({ username: "alice", password: "correct-horse" });
    const wrong = await request(app).post("/api/v1/auth/login").send({ username: "alice", password: "nope" });

    expect(ok.status).toBe(200);
    expect(ok.body.data.token).toBe("issued-token");
    expect(wrong.status).toBe(401);
    expect(auth.calls.map((c) => c.url)).toEqual(["/auth/login", "/auth/login"]);
  });

  test("GET /api/v1/auth/me requires token and forwards Authorization header", async () => {
    const anonymous = await request(app).get("/api/v1/auth/me");
    const loggedIn = await request(app).get("/api/v1/auth/me").set("Authorization", bearer());

    expect(anonymous.status).toBe(401);
    expect(loggedIn.status).toBe(200);
    expect(auth.calls).toHaveLength(1);
    expect(auth.calls[0]).toMatchObject({ url: "/auth/me", authorization: bearer() });
  });

  test("GET /api/v1/notifications is forwarded to notification-service /notifications", async () => {
    const response = await request(app).get("/api/v1/notifications");

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([{ id: 1, status: "sent" }]);
    expect(notification.calls[0].url).toBe("/notifications");
  });

  test("unknown route returns 404 without forwarding", async () => {
    const response = await request(app).get("/api/v1/unknown");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("ROUTE_NOT_FOUND");
    expect(boardgame.calls).toHaveLength(0);
  });
});

describe("write routes require login", () => {
  const writes = [
    ["post", "/api/v1/boardgames"],
    ["put", "/api/v1/boardgames/1"],
    ["patch", "/api/v1/boardgames/1"],
    ["delete", "/api/v1/boardgames/1"],
    ["post", "/api/v1/categories"],
    ["put", "/api/v1/categories/1"],
    ["delete", "/api/v1/categories/1"],
    ["post", "/api/v1/boardgames/1/categories"],
    ["delete", "/api/v1/boardgames/1/categories/2"],
  ];

  test.each(writes)("%s %s without token -> 401 and not forwarded", async (method, url) => {
    const response = await request(app)[method](url).send({});

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
    expect(boardgame.calls).toHaveLength(0);
  });

  test.each(writes)("%s %s with admin token -> forwarded", async (method, url) => {
    const response = await request(app)[method](url).set("Authorization", adminBearer()).send({});

    expect(response.status).toBeLessThan(400);
    expect(boardgame.calls).toHaveLength(1);
  });

  test.each([
    ["expired token", bearer(tokenFor({ expiresIn: -10 })), "TOKEN_EXPIRED"],
    ["token signed with another secret", bearer(tokenFor({}, "attacker-secret")), "INVALID_TOKEN"],
    ["garbage token", "Bearer not-a-jwt", "INVALID_TOKEN"],
    ["not a Bearer header", "Basic YWxpY2U6cGFzcw==", "UNAUTHORIZED"],
  ])("%s -> 401 %s", async (label, header, code) => {
    const response = await request(app).delete("/api/v1/boardgames/1").set("Authorization", header);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe(code);
    expect(boardgame.calls).toHaveLength(0);
  });

  test("JWT_SECRET not set -> 503 AUTH_NOT_CONFIGURED", async () => {
    delete process.env.JWT_SECRET;

    const response = await request(app).post("/api/v1/boardgames").set("Authorization", bearer()).send({});

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("AUTH_NOT_CONFIGURED");
    expect(boardgame.calls).toHaveLength(0);
  });

  test("reads stay public (no token needed)", async () => {
    const response = await request(app).get("/api/v1/boardgames");

    expect(response.status).toBe(200);
  });

  const adminOnly = [
    ["delete", "/api/v1/boardgames/1"],
    ["delete", "/api/v1/categories/1"],
  ];
  const memberAllowed = writes.filter(([m, u]) => !adminOnly.some(([am, au]) => am === m && au === u));

  test.each(memberAllowed)("member %s %s -> forwarded", async (method, url) => {
    const response = await request(app)[method](url).set("Authorization", bearer()).send({});

    expect(response.status).toBeLessThan(400);
    expect(boardgame.calls).toHaveLength(1);
  });

  test.each(adminOnly)("member %s %s -> 403 FORBIDDEN and not forwarded", async (method, url) => {
    const response = await request(app)[method](url).set("Authorization", bearer());

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
    expect(boardgame.calls).toHaveLength(0);
  });

  test("token without role (issued before roles existed) is treated as member", async () => {
    const legacy = jwt.sign({ sub: "7", username: "alice" }, SECRET, { expiresIn: "1h" });

    const response = await request(app).delete("/api/v1/boardgames/1").set("Authorization", bearer(legacy));

    expect(response.status).toBe(403);
  });

  test("role cannot be forged without the secret", async () => {
    const forged = bearer(tokenFor({}, "attacker-secret", "admin"));

    const response = await request(app).delete("/api/v1/boardgames/1").set("Authorization", forged);

    expect(response.status).toBe(401);
    expect(boardgame.calls).toHaveLength(0);
  });

  test("auth-service down: login 503 but existing token still works for writes", async () => {
    process.env.AUTH_SERVICE_URL = DEAD_URL;
    jest.spyOn(console, "log").mockImplementation(() => {});

    const login = await request(app).post("/api/v1/auth/login").send({ username: "alice", password: "x" });
    const write = await request(app).post("/api/v1/categories").set("Authorization", bearer()).send({ name: "Co-op" });

    expect(login.status).toBe(503);
    expect(write.status).toBe(201);
    console.log.mockRestore();
  });
});

describe("failure handling", () => {
  test("service down -> 503 and gateway keeps working", async () => {
    process.env.BOARDGAME_SERVICE_URL = DEAD_URL;
    jest.spyOn(console, "log").mockImplementation(() => {});

    const first = await request(app).get("/api/v1/boardgames");
    const second = await request(app).get("/api/v1/boardgames/1");

    expect(first.status).toBe(503);
    expect(first.body.error).toEqual({
      code: "SERVICE_UNAVAILABLE",
      message: "boardgame-service ไม่พร้อมใช้งานในขณะนี้",
    });
    expect(second.status).toBe(503);

    process.env.BOARDGAME_SERVICE_URL = boardgame.url;
    const recovered = await request(app).get("/api/v1/boardgames");
    expect(recovered.status).toBe(200);
    console.log.mockRestore();
  });

  test("service slower than GATEWAY_TIMEOUT_MS -> 504", async () => {
    process.env.GATEWAY_TIMEOUT_MS = "100";
    jest.spyOn(console, "log").mockImplementation(() => {});

    const response = await request(app).get("/api/v1/categories");

    expect(response.status).toBe(504);
    expect(response.body.error.code).toBe("GATEWAY_TIMEOUT");
    console.log.mockRestore();
  });

  test("notification-service down -> notifications 503 but browsing still works", async () => {
    process.env.NOTIFICATION_SERVICE_URL = DEAD_URL;
    jest.spyOn(console, "log").mockImplementation(() => {});

    const notifications = await request(app).get("/api/v1/notifications");
    const browse = await request(app).get("/api/v1/boardgames");

    expect(notifications.status).toBe(503);
    expect(browse.status).toBe(200);
    console.log.mockRestore();
  });

  test("malformed JSON is rejected at gateway (400) without forwarding", async () => {
    const response = await request(app)
      .post("/api/v1/boardgames")
      .set("Authorization", bearer())
      .set("Content-Type", "application/json")
      .send('{"name": "Azul",}');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("entity.parse.failed");
    expect(boardgame.calls).toHaveLength(0);
  });

  test("invalid GATEWAY_TIMEOUT_MS falls back to default", async () => {
    process.env.GATEWAY_TIMEOUT_MS = "abc";

    const response = await request(app).get("/api/v1/categories");

    expect(response.status).toBe(200);
  });
});

describe("GET /api/v1/health", () => {
  test("all services up -> ok", async () => {
    const response = await request(app).get("/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ok",
      services: {
        gateway: "up",
        boardgameService: "up",
        database: "up",
        notificationService: "up",
        authService: "up",
      },
    });
  });

  test("auth-service down -> degraded (200)", async () => {
    process.env.AUTH_SERVICE_URL = DEAD_URL;

    const response = await request(app).get("/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("degraded");
    expect(response.body.services.authService).toBe("down");
  });

  test("notification-service down -> degraded (200)", async () => {
    process.env.NOTIFICATION_SERVICE_URL = DEAD_URL;

    const response = await request(app).get("/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("degraded");
    expect(response.body.services.notificationService).toBe("down");
  });

  test("boardgame-service down -> down (503)", async () => {
    process.env.BOARDGAME_SERVICE_URL = DEAD_URL;

    const response = await request(app).get("/api/v1/health");

    expect(response.status).toBe(503);
    expect(response.body.status).toBe("down");
    expect(response.body.services).toMatchObject({ boardgameService: "down", database: "unknown" });
  });
});

describe("static frontend and docs", () => {
  test("GET /app/ serves frontend", async () => {
    const response = await request(app).get("/app/");

    expect(response.status).toBe(200);
    expect(response.text).toContain("Board Game Manager");
  });

  test("GET /api-docs/ serves Swagger UI", async () => {
    const response = await request(app).get("/api-docs/");

    expect(response.status).toBe(200);
    expect(response.text).toContain("swagger-ui");
  });
});
