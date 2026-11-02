// ทดสอบ cache ของ boardgame-service (src/cache.js): HIT/MISS, ล้างเมื่อเปลี่ยนแปลงข้อมูล, TTL, ปิดได้
jest.mock("../db", () => ({ query: jest.fn() }));
jest.mock("../src/services/external-api", () => ({
  notifyBoardgameCreated: jest.fn(),
}));

const pool = require("../db");
const request = require("supertest");
const app = require("../src/index");
const { clearCache } = require("../src/cache");

const row = { id: 1, name: "Rov", minPlayers: 3, maxPlayers: 4, categories: "Strategy", total: 1 };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  process.env.CACHE_TTL_MS = "60000";
  pool.query.mockResolvedValue([[row]]);
});

afterEach(() => {
  process.env.CACHE_TTL_MS = "0"; // กลับเป็นค่าของ tests/setup-env.js
  clearCache();
  jest.resetAllMocks();
});

test("second identical GET is served from cache without touching DB", async () => {
  const first = await request(app).get("/api/v1/boardgames");
  const second = await request(app).get("/api/v1/boardgames");

  expect(first.headers["x-cache"]).toBe("MISS");
  expect(second.headers["x-cache"]).toBe("HIT");
  expect(second.body).toEqual(first.body);
  expect(pool.query).toHaveBeenCalledTimes(1);
});

test("different query string is cached separately", async () => {
  await request(app).get("/api/v1/boardgames?page=1");
  const other = await request(app).get("/api/v1/boardgames?page=1&sort=name");

  expect(other.headers["x-cache"]).toBe("MISS");
  expect(pool.query).toHaveBeenCalledTimes(2);
});

test("successful write clears the cache so the next GET reads fresh data", async () => {
  await request(app).get("/api/v1/boardgames");
  pool.query.mockResolvedValueOnce([{ insertId: 9 }]);

  const created = await request(app).post("/api/v1/categories").send({ name: "Co-op" });
  const after = await request(app).get("/api/v1/boardgames");

  expect(created.status).toBe(201);
  expect(after.headers["x-cache"]).toBe("MISS");
});

test("failed write (400) keeps the cache", async () => {
  await request(app).get("/api/v1/boardgames");

  const rejected = await request(app).post("/api/v1/categories").send({});
  const after = await request(app).get("/api/v1/boardgames");

  expect(rejected.status).toBe(400);
  expect(after.headers["x-cache"]).toBe("HIT");
});

test("non-200 responses are not cached", async () => {
  pool.query.mockResolvedValue([[]]);

  await request(app).get("/api/v1/boardgames/99");
  const again = await request(app).get("/api/v1/boardgames/99");

  expect(again.status).toBe(404);
  expect(again.headers["x-cache"]).toBe("MISS");
  expect(pool.query).toHaveBeenCalledTimes(2);
});

test("entry expires after CACHE_TTL_MS", async () => {
  process.env.CACHE_TTL_MS = "20";

  await request(app).get("/api/v1/boardgames");
  await sleep(40);
  const after = await request(app).get("/api/v1/boardgames");

  expect(after.headers["x-cache"]).toBe("MISS");
});

test("data read before a write is not cached after the write (no stale entry)", async () => {
  // จำลองว่ามีการแก้ไขข้อมูลเกิดขึ้นระหว่างที่ GET นี้กำลังอ่านฐานข้อมูล
  pool.query.mockImplementationOnce(async () => {
    clearCache();
    return [[row]];
  });

  await request(app).get("/api/v1/boardgames");
  const next = await request(app).get("/api/v1/boardgames");

  expect(next.headers["x-cache"]).toBe("MISS");
});

test("keeps at most 100 entries (oldest dropped first)", async () => {
  for (let i = 1; i <= 101; i++) {
    await request(app).get(`/api/v1/boardgames?category=c${i}`);
  }

  const newest = await request(app).get("/api/v1/boardgames?category=c101");
  const oldest = await request(app).get("/api/v1/boardgames?category=c1");

  expect(newest.headers["x-cache"]).toBe("HIT");
  expect(oldest.headers["x-cache"]).toBe("MISS");
});

test("CACHE_TTL_MS=0 disables caching", async () => {
  process.env.CACHE_TTL_MS = "0";

  const first = await request(app).get("/api/v1/boardgames");
  await request(app).get("/api/v1/boardgames");

  expect(first.headers["x-cache"]).toBeUndefined();
  expect(pool.query).toHaveBeenCalledTimes(2);
});

test("invalid CACHE_TTL_MS falls back to default (cache on)", async () => {
  process.env.CACHE_TTL_MS = "abc";

  await request(app).get("/api/v1/boardgames");
  const second = await request(app).get("/api/v1/boardgames");

  expect(second.headers["x-cache"]).toBe("HIT");
});

test("health is not cached", async () => {
  await request(app).get("/health");
  const second = await request(app).get("/health");

  expect(second.headers["x-cache"]).toBeUndefined();
  expect(pool.query).toHaveBeenCalledTimes(2);
});
