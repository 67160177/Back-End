// ทดสอบ scripts/create-admin.js: สร้าง admin ใหม่ / เลื่อนผู้ใช้เดิมเป็น admin / ตรวจข้อมูล
// ส่ง pool ปลอมเข้าไปแทน MySQL จริง
const { createAdmin } = require("../scripts/create-admin");
const { verifyPassword } = require("../services/auth-service/password");

const fakePool = (...results) => ({ query: jest.fn().mockImplementation(() => Promise.resolve(results.shift())) });
const noPrompt = () => {
  throw new Error("should not ask for password");
};

test("new username -> INSERT as admin with scrypt hash", async () => {
  const pool = fakePool([[]], [{ insertId: 5 }]);

  const result = await createAdmin({ pool, username: "boss", password: "admin-pass-1", askPassword: noPrompt });

  expect(result).toEqual({ action: "created", id: 5 });
  const [sql, [username, hash]] = pool.query.mock.calls[1];
  expect(sql).toMatch(/INSERT INTO users \(username, password_hash, role\) VALUES \(\?, \?, 'admin'\)/);
  expect(username).toBe("boss");
  expect(await verifyPassword("admin-pass-1", hash)).toBe(true);
});

test("asks for password when not given in command", async () => {
  const pool = fakePool([[]], [{ insertId: 6 }]);
  const askPassword = jest.fn().mockResolvedValue("typed-secret-1");

  await createAdmin({ pool, username: "boss", askPassword });

  expect(askPassword).toHaveBeenCalledTimes(1);
  expect(await verifyPassword("typed-secret-1", pool.query.mock.calls[1][1][1])).toBe(true);
});

test("existing member -> promoted to admin, password untouched", async () => {
  const pool = fakePool([[{ id: 3, role: "member" }]], [{ affectedRows: 1 }]);

  const result = await createAdmin({ pool, username: "alice", askPassword: noPrompt });

  expect(result).toEqual({ action: "promoted", id: 3 });
  expect(pool.query.mock.calls[1]).toEqual(["UPDATE users SET role = 'admin' WHERE id = ?", [3]]);
});

test("already admin -> nothing changes", async () => {
  const pool = fakePool([[{ id: 3, role: "admin" }]]);

  const result = await createAdmin({ pool, username: "alice", askPassword: noPrompt });

  expect(result.action).toBe("unchanged");
  expect(pool.query).toHaveBeenCalledTimes(1);
});

test.each([
  [undefined, "admin-pass-1", /username/],
  ["a b", "admin-pass-1", /username/],
  ["boss", "short", /password/],
])("invalid input (%s, %s) -> error, no INSERT", async (username, password, message) => {
  const pool = fakePool([[]]);

  await expect(createAdmin({ pool, username, password, askPassword: noPrompt })).rejects.toThrow(message);
  expect(pool.query.mock.calls.every(([sql]) => !/INSERT/.test(sql))).toBe(true);
});

// ---------- บัญชี admin จาก .env (ADMIN_USERNAME / ADMIN_PASSWORD) ----------
const crypto = require("crypto");
const { syncEnvAdmin } = require("../services/auth-service/admin");

const hashOf = (password) => {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${crypto.scryptSync(password, salt, 64).toString("hex")}`;
};

describe("syncEnvAdmin (.env admin)", () => {
  test("not in database -> created as admin", async () => {
    const pool = fakePool([[]], [{ insertId: 9 }]);

    const result = await syncEnvAdmin({ pool, username: "admin", password: "env-pass-123" });

    expect(result).toEqual({ action: "created", id: 9 });
    expect(pool.query.mock.calls[1][0]).toMatch(/INSERT INTO users .* 'admin'\)/);
    expect(await verifyPassword("env-pass-123", pool.query.mock.calls[1][1][1])).toBe(true);
  });

  test("already admin with same password -> nothing changes (safe to restart)", async () => {
    const pool = fakePool([[{ id: 1, role: "admin", password_hash: hashOf("env-pass-123") }]]);

    const result = await syncEnvAdmin({ pool, username: "admin", password: "env-pass-123" });

    expect(result.action).toBe("unchanged");
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test("existing member with same name -> set role admin, keep password hash", async () => {
    const hash = hashOf("env-pass-123");
    const pool = fakePool([[{ id: 2, role: "member", password_hash: hash }]], [{}]);

    const result = await syncEnvAdmin({ pool, username: "admin", password: "env-pass-123" });

    expect(result).toMatchObject({ action: "updated", roleChanged: true, passwordChanged: false });
    expect(pool.query.mock.calls[1]).toEqual(["UPDATE users SET role = 'admin', password_hash = ? WHERE id = ?", [hash, 2]]);
  });

  test("password in .env changed -> database password follows .env", async () => {
    const pool = fakePool([[{ id: 1, role: "admin", password_hash: hashOf("old-pass-123") }]], [{}]);

    const result = await syncEnvAdmin({ pool, username: "admin", password: "new-pass-456" });

    expect(result).toMatchObject({ action: "updated", roleChanged: false, passwordChanged: true });
    expect(await verifyPassword("new-pass-456", pool.query.mock.calls[1][1][0])).toBe(true);
  });

  test.each([
    ["a b", "env-pass-123", /username/],
    ["admin", "short", /password/],
  ])("invalid .env value (%s, %s) -> error, database untouched", async (username, password, message) => {
    const pool = fakePool();

    await expect(syncEnvAdmin({ pool, username, password })).rejects.toThrow(message);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe("setupEnvAdmin (auth-service startup)", () => {
  jest.mock("../db", () => ({ query: jest.fn() }));
  const { setupEnvAdmin } = require("../services/auth-service");

  beforeEach(() => jest.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => console.log.mockRestore());

  test("no ADMIN_* in .env -> skipped", async () => {
    const pool = fakePool();

    expect(await setupEnvAdmin({ pool, env: {} })).toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("only one of ADMIN_USERNAME / ADMIN_PASSWORD -> warning, skipped", async () => {
    const pool = fakePool();

    expect(await setupEnvAdmin({ pool, env: { ADMIN_USERNAME: "admin" } })).toBeNull();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("ไม่ครบคู่"));
  });

  test("both set -> admin synced and logged", async () => {
    const pool = fakePool([[]], [{ insertId: 1 }]);

    const result = await setupEnvAdmin({ pool, env: { ADMIN_USERNAME: "admin", ADMIN_PASSWORD: "env-pass-123" } });

    expect(result.action).toBe("created");
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('สร้างบัญชี admin "admin" จาก .env'));
  });

  test("table missing -> warning with hint, service does not crash", async () => {
    const pool = { query: jest.fn().mockRejectedValue(Object.assign(new Error("no table"), { code: "ER_NO_SUCH_TABLE" })) };

    const result = await setupEnvAdmin({ pool, env: { ADMIN_USERNAME: "admin", ADMIN_PASSWORD: "env-pass-123" } });

    expect(result).toBeNull();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("npm run migrate"));
  });
});
