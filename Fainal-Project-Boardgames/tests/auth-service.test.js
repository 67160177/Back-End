// ทดสอบ auth-service: สมัครสมาชิก, เข้าสู่ระบบ (JWT), /auth/me และ health
// mock ฐานข้อมูลด้วย jest.mock() เหมือน test ของ boardgame-service จึงไม่ต้องมี MySQL
jest.mock("../db", () => ({ query: jest.fn() }));

const crypto = require("crypto");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const pool = require("../db");
const app = require("../services/auth-service");

const SECRET = "test-secret";

// hash ของรหัสผ่านแบบเดียวกับที่ auth-service เก็บ (ใช้จำลองแถวในตาราง users)
function hashOf(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

const alice = {
  id: 7,
  username: "alice",
  password_hash: hashOf("correct-horse"),
  role: "member",
  created_at: "2026-11-01T10:00:00.000Z",
};

beforeAll(() => jest.spyOn(console, "log").mockImplementation(() => {}));
afterAll(() => console.log.mockRestore());

beforeEach(() => {
  pool.query.mockReset();
  process.env.JWT_SECRET = SECRET;
  delete process.env.JWT_EXPIRES_IN;
});

describe("GET /health", () => {
  test("database up -> 200", async () => {
    pool.query.mockResolvedValueOnce([[{ 1: 1 }]]);

    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", service: "auth-service", database: "up" });
  });

  test("database down -> 503", async () => {
    pool.query.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const response = await request(app).get("/health");

    expect(response.status).toBe(503);
    expect(response.body.database).toBe("down");
  });
});

describe("POST /auth/register", () => {
  test("creates user and stores scrypt hash, not the password", async () => {
    pool.query.mockResolvedValueOnce([{ insertId: 12 }]);

    const response = await request(app)
      .post("/auth/register")
      .send({ username: "bob_99", password: "s3cret-pass" });

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual({ id: 12, username: "bob_99", role: "member" });

    const [sql, [username, stored]] = pool.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO users/);
    expect(username).toBe("bob_99");
    expect(stored).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(stored).not.toContain("s3cret-pass");
  });

  test("role in body is ignored: self-registration is always member", async () => {
    pool.query.mockResolvedValueOnce([{ insertId: 13 }]);

    const response = await request(app)
      .post("/auth/register")
      .send({ username: "sneaky", password: "s3cret-pass", role: "admin" });

    expect(response.body.data.role).toBe("member");
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).not.toMatch(/role/);
    expect(params).toHaveLength(2);
  });

  test("same password gets a different hash each time (random salt)", async () => {
    pool.query.mockResolvedValue([{ insertId: 1 }]);
    const body = { username: "bob_99", password: "s3cret-pass" };

    await request(app).post("/auth/register").send(body);
    await request(app).post("/auth/register").send(body);

    expect(pool.query.mock.calls[0][1][1]).not.toBe(pool.query.mock.calls[1][1][1]);
  });

  test("duplicate username -> 409", async () => {
    pool.query.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "ER_DUP_ENTRY" }));

    const response = await request(app)
      .post("/auth/register")
      .send({ username: "alice", password: "another-pass" });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("USERNAME_TAKEN");
  });

  test.each([
    [{ password: "s3cret-pass" }, "MISSING_FIELDS"],
    [{ username: "bob" }, "MISSING_FIELDS"],
    [{ username: 123, password: "s3cret-pass" }, "INVALID_CREDENTIALS_FORMAT"],
    [{ username: "ab", password: "s3cret-pass" }, "INVALID_USERNAME"],
    [{ username: "has space", password: "s3cret-pass" }, "INVALID_USERNAME"],
    [{ username: "a".repeat(31), password: "s3cret-pass" }, "INVALID_USERNAME"],
    [{ username: "bob", password: "short" }, "INVALID_PASSWORD"],
    [{ username: "bob", password: "x".repeat(73) }, "INVALID_PASSWORD"],
  ])("invalid body %j -> 400 %s without touching the database", async (body, code) => {
    const response = await request(app).post("/auth/register").send(body);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe(code);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("database error -> 500", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    pool.query.mockRejectedValueOnce(new Error("connection lost"));

    const response = await request(app)
      .post("/auth/register")
      .send({ username: "bob", password: "s3cret-pass" });

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL_SERVER_ERROR");
    console.error.mockRestore();
  });
});

describe("POST /auth/login", () => {
  test("correct password -> 200 with verifiable JWT (2 hours)", async () => {
    pool.query.mockResolvedValueOnce([[alice]]);

    const response = await request(app)
      .post("/auth/login")
      .send({ username: "alice", password: "correct-horse" });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      tokenType: "Bearer",
      expiresIn: "2h",
      user: { id: 7, username: "alice", role: "member" },
    });
    expect(response.body.data.user).not.toHaveProperty("password_hash");

    const payload = jwt.verify(response.body.data.token, SECRET);
    expect(payload).toMatchObject({ sub: "7", username: "alice", role: "member" });
    expect(payload.exp - payload.iat).toBe(2 * 60 * 60);
  });

  test("admin login -> token carries role admin", async () => {
    pool.query.mockResolvedValueOnce([[{ ...alice, role: "admin" }]]);

    const response = await request(app)
      .post("/auth/login")
      .send({ username: "alice", password: "correct-horse" });

    expect(response.body.data.user.role).toBe("admin");
    expect(jwt.verify(response.body.data.token, SECRET).role).toBe("admin");
  });

  test("JWT_EXPIRES_IN changes token lifetime", async () => {
    process.env.JWT_EXPIRES_IN = "15m";
    pool.query.mockResolvedValueOnce([[alice]]);

    const response = await request(app)
      .post("/auth/login")
      .send({ username: "alice", password: "correct-horse" });

    const payload = jwt.decode(response.body.data.token);
    expect(payload.exp - payload.iat).toBe(15 * 60);
  });

  test("wrong password -> 401", async () => {
    pool.query.mockResolvedValueOnce([[alice]]);

    const response = await request(app)
      .post("/auth/login")
      .send({ username: "alice", password: "wrong-password" });

    expect(response.status).toBe(401);
    expect(response.body.error).toEqual({
      code: "INVALID_CREDENTIALS",
      message: "username หรือ password ไม่ถูกต้อง",
    });
  });

  test("unknown user -> same 401 as wrong password", async () => {
    pool.query.mockResolvedValueOnce([[]]);

    const response = await request(app)
      .post("/auth/login")
      .send({ username: "nobody", password: "whatever-pass" });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  test("corrupted hash in database -> 401 (not crash)", async () => {
    pool.query.mockResolvedValueOnce([[{ ...alice, password_hash: "plain-text" }]]);

    const response = await request(app)
      .post("/auth/login")
      .send({ username: "alice", password: "plain-text" });

    expect(response.status).toBe(401);
  });

  test("missing fields -> 400", async () => {
    const response = await request(app).post("/auth/login").send({ username: "alice" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("MISSING_FIELDS");
  });

  test("JWT_SECRET not set -> 503 and no token issued", async () => {
    delete process.env.JWT_SECRET;

    const response = await request(app)
      .post("/auth/login")
      .send({ username: "alice", password: "correct-horse" });

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("AUTH_NOT_CONFIGURED");
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe("GET /auth/me", () => {
  const tokenFor = (sub, options = {}) =>
    jwt.sign({ sub: String(sub), username: "alice" }, SECRET, { expiresIn: "1h", ...options });

  test("valid token -> current user", async () => {
    pool.query.mockResolvedValueOnce([[alice]]);

    const response = await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${tokenFor(7)}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ id: 7, username: "alice", role: "member", createdAt: alice.created_at });
    expect(pool.query.mock.calls[0][1]).toEqual([7]);
  });

  test.each([
    ["no header", undefined],
    ["not Bearer", "Basic abc"],
    ["signed with other secret", `Bearer ${jwt.sign({ sub: "7" }, "other")}`],
    ["expired", `Bearer ${jwt.sign({ sub: "7", exp: Math.floor(Date.now() / 1000) - 10 }, SECRET)}`],
  ])("%s -> 401", async (label, header) => {
    const req = request(app).get("/auth/me");
    if (header) req.set("Authorization", header);

    const response = await req;

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("user deleted after token was issued -> 401", async () => {
    pool.query.mockResolvedValueOnce([[]]);

    const response = await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${tokenFor(99)}`);

    expect(response.status).toBe(401);
  });
});

test("unknown route -> 404", async () => {
  const response = await request(app).get("/nope");

  expect(response.status).toBe(404);
  expect(response.body.error.code).toBe("ROUTE_NOT_FOUND");
});
